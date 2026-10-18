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
    # Her words, with the brief's own plan: the Illustrator knows what to change.
    [intent] = illustrator.intents
    assert request in intent and "I'll add two PCs in each zone." in intent
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


@pytest.mark.asyncio
async def test_tutor_notes_never_carry_her_last_words_or_tags():
    """Live test 2de450e6: on "Back to board" the talker said "I'll remove the three PCs I just
    added" again and re-sent [[undo]], both read from the tutor notes' copy of the last brief."""
    from tassel.beats.markup import MarkupStream
    from tassel.voice.thinker import NOTE_PREFIX

    said = "I'll remove the three PCs I just added."
    board = BoardContext()
    board.begin_turn()
    stream = MarkupStream(board)
    stream.feed("[[dfa a start=q0 accept=q1 q0-0-q1]] Done.")
    stream.flush()
    board.end_turn()
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"say": said, "board": ["[[undo]]"]})), board
    )
    context = LLMContext([{"role": "user", "content": "Can you undo that?"}])
    await c.prepare(context, "Can you undo that?", decision=DRAW)
    await c.result()
    notes = [
        m["content"]
        for m in context.get_messages()
        if isinstance(m.get("content"), str) and m["content"].startswith(NOTE_PREFIX)
    ]
    assert len(notes) == 1
    assert said not in notes[0] and "[[" not in notes[0]
    assert "already done" in notes[0].lower() and "board" in notes[0].lower()
    await c.close()


@pytest.mark.asyncio
async def test_an_unchanged_redraw_is_not_a_drawing():
    """Live test 2de450e6: "add the PCs back" came back as the same diagram, and Ada said
    "Here it is." The same spec again is "couldn't draw"."""
    from test_illustrator import SPEC

    from tassel.beats.models import DiagramSpec

    board = BoardContext()

    class Same:
        async def draw(self, intent, board_copy, lang):
            return "net", DiagramSpec.model_validate(SPEC)

        async def close(self):
            pass

    board.diagrams["net"] = DiagramSpec.model_validate(SPEC)
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"say": "I'll add the PCs back."})),
        board,
        illustrator=Same(),
    )
    request = "Add the PCs back, please."
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    words = await spoken(c)
    assert "couldn't" in words.lower() and "Here it is" not in words
    await c.close()


def test_the_thinker_never_promises_and_edits_diagrams_through_draw():
    from tassel.voice.prompts import BOARD_RULES, thinker_system_prompt

    prompt = thinker_system_prompt({})
    assert "Never promise" in prompt
    assert "only through the brief's draw field" in BOARD_RULES
    assert "[[redo]]" in BOARD_RULES


def test_the_learner_memory_refresh_keeps_the_talker_on_its_own_prompt():
    """Every live reply refreshed the talker's instruction with the single-tier prompt (the full
    board manual and show_stage), so under two tiers it drew, promised drawings and chose views."""
    from tassel.voice.bot import talker_instruction
    from tassel.voice.prompts import BOARD_RULES, system_prompt

    two_tier = talker_instruction("en", tools=True, two_tier=True, notes="\n[memory] likes DFAs")
    assert two_tier.startswith(system_prompt("en", tools=True, two_tier=True))
    assert BOARD_RULES not in two_tier and "show_stage" not in two_tier
    assert two_tier.endswith("[memory] likes DFAs")
    assert talker_instruction("en", tools=True, two_tier=False) == system_prompt("en")


@pytest.mark.asyncio
async def test_an_erase_request_never_goes_to_the_illustrator():
    """Real-token eval: "erase the network diagram" came back as a redrawn diagram and Ada said
    "The network is erased." Erasing is [[clear ITEM]] or [[undo]], never a drawing."""
    request = "Please erase the network diagram but keep the DFA."
    illustrator = Illustrator()
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"say": "The network is erased.", "draw": "net"})),
        BoardContext(),
        illustrator=illustrator,
    )
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    await spoken(c)
    assert illustrator.intents == []
    await c.close()
