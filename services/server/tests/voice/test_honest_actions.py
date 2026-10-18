"""Ada never claims an action that didn't happen (owner's live test, 2026-10-18): "I'll add two
PCs in each zone" came with a brief that drew nothing, and later she said they were "already
placed". A draw turn whose brief carries nothing to draw hands the request to the Illustrator,
and a drawing that still doesn't come is said plainly."""

import pytest
from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.tests.utils import run_test
from test_two_tier import brief

from tassel.beats.markup import BoardContext
from tassel.voice.director import Decision
from tassel.voice.prompts import TALKER_RULES
from tassel.voice.thinker import ThinkerOutput, TutorCoordinator

DRAW = Decision(
    focus="board", needs_vision=False, route="thinker", action="draw_board", refers_to="board"
)


class Thinker:
    def __init__(self, result):
        self.result = result

    async def think(self, messages, effort=None):
        return self.result

    async def close(self):
        pass


class Illustrator:
    def __init__(self):
        self.intents = []

    async def draw(self, intent, board, lang):
        self.intents.append(intent)
        return None

    async def close(self):
        pass


async def spoken(coordinator):
    frames, _ = await run_test(
        ThinkerOutput(coordinator),
        frames_to_send=[LLMFullResponseStartFrame(), LLMFullResponseEndFrame()],
    )
    return "".join(f.text for f in frames if isinstance(f, LLMTextFrame))


@pytest.mark.asyncio
async def test_a_draw_turn_with_nothing_to_draw_asks_the_illustrator():
    request = "Can you put two PCs in each of those zones, please?"
    illustrator = Illustrator()
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"say": "I'll add two PCs in each zone."})),
        BoardContext(),
        illustrator=illustrator,
    )
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    words = await spoken(c)
    assert illustrator.intents == [request]
    # Nothing came back to draw, so she says so instead of implying it's there.
    assert "couldn't" in words.lower()
    await c.close()


@pytest.mark.asyncio
async def test_an_automaton_turn_is_not_handed_to_the_illustrator():
    request = "Draw me a DFA for strings that start with 010"
    illustrator = Illustrator()
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"say": "Here's one."})),
        BoardContext(),
        illustrator=illustrator,
    )
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    await spoken(c)
    assert illustrator.intents == []
    await c.close()


def test_the_talker_never_claims_board_or_view_changes():
    rules = TALKER_RULES.lower()
    assert "never say something is on the board" in rules
    assert "never say you switched" in rules
