import asyncio
import json
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import httpx
import pytest
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from pydantic import ValidationError

from tassel.app import create_app
from tassel.config import Settings
from tassel.voice.registry import VoiceRegistry
from tassel.voice.settings import IceServerConfig, VoiceConfigError, VoiceSettings

pytestmark = pytest.mark.asyncio


@asynccontextmanager
async def voice_client(db_url, *, settings=None, start_bot=None):
    app = create_app(
        Settings(database_url=db_url),
        voice_settings=settings or VoiceSettings(providers="fake", fake_tts="tone"),
    )
    async with app.router.lifespan_context(app):
        if start_bot:
            await app.state.voice.shutdown()
            app.state.voice = VoiceRegistry(
                settings=app.state.voice_settings,
                sessions=app.state.session_factory,
                start_bot=start_bot,
                turn_images=app.state.voice.turn_images,
            )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client, app


async def session(client):
    device = (await client.post("/v1/devices")).json()
    headers = {"Authorization": "Bearer " + device["token"]}
    row = (
        await client.post(
            "/v1/sessions",
            headers=headers,
            json={"type": "studying", "source": "talk", "language": "en"},
        )
    ).json()
    return headers, row


@asynccontextmanager
async def offer_peer():
    pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    pc.addTransceiver("audio", direction="sendrecv")
    channel = pc.createDataChannel("rtvi-ai")
    try:
        await pc.setLocalDescription(await pc.createOffer())
        yield (
            pc,
            {
                "sdp": pc.localDescription.sdp,
                "type": "offer",
                "requestData": {"sensitivity": "normal", "ptt": False},
            },
            channel,
        )
    finally:
        await pc.close()


async def test_offer_needs_a_device_token(db_url):
    async with voice_client(db_url) as (client, _):
        url = f"/v1/sessions/{uuid4()}/voice/offer"
        assert (await client.post(url, json={"sdp": "unused", "type": "offer"})).status_code == 401
        assert (
            await client.patch(url, json={"pc_id": "unknown", "candidates": []})
        ).status_code == 401
        assert (await client.get("/v1/voice/ice-servers")).status_code == 401


async def test_offer_for_another_learners_session_is_404(db_url):
    async with voice_client(db_url) as (client, _):
        _, other = await session(client)
        headers, _ = await session(client)
        for sid in (other["id"], str(uuid4())):
            url = f"/v1/sessions/{sid}/voice/offer"
            assert (
                await client.post(url, headers=headers, json={"sdp": "unused", "type": "offer"})
            ).status_code == 404
            assert (
                await client.patch(
                    url, headers=headers, json={"pc_id": "unknown", "candidates": []}
                )
            ).status_code == 404


async def test_offer_answers_and_starts_a_bot(db_url):
    contexts = []
    started = asyncio.Event()

    async def start_bot(connection, ctx):
        contexts.append(ctx)
        started.set()
        await asyncio.Event().wait()

    async with voice_client(db_url, start_bot=start_bot) as (client, app):
        headers, row = await session(client)
        async with offer_peer() as (_, offer, _):
            response = await client.post(
                f"/v1/sessions/{row['id']}/voice/offer", headers=headers, json=offer
            )
            assert response.status_code == 200, response.text
            answer = response.json()
            assert answer["type"] == "answer" and answer["pc_id"] and "m=audio" in answer["sdp"]
            await asyncio.wait_for(started.wait(), 5)
            ctx = contexts[0]
            assert ctx.session_id == UUID(row["id"]) and ctx.lang == "en" and ctx.titled is False
            assert ctx.request.sensitivity == "normal" and ctx.request.ptt is False
            # The glue: the bot gets the session's page-image seam.
            assert ctx.turn_image is not None and ctx.board is not None
            assert app.state.voice.live_bot(ctx.learner_id).pc_ids == {answer["pc_id"]}


async def test_real_bot_starts_and_stops_with_the_peer(db_url):
    async with voice_client(db_url) as (client, app):
        headers, row = await session(client)
        learner_id = UUID((await client.get("/v1/me", headers=headers)).json()["learner_id"])
        async with offer_peer() as (pc, offer, channel):
            response = await client.post(
                f"/v1/sessions/{row['id']}/voice/offer", headers=headers, json=offer
            )
            assert response.status_code == 200, response.text
            answer = response.json()
            bot = app.state.voice.live_bot(learner_id)
            assert bot and not bot.task.done()
            received = []
            tracks = []
            channel.on("message", lambda data: received.append(json.loads(data)))
            pc.on("track", lambda track: tracks.append(track))
            await pc.setRemoteDescription(
                RTCSessionDescription(sdp=answer["sdp"], type=answer["type"])
            )
            async with asyncio.timeout(5):
                while pc.connectionState != "connected":
                    await asyncio.sleep(0.01)
            async with asyncio.timeout(5):
                while channel.readyState != "open":
                    await asyncio.sleep(0.01)
                channel.send(
                    json.dumps(
                        {
                            "label": "rtvi-ai",
                            "type": "client-ready",
                            "id": "ready",
                            "data": {"version": "2.1.0"},
                        }
                    )
                )
                while not any(m["type"] == "bot-tts-text" for m in received):
                    await asyncio.sleep(0.01)
                assert any(m["type"] == "bot-ready" for m in received)
                assert any(
                    m["type"] == "server-message"
                    and m["data"].get("tassel", {}).get("kind") == "route"
                    for m in received
                )
                # Decode synthetic tones, never attach a speaker or microphone.
                while True:
                    audio = await tracks[0].recv()
                    if audio.to_ndarray().any():
                        break
            await pc.close()
            await asyncio.wait_for(asyncio.gather(bot.task, return_exceptions=True), 5)
            assert app.state.voice.live_bot(learner_id) is None


async def test_restart_unknown_pc_and_patch_unknown_pc(db_url):
    async with voice_client(db_url) as (client, _):
        headers, row = await session(client)
        url = f"/v1/sessions/{row['id']}/voice/offer"
        response = await client.post(
            url,
            headers=headers,
            json={"sdp": "unused", "type": "offer", "pc_id": "unknown", "restart_pc": True},
        )
        assert response.status_code == 409
        assert (
            await client.patch(url, headers=headers, json={"pc_id": "unknown", "candidates": []})
        ).status_code == 404


async def test_cors_preflight_allows_patch_from_the_app(db_url):
    async with voice_client(db_url) as (client, _):
        response = await client.options(
            f"/v1/sessions/{uuid4()}/voice/offer",
            headers={
                "Origin": "app://tassel",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "app://tassel"


async def test_ice_servers_from_settings(db_url):
    settings = VoiceSettings(
        providers="fake",
        ice_servers=[
            IceServerConfig(
                urls=["turn:turn.example:443?transport=tcp"], username="u", credential="c"
            )
        ],
    )
    async with voice_client(db_url, settings=settings) as (client, _):
        headers, _ = await session(client)
        response = await client.get("/v1/voice/ice-servers", headers=headers)
        assert response.json() == {
            "ice_servers": [
                {
                    "urls": ["turn:turn.example:443?transport=tcp"],
                    "username": "u",
                    "credential": "c",
                }
            ]
        }


async def test_startup_refuses_misconfigured_live_providers():
    app = create_app(
        voice_settings=VoiceSettings(_env_file=None, providers="fake", llm_provider="openrouter")
    )
    with pytest.raises(VoiceConfigError, match="OPENROUTER_API_KEY"):
        async with app.router.lifespan_context(app):
            pytest.fail("misconfigured startup succeeded")


async def test_create_app_reads_no_env_file(monkeypatch, tmp_path):
    # A synthetic settings file, never the developer's .env or credentials.
    path = tmp_path / "invalid-voice-settings.txt"
    path.write_text("TASSEL_PROVIDERS=invalid\n")
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", str(path))
    app = create_app()
    assert "/v1/sessions/{session_id}/voice/offer" in app.openapi()["paths"]
    with pytest.raises(ValidationError):
        async with app.router.lifespan_context(app):
            pytest.fail("invalid settings accepted")


async def test_patch_forwards_candidates_and_returns_204(db_url, monkeypatch):
    async def idle(connection, ctx):
        await asyncio.Event().wait()

    async with voice_client(db_url, start_bot=idle) as (client, app):
        headers, row = await session(client)
        learner_id = UUID((await client.get("/v1/me", headers=headers)).json()["learner_id"])
        async with offer_peer() as (_, offer, _):
            url = f"/v1/sessions/{row['id']}/voice/offer"
            answer = (await client.post(url, headers=headers, json=offer)).json()
            connection = app.state.voice.live_bot(learner_id).connection
            observed = []
            original = connection.add_ice_candidate

            async def record(candidate):
                observed.append(candidate)
                await original(candidate)

            monkeypatch.setattr(connection, "add_ice_candidate", record)
            response = await client.patch(
                url,
                headers=headers,
                json={
                    "pc_id": answer["pc_id"],
                    "candidates": [{"candidate": "", "sdp_mid": "0", "sdp_mline_index": 0}],
                },
            )
            assert response.status_code == 204 and response.content == b""
            assert observed == [None]  # Real SDK end-of-candidates conversion.


@pytest.mark.parametrize(
    "kind,key",
    [("stt", "DEEPGRAM_API_KEY"), ("llm", "OPENROUTER_API_KEY"), ("tts", "ELEVENLABS_API_KEY")],
)
async def test_missing_auto_provider_is_an_actionable_503(db_url, kind, key):
    settings = VoiceSettings(providers="fake", **{f"{kind}_provider": "auto"})
    async with voice_client(db_url, settings=settings) as (client, app):
        headers, row = await session(client)
        response = await client.post(
            f"/v1/sessions/{row['id']}/voice/offer",
            headers=headers,
            json={"sdp": "unused", "type": "offer"},
        )
        assert response.status_code == 503
        assert key in response.json()["detail"]
        assert "fake" in response.json()["detail"]


async def test_real_handler_restart_keeps_bot_and_aliases(db_url):
    contexts = []

    async def idle(connection, ctx):
        contexts.append(ctx)
        await asyncio.Event().wait()

    async with voice_client(db_url, start_bot=idle) as (client, app):
        headers, row = await session(client)
        await client.patch(
            f"/v1/sessions/{row['id']}", headers=headers, json={"title": "My lesson"}
        )
        async with offer_peer() as (_, offer, _):
            offer["requestData"] = {"sensitivity": "low", "ptt": True}
            url = f"/v1/sessions/{row['id']}/voice/offer"
            first = (await client.post(url, headers=headers, json=offer)).json()
            bot = app.state.voice.live_bot(contexts[0].learner_id)
            assert contexts[0].titled and contexts[0].request.ptt
            assert contexts[0].request.sensitivity == "low"
            async with offer_peer() as (_, restart, _):
                restart.update(pc_id=first["pc_id"], restart_pc=True)
                answer = await client.post(url, headers=headers, json=restart)
                assert answer.status_code == 200, answer.text
                second = answer.json()
                assert second["pc_id"] != first["pc_id"]
                assert bot.pc_ids == {first["pc_id"], second["pc_id"]}
                assert app.state.voice.live_bot(contexts[0].learner_id) is bot
                assert len(contexts) == 1


async def test_each_bot_gets_the_page_image_seam_on_the_apps_store_and_db(app, client):
    """The glue: bots read the latest stored page through vision-lite's turn_image_for."""
    import uuid

    from tassel.beats.markup import BoardContext

    turn_image = app.state.voice.turn_image_for_bot(BoardContext())
    assert turn_image is not None
    # No frames for this session: no page, at once, never an error.
    from datetime import UTC, datetime

    assert await turn_image(uuid.uuid4(), datetime.now(UTC)) is None
