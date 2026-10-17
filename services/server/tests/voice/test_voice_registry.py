import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from tassel.voice.api import IcePatch, OfferBody
from tassel.voice.registry import VoiceConflict, VoiceRegistry
from tassel.voice.settings import IceServerConfig, VoiceSettings

pytestmark = pytest.mark.asyncio


class FakeConnection:
    def __init__(self, pc_id):
        self.pc_id = pc_id
        self.closed = False

    async def disconnect(self):
        self.closed = True


class FakeHandler:
    made = []
    sequence = 0

    def __init__(self, ice_servers):
        self.ice_servers = ice_servers
        self.connections = []
        self.patches = []
        self.requests = []
        FakeHandler.made.append(self)

    async def handle_web_request(self, request, callback):
        self.requests.append(request)
        await asyncio.sleep(0)  # Give concurrent offers a chance to race.
        if not request.pc_id:
            FakeHandler.sequence += 1
            connection = FakeConnection(f"pc-{FakeHandler.sequence}")
            self.connections.append(connection)
            await callback(connection)
        else:
            connection = self.connections[0]
            if request.restart_pc:
                connection.pc_id += "-restart"
        return {"sdp": "answer", "type": "answer", "pc_id": connection.pc_id}

    async def handle_patch_request(self, request):
        self.patches.append(request)

    async def close(self):
        for connection in self.connections:
            await connection.disconnect()


@pytest.fixture
def registry_factory(monkeypatch):
    FakeHandler.made = []
    monkeypatch.setattr("tassel.voice.registry.SmallWebRTCRequestHandler", FakeHandler)
    return VoiceRegistry


def row(learner_id, *, titled=False):
    return SimpleNamespace(
        id=uuid4(), learner_id=learner_id, language="en", title="Lesson" if titled else None
    )


async def idle(connection, context):
    await asyncio.Event().wait()


async def test_second_offer_replaces_the_learners_bot(registry_factory):
    registry = registry_factory(
        settings=VoiceSettings(providers="fake"), sessions=None, start_bot=idle
    )
    learner = uuid4()
    first, second = row(learner), row(learner, titled=True)
    try:
        await registry.offer(
            learner_id=learner, session=first, body=OfferBody(sdp="offer", type="offer")
        )
        original = registry.live_bot(learner)
        await asyncio.sleep(0)
        await registry.offer(
            learner_id=learner, session=second, body=OfferBody(sdp="offer", type="offer")
        )
        assert original.task.cancelled()
        assert registry.live_bot(learner).session_id == second.id
        assert FakeHandler.made[0].connections[0].closed
    finally:
        await registry.shutdown()


async def test_concurrent_offers_leave_one_bot(registry_factory):
    started, cancelled = [], []

    async def start(connection, ctx):
        started.append(ctx.session_id)
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(ctx.session_id)

    registry = registry_factory(
        settings=VoiceSettings(providers="fake"), sessions=None, start_bot=start
    )
    learner = uuid4()
    rows = [row(learner), row(learner)]
    try:
        await asyncio.gather(
            *(
                registry.offer(
                    learner_id=learner, session=s, body=OfferBody(sdp="offer", type="offer")
                )
                for s in rows
            )
        )
        await asyncio.sleep(0)
        assert len(started) == 2 and len(cancelled) == 1
        assert registry.live_bot(learner).session_id in started
    finally:
        await registry.shutdown()
    assert len(cancelled) == 2


async def test_renegotiation_restart_and_ownership(registry_factory):
    registry = registry_factory(
        settings=VoiceSettings(providers="fake"), sessions=None, start_bot=idle
    )
    learner = uuid4()
    session = row(learner)
    try:
        answer = await registry.offer(
            learner_id=learner, session=session, body=OfferBody(sdp="offer", type="offer")
        )
        bot = registry.live_bot(learner)
        restarted = await registry.offer(
            learner_id=learner,
            session=session,
            body=OfferBody(sdp="offer", type="offer", pc_id=answer.pc_id, restart_pc=True),
        )
        assert registry.live_bot(learner) is bot
        assert {answer.pc_id, restarted.pc_id} <= bot.pc_ids
        for wrong_learner, wrong_session in ((uuid4(), session), (learner, row(learner))):
            with pytest.raises(VoiceConflict):
                await registry.offer(
                    learner_id=wrong_learner,
                    session=wrong_session,
                    body=OfferBody(sdp="offer", type="offer", pc_id=answer.pc_id),
                )
            with pytest.raises(HTTPException) as error:
                await registry.patch(
                    learner_id=wrong_learner,
                    session_id=wrong_session.id,
                    patch=IcePatch(pc_id=answer.pc_id, candidates=[]),
                )
            assert error.value.status_code == 404
        await registry.patch(
            learner_id=learner,
            session_id=session.id,
            patch=IcePatch(
                pc_id=restarted.pc_id,
                candidates=[{"candidate": "candidate", "sdp_mid": "0", "sdp_mline_index": 0}],
            ),
        )
        assert FakeHandler.made[0].patches[0].candidates[0].candidate == "candidate"
    finally:
        await registry.shutdown()


async def test_shutdown_and_stale_pc(registry_factory):
    registry = registry_factory(
        settings=VoiceSettings(providers="fake"), sessions=None, start_bot=idle
    )
    learner = uuid4()
    session = row(learner)
    answer = await registry.offer(
        learner_id=learner, session=session, body=OfferBody(sdp="offer", type="offer")
    )
    task = registry.live_bot(learner).task
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert registry.live_bot(learner) is None
    with pytest.raises(VoiceConflict):
        await registry.offer(
            learner_id=learner,
            session=session,
            body=OfferBody(sdp="offer", type="offer", pc_id=answer.pc_id, restart_pc=True),
        )
    await registry.offer(
        learner_id=learner, session=session, body=OfferBody(sdp="offer", type="offer")
    )
    task = registry.live_bot(learner).task
    await registry.shutdown()
    assert task.done() and registry.live_bot(learner) is None
    assert all(c.closed for h in FakeHandler.made for c in h.connections)


async def test_turn_credentials_reach_handler(registry_factory):
    settings = VoiceSettings(
        providers="fake",
        ice_servers=[
            IceServerConfig(
                urls=["turn:turn.example:443?transport=tcp"], username="u", credential="c"
            )
        ],
    )
    registry = registry_factory(settings=settings, sessions=None, start_bot=idle)
    learner = uuid4()
    try:
        await registry.offer(
            learner_id=learner, session=row(learner), body=OfferBody(sdp="offer", type="offer")
        )
        [ice] = FakeHandler.made[-1].ice_servers
        assert (ice.urls, ice.username, ice.credential) == (
            ["turn:turn.example:443?transport=tcp"],
            "u",
            "c",
        )
    finally:
        await registry.shutdown()


async def test_replacement_refuses_when_old_bot_ignores_cancellation(registry_factory, monkeypatch):
    monkeypatch.setattr("tassel.voice.registry.STOP_TIMEOUT_S", 0.02)
    release = asyncio.Event()
    started = asyncio.Event()

    async def slow_stop(connection, ctx):
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            await release.wait()

    registry = registry_factory(
        settings=VoiceSettings(providers="fake"), sessions=None, start_bot=slow_stop
    )
    learner = uuid4()
    try:
        await registry.offer(
            learner_id=learner, session=row(learner), body=OfferBody(sdp="offer", type="offer")
        )
        original = registry.live_bot(learner)
        await started.wait()
        with pytest.raises(VoiceConflict, match="still closing"):
            await registry.offer(
                learner_id=learner, session=row(learner), body=OfferBody(sdp="offer", type="offer")
            )
        assert registry.live_bot(learner) is original
        assert len(FakeHandler.made) == 1
        assert FakeHandler.made[0].connections[0].closed
    finally:
        release.set()
        await registry.shutdown()


async def test_shutdown_waits_for_offer_and_refuses_late_success(registry_factory, monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()
    original = FakeHandler.handle_web_request

    async def slow_answer(self, request, callback):
        entered.set()
        await release.wait()
        return await original(self, request, callback)

    monkeypatch.setattr(FakeHandler, "handle_web_request", slow_answer)
    registry = registry_factory(
        settings=VoiceSettings(providers="fake"), sessions=None, start_bot=idle
    )
    learner = uuid4()
    offering = asyncio.create_task(
        registry.offer(
            learner_id=learner, session=row(learner), body=OfferBody(sdp="offer", type="offer")
        )
    )
    await entered.wait()
    stopping = asyncio.create_task(registry.shutdown())
    await asyncio.sleep(0)
    release.set()
    try:
        with pytest.raises(VoiceConflict, match="shutting down"):
            await offering
        await stopping
        assert registry.live_bot(learner) is None
        assert all(c.closed for h in FakeHandler.made for c in h.connections)
    finally:
        await registry.shutdown()
        await asyncio.gather(offering, stopping, return_exceptions=True)
