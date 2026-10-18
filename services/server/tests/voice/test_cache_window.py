"""Cache-friendly histories (owner, 2026-10-18: "the agent takes too long"). The provider reuses a
prompt's work only for an unchanged prefix. A window that drops the oldest exchange every turn
changes the message after the system prompt every turn: only the system prompt was cached (38% of
the thinker's tokens). Trimmed in blocks, the window's start holds for several turns, and it never
keeps more than before."""

import asyncio

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_cost_and_tokens import _history
from test_ladder import Recording, paper

from tassel.beats.markup import BoardContext
from tassel.voice.history import windowed
from tassel.voice.providers import TALKER_WINDOW, TALKER_WINDOW_STEP
from tassel.voice.thinker import THINKER_WINDOW, THINKER_WINDOW_STEP, TutorCoordinator


def asked(turns):
    """The history as a turn sends it: her latest question last."""
    return [*_history(turns), {"role": "user", "content": f"question {turns}"}]


def conversation(window):
    return [m for m in window if m.get("role") != "system"]


def test_a_step_of_one_is_the_old_window():
    for turns in range(0, 30):
        assert windowed(asked(turns), 12, step=1) == windowed(asked(turns), 12)


@pytest.mark.parametrize(("keep", "step"), [(12, 6), (16, 8)])
def test_a_blocked_window_holds_its_start_and_never_grows(keep, step):
    starts = []
    for turns in range(10, 34):
        kept = conversation(windowed(asked(turns), keep, step=step))
        assert len(kept) <= keep
        assert len(kept) >= keep - step  # Never much less than before.
        assert kept[0]["role"] == "user" and kept[-1]["content"] == f"question {turns}"
        starts.append(kept[0]["content"])
    # The old window started somewhere new on every one of these 24 turns.
    assert len(set(starts)) <= 24 // (step // 2) + 1


def test_the_windows_steps():
    assert 1 < THINKER_WINDOW_STEP <= THINKER_WINDOW // 2
    assert 1 < TALKER_WINDOW_STEP <= TALKER_WINDOW // 2


@pytest.mark.asyncio
async def test_consecutive_thinker_turns_share_their_history_prefix():
    thinker = Recording()
    c = TutorCoordinator(thinker, BoardContext())
    shared = []
    for turns in range(12, 20):
        history = asked(turns)
        await c.prepare(LLMContext(history), history[-1]["content"], decision=paper())
        await c.result()
    for before, after in zip(thinker.seen, thinker.seen[1:], strict=False):
        shared.append(before[1] == after[1])  # The message after the system prompt.
    # The old window changed it on every turn.
    assert sum(shared) >= len(shared) // 2
    await c.close()


def test_the_thinker_asks_the_provider_to_keep_one_sessions_prefix_together():
    from test_retest7_fixes import _recording_thinker

    thinker, requests = _recording_thinker()
    asyncio.run(thinker.think([{"role": "user", "content": "first"}]))
    asyncio.run(thinker.think([{"role": "user", "content": "second"}]))
    other, others = _recording_thinker()
    asyncio.run(other.think([{"role": "user", "content": "first"}]))
    key = requests[0]["prompt_cache_key"]
    assert key and requests[1]["prompt_cache_key"] == key
    assert others[0]["prompt_cache_key"] != key
