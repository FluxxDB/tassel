import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_two_tier import FakeThinker, brief

from tassel.beats.markup import BoardContext
from tassel.voice.action_checker import TargetLanguage, check_tags
from tassel.voice.director import rules
from tassel.voice.thinker import TutorCoordinator

WRONG = "[[dfa ex start=q0 accept=q0 q0-0,1-q0]]"
RIGHT = "[[dfa ex start=q0 accept=q1 q0-0-q1]]"
TARGET = TargetLanguage(regex="0", alphabet=["0", "1"])


def test_mismatched_action_and_stage_dropped_without_mutating_board():
    board = BoardContext()
    result = check_tags([WRONG, "[[stage board]]"], rules("draw on my camera feed"), board)
    assert result.tags == []
    assert not board.specs


def test_exact_verifier_rejects_wrong_language_and_accepts_right():
    decision = rules("draw it on the board")
    bad = check_tags([WRONG], decision, BoardContext(), TARGET)
    assert not bad.tags and bad.repair
    assert check_tags([RIGHT], decision, BoardContext(), TARGET).tags == [RIGHT]


def test_large_board_skipped_and_edge_edits_checked():
    decision = rules("draw it on the board")
    large = "[[dfa ex start=q0 accept=q9 " + " ".join(f"q{i}-0-q{i + 1}" for i in range(9)) + "]]"
    assert not check_tags([large], decision, BoardContext()).tags
    assert not check_tags([RIGHT, "[[edge ex q1 q1 0]]"], decision, BoardContext(), TARGET).tags


@pytest.mark.asyncio
@pytest.mark.parametrize("fixed", [True, False])
async def test_wrong_dfa_gets_one_repair_then_is_drawn_or_skipped(fixed):
    class Repairer(FakeThinker):
        async def think(self, messages):
            self.calls += 1
            tag = RIGHT if fixed and self.calls == 2 else WRONG
            return brief().model_copy(update={"board": [tag], "language": TARGET})

    thinker = Repairer()
    coordinator = TutorCoordinator(thinker, BoardContext())
    await coordinator.prepare(
        LLMContext([]), "draw on the board", decision=rules("draw on the board")
    )
    result = await coordinator.result()
    assert thinker.calls == 2
    assert result.board == ([RIGHT] if fixed else [])
    await coordinator.close()


@pytest.mark.asyncio
async def test_talker_cannot_bypass_director_with_split_tags():
    from pipecat.frames.frames import (
        LLMFullResponseEndFrame,
        LLMFullResponseStartFrame,
        LLMTextFrame,
    )
    from pipecat.tests.utils import run_test

    from tassel.voice.thinker import ThinkerOutput

    c = TutorCoordinator(FakeThinker(), BoardContext())
    await c.prepare(LLMContext([]), "hello", decision=rules("hello"))
    frames, _ = await run_test(
        ThinkerOutput(c),
        frames_to_send=[
            LLMFullResponseStartFrame(),
            LLMTextFrame("[[sta"),
            LLMTextFrame("ge board]]Hello. " + WRONG),
            LLMFullResponseEndFrame(),
        ],
    )
    spoken = "".join(f.text for f in frames if isinstance(f, LLMTextFrame))
    assert spoken == "Hello. "
    assert not c.board.specs
    await c.close()


@pytest.mark.asyncio
async def test_checked_brief_reaches_board_in_real_bot_pipeline(monkeypatch):
    from test_bot_pipeline import context, running, say, until

    from tassel.voice import bot as bot_module

    class DrawingThinker(FakeThinker):
        async def think(self, messages):
            assert any("draw_board" in str(m) for m in messages)
            return brief().model_copy(update={"board": [RIGHT], "language": TARGET})

    monkeypatch.setattr(bot_module, "make_thinker", lambda settings: DrawingThinker())
    async with running(context()) as (bot, out):
        await say(bot, "Draw it on the board")
        await until(lambda: any(e["kind"] == "beat" and e["beat"]["markers"] for e in out.events()))
        actions = [
            m["action"] for e in out.events() if e["kind"] == "beat" for m in e["beat"]["markers"]
        ]
        assert any(a["kind"] == "board.automaton" for a in actions)
        assert bot._turn_context.board.specs["ex"].start == "q0"
        assert "[[" not in out.text()


@pytest.mark.asyncio
async def test_whitespace_cannot_smuggle_talker_dfa_past_checker():
    from pipecat.frames.frames import (
        LLMFullResponseEndFrame,
        LLMFullResponseStartFrame,
        LLMTextFrame,
    )
    from pipecat.tests.utils import run_test

    from tassel.voice.thinker import ThinkerOutput

    c = TutorCoordinator(None, BoardContext())
    await c.prepare(LLMContext([]), "draw", decision=rules("draw"))
    frames, _ = await run_test(
        ThinkerOutput(c),
        frames_to_send=[
            LLMFullResponseStartFrame(),
            LLMTextFrame("[[ dfa ex start=q0 accept=q0 q0-0,1-q0]]Hello."),
            LLMFullResponseEndFrame(),
        ],
    )
    assert "".join(f.text for f in frames if isinstance(f, LLMTextFrame)) == "Hello."
    await c.close()
