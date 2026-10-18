import asyncio
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.tests.utils import run_test

from tassel.beats.markup import BoardContext
from tassel.voice.settings import VoiceSettings
from tassel.voice.thinker import GuidanceBrief, Thinker, ThinkerOutput, TutorCoordinator


def brief(**changes):
    return GuidanceBrief.model_validate(
        dict(
            page="Language for 0101?; q0-0-q1-1-q2-0-q3*",
            intent="check",
            diagnosis="Missing final 1",
            plan=["Trace the last symbol"],
            say="Which arrow reads the final one?",
            board=[],
            paper=[],
            confidence=0.95,
            followups=["q3 accepts too soon"],
            **changes,
        )
    )


class FakeThinker:
    def __init__(self, gate=None):
        self.calls = 0
        self.active = self.peak = 0
        self.gate = gate

    async def think(self, messages):
        self.calls += 1
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            if self.gate:
                await self.gate.wait()
            return brief()
        finally:
            self.active -= 1

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_fake_talker_consult_stream_speaks_bridge_then_brief_same_turn():
    thinker = FakeThinker()
    coordinator = TutorCoordinator(thinker, BoardContext())
    await coordinator.prepare(LLMContext([{"role": "user", "content": "Help me"}]), "Help me")
    output = ThinkerOutput(coordinator)
    # Fake talker's streamed response, including a split control tag.
    frames, _ = await run_test(
        output,
        frames_to_send=[
            LLMFullResponseStartFrame(),
            LLMTextFrame("[[con"),
            LLMTextFrame("sult]]Let me look at your arrows. "),
            LLMFullResponseEndFrame(),
        ],
    )
    words = "".join(f.text for f in frames if isinstance(f, LLMTextFrame))
    assert words == "Let me look at your arrows. Which arrow reads the final one?"
    assert thinker.calls == 1 and "consult" not in words
    assert isinstance(frames[-1], LLMFullResponseEndFrame)
    await coordinator.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    ["draw it", "mark this", "highlight that", "check this", "find a mistake", "explain why"],
)
async def test_intent_triggers(text):
    thinker = FakeThinker()
    c = TutorCoordinator(thinker, BoardContext())
    await c.prepare(LLMContext([{"role": "user", "content": text}]), text)
    assert await c.result() is not None
    assert thinker.calls == 1
    await c.close()


def page(extra=False):
    image = np.full((200, 200), 255, np.uint8)
    cv2.line(image, (10, 30), (180, 30), 0, 4)
    if extra:
        cv2.line(image, (10, 100), (180, 100), 0, 4)
    return cv2.imencode(".png", image)[1].tobytes()


@pytest.mark.asyncio
async def test_notes_reused_expire_and_meaningful_page_change_triggers():
    thinker = FakeThinker()
    c = TutorCoordinator(thinker, BoardContext())
    context = LLMContext([{"role": "user", "content": "check"}])
    await c.prepare(context, "check", page())
    await c.result()
    await c.prepare(context, "why that state?", page())
    assert thinker.calls == 1
    assert "Missing final 1" in str(context.get_messages())
    await c.prepare(context, "what next?", page(True))
    assert "Missing final 1" not in str(context.get_messages())
    await c.result()
    assert thinker.calls == 2
    await c.close()


@pytest.mark.asyncio
async def test_new_trigger_supersedes_without_overlapping_calls():
    gate = asyncio.Event()
    thinker = FakeThinker(gate)
    c = TutorCoordinator(thinker, BoardContext())
    context = LLMContext([])
    await c.prepare(context, "draw this")
    await asyncio.sleep(0)
    await c.prepare(context, "check this instead")
    gate.set()
    assert await c.result() is not None
    assert thinker.calls == 2 and thinker.peak == 1
    await c.close()


@pytest.mark.asyncio
async def test_invalid_json_retried_once_and_no_tools_sent():
    requests = []

    class Completions:
        async def create(self, **kwargs):
            requests.append(kwargs)
            content = "{}" if len(requests) == 1 else brief().model_dump_json()
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    thinker = Thinker(VoiceSettings(openai_api_key="fake"), client=client)
    assert (await thinker.think([{"role": "user", "content": "check"}])).say
    assert len(requests) == 2
    assert all(
        "tools" not in r and r["reasoning_effort"] == "low" and r["model"] == "gpt-6-luna"
        for r in requests
    )
    # Measured live on the owner's page: luna 3.1–4.6 s vs astra 7.4 s, same diagnosis.
    assert VoiceSettings().thinker_model == "gpt-6-luna"


def test_two_tier_defaults_require_both_keys_and_allow_opt_out():
    assert VoiceSettings(openai_api_key="a", openrouter_api_key="b").two_tier_enabled
    assert not VoiceSettings(openai_api_key="a").two_tier_enabled
    assert not VoiceSettings(
        openai_api_key="a", openrouter_api_key="b", two_tier=False
    ).two_tier_enabled


def test_bad_tags_dropped_and_my_paper_never_draws_on_board():
    from tassel.beats.models import (
        DetectedElement,
        DetectedElements,
        PaperElements,
        PaperFrame,
        PixelBox,
    )

    board = BoardContext(
        paper_frame=PaperFrame(kind="paper", id="frame", captured_at="now"),
        paper_elements=PaperElements(
            states={},
            edges={},
            detected=DetectedElements(
                width=200,
                height=200,
                items=[DetectedElement(id="m1", kind="circle", box=PixelBox(x=0, y=0, w=20, h=20))],
            ),
        ),
    )
    c = TutorCoordinator(FakeThinker(), board)
    c.text = "circle it on my paper"
    value = brief().model_copy(
        update={
            "board": ["[[dfa ex start=q0 accept=q1 q0-0-q1]]"],
            "paper": ["[[circle m1]]", "[[circle m999]]", "[[explode m1]]"],
        }
    )
    result = c.validate_tags(value)
    assert result.board == []
    assert result.paper == ["[[freeze]]", "[[circle m1]]"]
    assert board.next_mark == 1


@pytest.mark.asyncio
async def test_bot_wires_fake_talker_and_thinker(monkeypatch, tmp_path):
    from test_bot_pipeline import context, running, say, until

    import tassel.voice.bot as bot_module
    from tassel.voice.fakes.llm import FakeLLMService
    from tassel.voice.fakes.scenario import load_scenario

    class Talker(FakeLLMService):
        async def process_frame(self, frame, direction):
            from pipecat.frames.frames import LLMContextFrame

            if isinstance(frame, LLMContextFrame):
                if not any(m.get("role") == "user" for m in frame.context.get_messages()):
                    return
                await self.push_frame(LLMFullResponseStartFrame())
                await self.push_frame(LLMTextFrame("[[consult]]Let me look at your arrows. "))
                await self.push_frame(LLMFullResponseEndFrame())
            else:
                await super().process_frame(frame, direction)

    gate = asyncio.Event()
    fake = FakeThinker(gate)
    monkeypatch.setattr(bot_module, "make_thinker", lambda settings: fake)
    monkeypatch.setattr(
        bot_module,
        "make_llm",
        lambda *args: Talker(scenario=load_scenario("dfa-opening"), lang="en"),
    )
    ctx = context(
        settings=VoiceSettings(providers="fake", fake_tts="tone", transcript_dir=tmp_path)
    )
    async with running(ctx) as (bot, output):
        await say(bot, "Check this")
        await until(lambda: "arrows" in output.text())
        assert "final one" not in output.text()
        gate.set()
        await until(lambda: "final one" in output.text())
        assert "Let me look" in output.text()
        assert "consult" not in output.text()
        assert fake.calls == 1
        import json

        rows = [
            json.loads(line)
            for line in (tmp_path / f"{ctx.session_id}.jsonl").read_text().splitlines()
        ]
        assert {r["event"] for r in rows} >= {
            "student_final",
            "ada_spoken",
            "thinker_brief",
            "thinker_duration",
            "first_token",
            "first_audio",
        }


def test_spoken_guidance_cannot_bypass_tag_validation():
    c = TutorCoordinator(FakeThinker(), BoardContext())
    c.text = "on my paper"
    result = c.validate_tags(
        brief().model_copy(
            update={"say": "[[dfa ex start=q0 accept=q1 q0-0-q1]]Look here. [[explode]]"}
        )
    )
    assert result.say == "Look here. "
    assert not result.board


@pytest.mark.asyncio
async def test_superseded_result_waiter_never_delivers_old_guidance():
    gate = asyncio.Event()
    c = TutorCoordinator(FakeThinker(gate), BoardContext())
    await c.prepare(LLMContext([]), "check this")
    old_result = asyncio.create_task(c.result())
    await asyncio.sleep(0)
    await c.prepare(LLMContext([]), "draw something else")
    gate.set()
    assert await old_result is None
    assert await c.result() is not None
    await c.close()


@pytest.mark.asyncio
async def test_notes_expire_with_time_and_keep_older_summaries():
    c = TutorCoordinator(FakeThinker(), BoardContext())
    context = LLMContext([])
    for _ in range(2):
        await c.prepare(context, "check this")
        await c.result()
    assert len(c.notes) == 2
    assert str(context.get_messages()).count("Missing final 1") == 2
    c.expires = 0
    await c.prepare(context, "what next?")
    assert not c.notes and "Missing final 1" not in str(context.get_messages())
    await c.close()


@pytest.mark.asyncio
async def test_failed_thinker_speaks_failure_after_bridge():
    class FailedThinker(FakeThinker):
        async def think(self, messages):
            raise TimeoutError("secret provider details")

    c = TutorCoordinator(FailedThinker(), BoardContext())
    await c.prepare(LLMContext([]), "check")
    frames, _ = await run_test(
        ThinkerOutput(c),
        frames_to_send=[
            LLMFullResponseStartFrame(),
            LLMTextFrame("Let me check. "),
            LLMFullResponseEndFrame(),
        ],
    )
    spoken = "".join(f.text for f in frames if isinstance(f, LLMTextFrame))
    assert "couldn't finish checking" in spoken
    assert "secret provider details" not in spoken
    await c.close()
