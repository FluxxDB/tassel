"""The whole chat loop on the server (integration): an image uploaded through the API, a typed
``student-message`` into the voice bot on fake providers, the ``message`` events it answers
with, and the saved conversation the history route returns afterwards.

It needs the bot wired to the chat store (claude/chat-server's typed turns), so it skips until
``BotContext`` carries a ``ChatStore``.
"""

import asyncio
import dataclasses
import io
import uuid
from contextlib import asynccontextmanager

import pytest
from PIL import Image
from pipecat.frames.frames import InputTransportMessageFrame, TTSAudioRawFrame, TTSStoppedFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

from tassel.chat.store import ChatStore
from tassel.storage.db import make_engine, session_factory
from tassel.voice.bot import BotContext, build_bot
from tassel.voice.fakes.scenario import load_scenario
from tassel.voice.memory import ConversationMemory
from tassel.voice.messages import OfferRequestData
from tassel.voice.settings import VoiceSettings

pytestmark = pytest.mark.asyncio

CHAT_FIELD = next(
    (
        f.name
        for f in dataclasses.fields(BotContext)
        if f.type is ChatStore or "ChatStore" in str(f.type)
    ),
    None,
)
if CHAT_FIELD is None:
    pytest.skip(
        "needs claude/chat-server's bot wiring: a ChatStore field on BotContext",
        allow_module_level=True,
    )

SCRIPT = load_scenario("dfa-board")
EN = SCRIPT.langs["en"]
NEW_SESSION = {"type": "homework", "language": "en", "source": "talk"}


def picture(width, height) -> bytes:
    image = Image.new("RGB", (width, height), (40, 120, 200))
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


class Passthrough(FrameProcessor):
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)


class Recorder(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.frames = []

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        self.frames.append(frame)
        await self.push_frame(frame, direction)
        if isinstance(frame, TTSStoppedFrame):
            from pipecat.frames.frames import BotStoppedSpeakingFrame

            await self.push_frame(BotStoppedSpeakingFrame(), FrameDirection.UPSTREAM)

    def events(self):
        return [
            f.message["data"]["tassel"]
            for f in self.frames
            if isinstance(getattr(f, "message", None), dict)
            and f.message.get("type") == "server-message"
            and "tassel" in f.message.get("data", {})
        ]

    def messages(self):
        return [e for e in self.events() if e["kind"] == "message"]

    def audio_count(self):
        return sum(isinstance(f, TTSAudioRawFrame) for f in self.frames)


async def until(predicate, timeout=10):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


async def message(bot, kind, data):
    await bot.worker.queue_frame(
        InputTransportMessageFrame(
            message={"label": "rtvi-ai", "type": kind, "id": str(uuid.uuid4()), "data": data}
        )
    )


async def student_message(bot, text, attachment_ids=(), voice=True, client_id=None):
    client_id = client_id or f"c-{uuid.uuid4()}"
    await message(
        bot,
        "client-message",
        {
            "t": "tassel",
            "d": {
                "kind": "student-message",
                "client_id": client_id,
                "text": text,
                "attachment_ids": list(attachment_ids),
                "voice": voice,
            },
        },
    )
    return client_id


@asynccontextmanager
async def running(ctx):
    output = Recorder()
    bot = build_bot(Passthrough(), output, ctx)
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(bot.worker)
    task = asyncio.create_task(runner.run())
    try:
        await message(bot, "client-ready", {"version": "2.1.0"})
        await until(lambda: output.events())
        yield bot, output
    finally:
        await bot.worker.cancel()
        await asyncio.wait_for(task, 10)


async def auth(client) -> dict[str, str]:
    token = (await client.post("/v1/devices")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def test_typed_turn_with_an_image_voice_off_and_the_history_after(client, app, db_url):
    headers = await auth(client)
    learner_id = uuid.UUID((await client.get("/v1/me", headers=headers)).json()["learner_id"])
    r = await client.post("/v1/sessions", json=NEW_SESSION, headers=headers)
    session_id = uuid.UUID(r.json()["id"])
    r = await client.post(
        f"/v1/sessions/{session_id}/attachments",
        files={"image": ("blob", picture(320, 200), "image/png")},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    attachment = r.json()

    engine = make_engine(db_url)
    try:
        chat = ChatStore(session_factory(engine), app.state.object_store)
        ctx = BotContext(
            learner_id=learner_id,
            session_id=session_id,
            lang="en",
            titled=False,
            request=OfferRequestData(scenario="dfa-board"),
            settings=VoiceSettings(providers="fake", fake_tts="tone"),
            memory=ConversationMemory(),
            sessions=session_factory(engine),
            **{CHAT_FIELD: chat},
        )
        async with running(ctx) as (bot, out):
            # Her greeting is a voice tutor line, streamed then final.
            await until(lambda: any(m["final"] and m["role"] == "tutor" for m in out.messages()))
            greeting = next(m for m in out.messages() if m["final"])
            assert greeting["source"] == "voice" and EN.greeting in greeting["text"]
            assert greeting["client_id"] is None and greeting["attachments"] == []
            heard = out.audio_count()

            # A typed line with the image, voice on: the student echo carries the client_id and
            # the image's size; Ada's reply is `typed`, and she draws, which adds an action row.
            client_id = await student_message(bot, EN.student[0], [attachment["id"]])
            await until(lambda: any(m["client_id"] == client_id for m in out.messages()))
            echo = next(m for m in out.messages() if m["client_id"] == client_id)
            assert echo["role"] == "student" and echo["source"] == "typed" and echo["final"]
            assert echo["text"] == EN.student[0]
            assert echo["attachments"] == [attachment]
            await until(
                lambda: any(
                    m["final"] and m["role"] == "tutor" and EN.turns[0].say in m["text"]
                    for m in out.messages()
                ),
                timeout=20,
            )
            reply = next(m for m in out.messages() if m["final"] and EN.turns[0].say in m["text"])
            assert reply["source"] == "typed" and reply["interrupted"] is False
            await until(lambda: any(m["role"] == "action" for m in out.messages()), timeout=20)
            row = next(m for m in out.messages() if m["role"] == "action")
            assert row["source"] is None and row["text"] == "" and row["attachments"] == []
            assert row["action"]["kind"] == "draw" and row["action"]["side"] == "board"
            assert row["action"]["attachment_id"] is None
            await until(lambda: out.audio_count() > heard)

            # Voice off: a text-only reply, message events and no audio.
            await until(
                lambda: (
                    not any(m["role"] == "tutor" and not m["final"] for m in out.messages()[-1:])
                ),
                timeout=20,
            )
            heard = out.audio_count()
            before = len(out.messages())
            client_id = await student_message(bot, "Something else entirely", voice=False)
            await until(
                lambda: any(
                    m["final"] and m["role"] == "tutor" and EN.fallback in m["text"]
                    for m in out.messages()[before:]
                ),
                timeout=20,
            )
            await asyncio.sleep(0.3)
            assert out.audio_count() == heard
            text_only = [m for m in out.messages()[before:] if m["role"] == "tutor"]
            assert text_only and all(m["source"] == "typed" for m in text_only)
            finals = [m for m in out.messages() if m["final"]]
        # Let the last writes land before reading the history.
        await asyncio.sleep(0.2)
    finally:
        await engine.dispose()

    r = await client.get(f"/v1/sessions/{session_id}/messages", headers=headers)
    assert r.status_code == 200
    saved = r.json()["messages"]
    # Finals only, oldest first, each as its event carried it.
    assert [m["id"] for m in saved] == [m["id"] for m in finals]
    assert saved[0]["role"] == "tutor" and saved[0]["source"] == "voice"
    with_image = next(m for m in saved if m["role"] == "student")
    assert with_image["attachments"] == [attachment]
    assert with_image["client_id"] == echo["client_id"]
    assert any(m["role"] == "action" and m["action"]["kind"] == "draw" for m in saved)
    assert all("created_at" in m for m in saved)
