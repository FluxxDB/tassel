import pytest
from pipecat.frames.frames import (
    CancelWorkerFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.tests.utils import SleepFrame, run_test

from tassel.voice.fakes.llm import FakeLLMService
from tassel.voice.fakes.scenario import load_scenario


@pytest.mark.asyncio
async def test_fake_llm_streams_the_reply_and_calls_the_tool():
    dfa = load_scenario("dfa-opening")
    llm = FakeLLMService(scenario=dfa, lang="en", ttfb_ms=0)
    assert llm.can_generate_metrics()
    received = []

    async def show_stage(params):
        received.append(params.arguments)
        await params.result_callback({"ok": True})

    llm.register_function("show_stage", show_stage)
    down, _ = await run_test(
        llm,
        frames_to_send=[
            LLMContextFrame(LLMContext([{"role": "user", "content": "I think that's it. …"}])),
            SleepFrame(0.1),
        ],
    )
    reply = [
        f
        for f in down
        if isinstance(f, (LLMFullResponseStartFrame, LLMTextFrame, LLMFullResponseEndFrame))
    ]
    assert isinstance(reply[0], LLMFullResponseStartFrame)
    assert isinstance(reply[-1], LLMFullResponseEndFrame)
    chunks = [f.text for f in reply if isinstance(f, LLMTextFrame)]
    assert "".join(chunks) == dfa.langs["en"].turns[1].say
    assert all(len(chunk.split()) <= 3 for chunk in chunks)
    assert received == [{"view": "split"}]


@pytest.mark.asyncio
async def test_fake_llm_drop_cancels_the_worker():
    down, up = await run_test(
        FakeLLMService(scenario=load_scenario("dfa-opening"), lang="en", ttfb_ms=0),
        frames_to_send=[LLMContextFrame(LLMContext([{"role": "user", "content": "/drop"}]))],
        send_end_frame=False,
    )
    assert any(isinstance(f, CancelWorkerFrame) and f.reason == "scripted drop" for f in up)
    assert not any(isinstance(f, LLMTextFrame) for f in down)


@pytest.mark.asyncio
async def test_fake_llm_uses_context_history_after_tool_results():
    dfa = load_scenario("dfa-opening")
    s = dfa.langs["en"]
    context = LLMContext(
        [
            {"role": "user", "content": s.student[0]},
            {"role": "assistant", "content": s.turns[0].say},
            {"role": "assistant", "content": None, "tool_calls": []},
            {"role": "tool", "content": "ok", "tool_call_id": "old"},
        ]
    )
    down, _ = await run_test(
        FakeLLMService(scenario=dfa, lang="en", ttfb_ms=0),
        frames_to_send=[LLMContextFrame(context)],
    )
    assert "".join(f.text for f in down if isinstance(f, LLMTextFrame)) == s.fallback


def test_fake_llm_rejects_zero_chunk_size():
    with pytest.raises(ValueError):
        FakeLLMService(scenario=load_scenario("ptt"), lang="en", chunk_words=0)
