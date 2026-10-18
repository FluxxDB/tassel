"""Token and cost work (owner, 2026-10-18 01:30: "token optimization and cost"; speed first, meter
and log only): a lean talker prompt, bounded histories, director calls only when needed, and a
per-session usage meter in the dev transcript."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from pipecat.frames.frames import MetricsFrame
from pipecat.metrics.metrics import (
    LLMTokenUsage,
    LLMUsageMetricsData,
    STTUsage,
    STTUsageMetricsData,
    TTSUsageMetricsData,
)
from pipecat.observers.base_observer import FramePushed
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection

from tassel.voice.cost import CostMeter
from tassel.voice.director import Director
from tassel.voice.prompts import BOARD_RULES, TALKER_RULES, system_prompt
from tassel.voice.providers import windowed

# --- The talker never draws under two-tier, so it never carries the drawing manual -----------


def test_two_tier_talker_prompt_drops_the_board_manual():
    lean = system_prompt("en", two_tier=True)
    full = system_prompt("en")
    assert BOARD_RULES not in lean and "[[dfa ITEM" not in lean
    assert TALKER_RULES in lean
    assert len(lean) < len(full) - 1500


def test_talker_prompt_is_stable_between_turns():
    # A byte-identical prefix is what lets the provider's prompt cache hit.
    assert system_prompt("en", two_tier=True) == system_prompt("en", two_tier=True)


# --- Bounded histories ------------------------------------------------------------------------


def _history(turns):
    messages = [{"role": "system", "content": "persona"}]
    for i in range(turns):
        messages += [
            {"role": "user", "content": f"question {i}"},
            {"role": "assistant", "content": f"answer {i}"},
        ]
    return messages


def test_window_keeps_the_system_prompt_and_recent_turns_from_a_user_message():
    out = windowed(_history(30), 16)
    assert out[0] == {"role": "system", "content": "persona"}
    rest = out[1:]
    assert len(rest) <= 16 and rest[0]["role"] == "user"
    assert rest[-1]["content"] == "answer 29"


def test_window_keeps_late_app_notes():
    messages = [*_history(30), {"role": "system", "content": "[director] board"}]
    out = windowed(messages, 16)
    assert out[-1]["content"] == "[director] board"


@pytest.mark.asyncio
async def test_thinker_sees_a_bounded_history():
    from test_two_tier import brief

    from tassel.beats.markup import BoardContext
    from tassel.voice.director import Decision
    from tassel.voice.thinker import TutorCoordinator

    seen = []

    class Thinker:
        async def think(self, messages, effort=None):
            seen.append(messages)
            return brief()

        async def close(self):
            pass

    c = TutorCoordinator(Thinker(), BoardContext())
    decision = Decision(
        focus="board", needs_vision=False, route="thinker", action="explain", refers_to="board"
    )
    await c.prepare(LLMContext(_history(30)), "why?", decision=decision)
    await c.result()
    turns = [m for m in seen[0] if m.get("role") in ("user", "assistant")]
    assert len(turns) <= 12
    await c.close()


# --- The director skips its model call when the rules are certain ------------------------------


class _Refusing:
    def __init__(self):
        self.calls = 0

    async def create(self, **kw):
        self.calls += 1
        raise AssertionError("no model call expected")


@pytest.mark.parametrize(
    "text,action",
    [
        ("Hi, can you hear me?", "none"),
        ("Thanks!", "none"),
        ("Can you circle it on my paper?", "mark_paper"),
        ("Draw it on the whiteboard.", "draw_board"),
    ],
)
def test_certain_turns_make_no_director_call(text, action):
    completions = _Refusing()
    director = Director(client=SimpleNamespace(chat=SimpleNamespace(completions=completions)))
    out = asyncio.run(director.decide(text, []))
    assert completions.calls == 0 and out.action == action


def test_ambiguous_turns_still_ask_the_model():
    completions = _Refusing()
    director = Director(client=SimpleNamespace(chat=SimpleNamespace(completions=completions)))
    asyncio.run(director.decide("what about this one here", []))
    assert completions.calls == 1


# --- The usage meter ----------------------------------------------------------------------------


def test_meter_sums_usage_without_secret_looking_keys():
    meter = CostMeter()
    meter.llm("qwen/qwen3.8-27b", prompt=2000, cached=1024, completion=40)
    meter.llm("qwen/qwen3.8-27b", prompt=1000, cached=0, completion=10)
    meter.llm("gpt-6-luna", prompt=5000, cached=4096, completion=300)
    meter.tts(120)
    meter.stt(15.5)
    summary = meter.summary()
    assert summary["llm"]["qwen/qwen3.8-27b"] == {
        "calls": 2,
        "prompt": 3000,
        "cached": 1024,
        "completion": 50,
    }
    assert summary["tts_chars"] == 120 and summary["stt_seconds"] == 15.5
    # The dev transcript drops any key containing "token"; the meter must survive it.
    assert "token" not in json.dumps(list(_keys(summary)))
    assert "usd" not in summary  # no prices configured: usage only


def test_meter_prices_when_configured():
    meter = CostMeter(prices={"gpt-6-luna": {"prompt": 1.0, "cached": 0.1, "completion": 4.0}})
    meter.llm("gpt-6-luna", prompt=1_000_000, cached=500_000, completion=1_000_000)
    # (1M - 0.5M) * 1.0 + 0.5M * 0.1 + 1M * 4.0, per million tokens.
    assert meter.summary()["usd"] == pytest.approx(0.5 + 0.05 + 4.0)


def _keys(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from _keys(v)


@pytest.mark.asyncio
async def test_transcript_meters_pipeline_usage_metrics(tmp_path):
    from uuid import uuid4

    from tassel.voice.transcripts import DevTranscript

    transcript = DevTranscript(uuid4(), tmp_path)
    frame = MetricsFrame(
        data=[
            LLMUsageMetricsData(
                processor="llm",
                model="qwen/qwen3.8-27b",
                value=LLMTokenUsage(
                    prompt_tokens=2351,
                    completion_tokens=48,
                    total_tokens=2399,
                    cache_read_input_tokens=1024,
                ),
            ),
            TTSUsageMetricsData(processor="tts", model="eleven", value=59),
            STTUsageMetricsData(processor="stt", model="flux", value=STTUsage(audio_seconds=6.0)),
        ]
    )
    await transcript.on_push_frame(
        FramePushed(
            source=None,
            destination=None,
            frame=frame,
            direction=FrameDirection.DOWNSTREAM,
            timestamp=0,
        )
    )
    summary = transcript.meter.summary()
    assert summary["llm"]["qwen/qwen3.8-27b"]["prompt"] == 2351
    assert summary["tts_chars"] == 59 and summary["stt_seconds"] == 6.0
    transcript.record_cost()
    lines = [json.loads(line) for line in transcript.path.read_text().splitlines()]
    assert lines[-1]["event"] == "cost" and lines[-1]["llm"]["qwen/qwen3.8-27b"]["cached"] == 1024


def test_role_prefixed_keys_use_the_model_price():
    meter = CostMeter(prices={"gpt-6-luna": {"prompt": 2.0, "completion": 0.0}})
    meter.llm("thinker:gpt-6-luna", prompt=1_000_000)
    assert meter.summary()["usd"] == pytest.approx(2.0)


def test_director_and_thinker_report_usage():
    from tassel.voice.director import report_usage

    seen = []
    response = SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=300,
            completion_tokens=20,
            prompt_tokens_details=SimpleNamespace(cached_tokens=256),
        )
    )
    report_usage(lambda m, **k: seen.append((m, k)), "director:qwen", response)
    assert seen == [("director:qwen", {"prompt": 300, "cached": 256, "completion": 20})]
