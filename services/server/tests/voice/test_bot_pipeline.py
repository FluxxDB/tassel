import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    InputTransportMessageFrame,
    TTSAudioRawFrame,
    TTSStoppedFrame,
    TTSTextFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

from tassel.models import SessionCreate
from tassel.storage import sessions_repo
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import Learner
from tassel.voice.bot import BotContext, build_bot
from tassel.voice.fakes.scenario import load_scenario
from tassel.voice.memory import ConversationMemory
from tassel.voice.messages import OfferRequestData
from tassel.voice.settings import VoiceSettings

pytestmark = pytest.mark.asyncio
SCRIPT = load_scenario("dfa-opening")


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
            await self.push_frame(BotStoppedSpeakingFrame(), FrameDirection.UPSTREAM)

    def events(self):
        return [
            f.message["data"]["tassel"]
            for f in self.frames
            if isinstance(getattr(f, "message", None), dict)
            and f.message.get("type") == "server-message"
            and "tassel" in f.message.get("data", {})
        ]

    def text(self):
        return " ".join(f.text for f in self.frames if isinstance(f, TTSTextFrame))


async def until(predicate):
    async with asyncio.timeout(10):
        while not predicate():
            await asyncio.sleep(0.01)


def context(**kwargs):
    return BotContext(
        **{
            "learner_id": uuid4(),
            "session_id": uuid4(),
            "lang": "en",
            "titled": False,
            "request": OfferRequestData(),
            "settings": VoiceSettings(providers="fake", fake_tts="tone"),
            "memory": ConversationMemory(),
            "sessions": None,
            **kwargs,
        }
    )


async def message(bot, kind, data):
    await bot.worker.queue_frame(
        InputTransportMessageFrame(
            message={
                "label": "rtvi-ai",
                "type": kind,
                "id": str(uuid4()),
                "data": data,
            }
        )
    )


async def say(bot, text):
    await message(
        bot,
        "send-text",
        {
            "content": text,
            "options": {
                "run_immediately": True,
                "audio_response": True,
            },
        },
    )


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


async def test_greets_on_client_ready():
    async with running(context()) as (bot, out):
        await until(lambda: SCRIPT.langs["en"].greeting in out.text())
        assert out.events()[0] == {
            "kind": "route",
            "lang": "en",
            "stt": "fake",
            "llm": "fake",
            "tts": "fake",
        }
        assert any(isinstance(f, TTSAudioRawFrame) for f in out.frames)
        assert not any(m["role"] == "system" for m in bot.context.get_messages())


async def test_typed_reply_stage_memory_and_resume():
    ctx = context()
    async with running(ctx) as (bot, out):
        await until(lambda: SCRIPT.langs["en"].greeting in out.text())
        await say(bot, SCRIPT.langs["en"].student[0])
        await until(lambda: SCRIPT.langs["en"].turns[0].say in out.text())
        await say(bot, SCRIPT.langs["en"].student[1])
        await until(lambda: {"kind": "stage", "view": "split"} in out.events())
        await until(
            lambda: any(
                m.get("role") == "tool" and m.get("content") != "IN_PROGRESS"
                for m in bot.context.get_messages()
            )
        )
    saved, lang = ctx.memory.recall(ctx.session_id)
    assert lang == "en" and any(m.get("role") == "user" for m in saved)
    assert not any(m["role"] == "system" for m in saved)
    async with running(ctx) as (bot, out):
        await asyncio.sleep(0.4)
        assert out.text() == ""
        await say(bot, "Something else")
        await until(lambda: SCRIPT.langs["en"].fallback in out.text())


async def test_controls_invalid_messages_and_vad():
    ctx = context(request=OfferRequestData(ptt=True))
    async with running(ctx) as (bot, out):
        await message(
            bot,
            "client-message",
            {"t": "tassel", "d": {"kind": "ptt", "enabled": False, "held": True}},
        )
        await until(lambda: bot.tuning.ptt_held)
        assert bot.tuning.ptt  # enabled cannot change mid-connection
        await message(
            bot, "client-message", {"t": "tassel", "d": {"kind": "sensitivity", "level": "low"}}
        )
        await until(lambda: bot.tuning.sensitivity == "low")
        await message(bot, "client-message", {"t": "tassel", "d": {"kind": "ptt", "held": "yes"}})
        await bot.worker.queue_frame(VADUserStartedSpeakingFrame())
        await bot.worker.queue_frame(VADUserStoppedSpeakingFrame())
        await until(lambda: len([e for e in out.events() if e["kind"] == "vad"]) == 2)
        assert bot.tuning.ptt_held


async def test_language_change_after_reconnect_acknowledges():
    ctx = context(lang="ko")
    ctx.memory.remember(
        ctx.session_id,
        [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"}],
        "en",
    )
    async with running(ctx) as (_, out):
        await until(lambda: SCRIPT.langs["ko"].after_switch in out.text())


async def test_set_language_changes_services_and_next_reply_mid_session(db_url):
    engine = make_engine(db_url)
    sessions = session_factory(engine)
    try:
        async with sessions() as db:
            learner = Learner()
            db.add(learner)
            await db.commit()
            row = await sessions_repo.create(
                db, learner.id, SessionCreate(type="studying", source="talk", language="en")
            )
            ctx = context(learner_id=learner.id, session_id=row.id, sessions=sessions)
        async with running(ctx) as (bot, out):
            await until(lambda: SCRIPT.langs["en"].greeting in out.text())
            original_stt = bot.stt_service
            await say(bot, "Can we continue in Korean?")
            await until(lambda: {"kind": "language", "lang": "ko"} in out.events())
            assert bot.route.lang == "ko" and bot.route.stt == "nova-3"
            assert bot.stt_service is not original_stt
            assert bot.tts_service._lang == "ko"
            assert bot.tuning is not None
            async with sessions() as db:
                assert (
                    await sessions_repo.get_for(db, ctx.learner_id, ctx.session_id)
                ).language == "ko"
            await bot.worker.queue_frame(VADUserStartedSpeakingFrame())
            await asyncio.sleep(0.15)
            await bot.worker.queue_frame(VADUserStoppedSpeakingFrame())
            await until(lambda: SCRIPT.langs["ko"].turns[0].say in out.text())
            await say(bot, "왜 죽은 상태가 필요해요?")
            await until(lambda: SCRIPT.langs["ko"].turns[1].say in out.text())
        assert ctx.memory.recall(ctx.session_id)[1] == "ko"
    finally:
        await engine.dispose()


async def test_one_latest_image_per_turn_reaches_fake_llm():
    async with running(context()) as (bot, out):
        await until(lambda: SCRIPT.langs["en"].greeting in out.text())
        bot.add_turn_image(b"old", "old page")
        bot.add_turn_image(b"new", "Paper with numbered candidates")
        await say(bot, SCRIPT.langs["en"].student[0])
        await until(lambda: SCRIPT.langs["en"].turns[0].say in out.text())
        users = [m for m in bot.context.get_messages() if m["role"] == "user"]
        blocks = users[-1]["content"]
        assert [b["image_url"]["url"] for b in blocks if b["type"] == "image_url"] == [
            "data:image/png;base64,bmV3"
        ]
        assert any(b.get("text") == "Paper with numbered candidates" for b in blocks)
        await say(bot, "Something else")
        await until(lambda: SCRIPT.langs["en"].fallback in out.text())
        users = [m for m in bot.context.get_messages() if m["role"] == "user"]
        assert users[-1]["content"] == "Something else"
        assert not any(
            b.get("type") == "image_url"
            for m in users
            if isinstance(m["content"], list)
            for b in m["content"]
        )


async def test_provider_fallback_is_reported_with_measured_completion(monkeypatch):
    from tassel.voice.fakes.llm import FakeLLMService

    class FallbackLLM(FakeLLMService):
        active_provider = "openrouter"
        last_completion = None

        async def process_frame(self, frame, direction):
            from pipecat.frames.frames import LLMContextFrame

            if isinstance(frame, LLMContextFrame):
                self.active_provider = "openai"
                self.last_completion = {
                    "provider": "openai",
                    "model": "gpt-4.1-mini",
                    "ttfb_ms": 123.4,
                }
            await super().process_frame(frame, direction)

    monkeypatch.setattr(
        "tassel.voice.bot.make_llm",
        lambda route, settings, scenario: FallbackLLM(scenario=scenario, lang=route.lang),
    )
    async with running(context()) as (bot, out):
        await until(lambda: len([e for e in out.events() if e["kind"] == "route"]) == 2)
        routes = [e for e in out.events() if e["kind"] == "route"]
        assert [e["llm"] for e in routes] == ["openrouter", "openai"]
        assert bot.active_provider == "openai"
        assert bot.last_completion["model"] == "gpt-4.1-mini"
        assert bot.last_completion["ttfb_ms"] == 123.4


async def test_run_bot_disconnects_after_build_failure(monkeypatch):
    from unittest.mock import AsyncMock, Mock

    from tassel.voice.bot import run_bot

    connection = Mock(disconnect=AsyncMock())
    monkeypatch.setattr("tassel.voice.bot.SmallWebRTCTransport", Mock())
    monkeypatch.setattr(
        "tassel.voice.bot.build_bot", Mock(side_effect=ValueError("invalid config"))
    )
    with pytest.raises(ValueError, match="invalid config"):
        await run_bot(connection, context())
    connection.disconnect.assert_awaited_once()


async def test_failed_language_factory_reports_fatal_error():
    from pipecat.frames.frames import ErrorFrame
    from pipecat.tests.utils import run_test

    from tassel.voice.bot import _LanguageChange, _RoutedService
    from tassel.voice.fakes.stt import FakeSTTService

    def factory(lang):
        if lang == "ko":
            raise ValueError("unavailable")
        return FakeSTTService(lines=["hello"], lang=lang)

    down, up = await asyncio.wait_for(
        run_test(
            _RoutedService(factory, "en"),
            frames_to_send=[_LanguageChange(lang="ko")],
            send_end_frame=False,
        ),
        3,
    )
    errors = [f for f in [*down, *up] if isinstance(f, ErrorFrame)]
    assert any(f.fatal for f in errors)


async def test_scripted_crash_saves_memory():
    ctx = context()
    async with running(ctx) as (bot, out):
        await until(lambda: SCRIPT.langs["en"].greeting in out.text())
        await say(bot, "/drop")
        await until(lambda: bot.worker.has_finished())
    messages, lang = ctx.memory.recall(ctx.session_id)
    assert lang == "en"
    assert any(m.get("content") == "/drop" for m in messages)
