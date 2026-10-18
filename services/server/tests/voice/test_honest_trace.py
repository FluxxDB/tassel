"""A trace Ada narrates is a trace she shows (owner's live session, 2026-10-18): a turn the
director routed as a trace of her paper came with the playbook's board copy and trace, every
board tag was rejected because her words named her paper, and Ada still said "Let's trace 10
on your machine. One takes you to the middle state…" over an empty board.

The playbook's trace of her machine happens on the board as `yours`, beside her page (the
stage manager opens the split view), so a trace turn keeps its board copy even when she names
her paper. And whatever the checks take out, the say never narrates: a brief whose trace tags
all fail gets the plain line that the trace couldn't be shown, never the step-by-step story."""

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_honest_actions import DRAW, Illustrator, Thinker, spoken
from test_two_tier import brief

from tassel.beats.markup import BoardContext
from tassel.beats.models import (
    DetectedElement,
    DetectedElements,
    PaperElements,
    PaperFrame,
    PixelBox,
)
from tassel.voice.action_checker import TargetLanguage
from tassel.voice.director import Decision
from tassel.voice.prompts import THINKER_EXAMPLES, thinker_system_prompt
from tassel.voice.thinker import NOT_DRAWN, NOT_MARKED, NOT_TRACED, GuidanceBrief, TutorCoordinator

# The live brief, tag for tag.
YOURS = "[[dfa yours start=q0 accept=q0,q2 q0-1-q1 q1-0-q2]]"
TRACE = "[[trace t yours 10 student]]"
LIVE_TAGS = [YOURS, TRACE, "[[step t]]", "[[step t]]", "[[step t]]", "[[step t]]"]
NARRATION = (
    "Let's trace 10 on your machine. The start state already accepts the empty string. "
    "One takes you to the middle state. Zero takes you to the accepting state. So 10 is "
    "accepted, but should it be?"
)
# What she said named her paper and not the board; the director routed it as a paper trace.
REQUEST = "I still don't get it. Trace 10 on my paper DFA."
PAPER_TRACE = Decision(
    focus="paper", needs_vision=True, route="thinker", action="trace", refers_to="paper"
)
BOARD_TRACE = Decision(
    focus="board", needs_vision=False, route="thinker", action="trace", refers_to="board"
)
MARK = Decision(
    focus="paper", needs_vision=True, route="thinker", action="mark_paper", refers_to="paper"
)


def live_brief(**changes):
    return brief().model_copy(update={"board": LIVE_TAGS, "say": NARRATION, **changes})


def paper_board():
    return BoardContext(
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


async def reply(request, result, decision, ctx=None, lang="en"):
    c = TutorCoordinator(Thinker(result), ctx or BoardContext(), lang=lambda: lang)
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=decision)
    text = await spoken(c)
    note = c.notes[-1] if c.notes else None
    await c.close()
    return text, note


@pytest.mark.asyncio
async def test_the_live_paper_trace_is_shown_on_the_board_and_narrated_step_by_step():
    text, note = await reply(REQUEST, live_brief(), PAPER_TRACE)
    assert note.board == LIVE_TAGS
    assert text.startswith(YOURS + TRACE)
    assert text.count("[[step t]]") == 2  # one per symbol of "10"
    assert "One takes you to the middle state." in text
    # One step lands before each sentence after the first, so the trace advances as she speaks.
    assert "[[step t]]One takes you to the middle state." in text


@pytest.mark.asyncio
async def test_a_trace_whose_tags_all_fail_gets_the_honest_line_never_the_narration():
    # The copy of her machine never came, so the trace has nothing to run on.
    text, note = await reply(REQUEST, live_brief(board=LIVE_TAGS[1:]), PAPER_TRACE)
    assert text == NOT_TRACED["en"]
    assert "[[trace" not in text and "[[step" not in text
    assert "middle state" not in text
    assert note.board == []


@pytest.mark.asyncio
async def test_a_paper_mark_turn_never_narrates_a_board_trace_it_cannot_show():
    # Her words want a paper mark; the checker keeps the board out, and so does the say.
    text, note = await reply("Circle the mistake on my paper.", live_brief(), MARK, paper_board())
    assert text == NOT_TRACED["en"]
    assert note.board == [] and note.paper == []


@pytest.mark.asyncio
@pytest.mark.parametrize("lang", ["es", "ko"])
async def test_the_honest_trace_line_is_localized(lang):
    text, _ = await reply(REQUEST, live_brief(board=LIVE_TAGS[1:]), PAPER_TRACE, lang=lang)
    assert text == NOT_TRACED[lang]


@pytest.mark.asyncio
async def test_a_board_trace_on_a_board_turn_is_unchanged():
    text, note = await reply("Trace 10 on the board.", live_brief(), BOARD_TRACE)
    assert note.board == LIVE_TAGS
    assert text.startswith(YOURS + TRACE)
    assert text.count("[[step t]]") == 2  # one per symbol of "10" and "middle state" in text


@pytest.mark.asyncio
async def test_orphan_steps_go_with_their_lost_trace():
    # On a board turn a step tag alone still parses; without its trace it moves nothing.
    text, note = await reply("Trace 10 on the board.", live_brief(board=LIVE_TAGS[1:]), BOARD_TRACE)
    assert text == NOT_TRACED["en"]
    assert note.board == []


@pytest.mark.asyncio
async def test_a_drawing_that_never_reached_the_board_is_said_plainly():
    # A wrong machine of Ada's own is refused twice (the fake thinker repairs nothing).
    wrong = "[[dfa fix start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3]]"
    text, note = await reply(
        "Draw me the correct DFA for 0101 on the board.",
        brief().model_copy(
            update={
                "board": [wrong],
                "say": "Here's the fix.",
                "language": TargetLanguage(regex="0101", alphabet=["0", "1"]),
            }
        ),
        DRAW,
    )
    assert note.board == []
    assert text == "Here's the fix. " + NOT_DRAWN["en"]


@pytest.mark.asyncio
async def test_a_lost_network_diagram_goes_to_the_illustrator_and_is_said_plainly_once():
    # No pending diagram "net", so the tag is refused; the Illustrator gets her request, with
    # the brief's own words and none of the honesty line, and its failure is said once.
    illustrator = Illustrator()
    request = "Draw the office network with two zones."
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"board": ["[[diagram net]]"], "say": "Two zones."})),
        BoardContext(),
        illustrator=illustrator,
    )
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    text = await spoken(c)
    await c.close()
    [intent] = illustrator.intents
    assert intent == f"Two zones. (She asked: {request})"
    assert text == "Two zones. " + NOT_DRAWN["en"]


@pytest.mark.asyncio
async def test_a_board_diagram_dropped_from_a_paper_mark_turn_leaves_her_words_alone():
    # The mark she asked for landed; the stray board diagram was the thinker's, not hers.
    text, note = await reply(
        "Circle it on my paper.",
        brief().model_copy(
            update={
                "board": ["[[dfa ex start=q0 accept=q1 q0-0-q1]]"],
                "paper": ["[[circle m1]]"],
                "say": "Here.",
            }
        ),
        MARK,
        paper_board(),
    )
    assert note.board == [] and note.paper == ["[[freeze]]", "[[circle m1]]"]
    assert text == "[[freeze]][[circle m1]]Here."


@pytest.mark.asyncio
async def test_a_mark_that_fits_no_ink_is_said_plainly():
    text, note = await reply(
        "Circle it on my paper.",
        brief().model_copy(
            update={"paper": ["[[circle m7]]"], "say": "This one accepts too early."}
        ),
        MARK,
        paper_board(),
    )
    assert note.paper == []
    assert text == "This one accepts too early. " + NOT_MARKED["en"]


def test_validate_tags_keeps_the_board_copy_on_a_paper_trace_turn():
    c = TutorCoordinator(None, BoardContext())
    c.text, c.decision = REQUEST, PAPER_TRACE
    assert c.validate_tags(live_brief()).board == LIVE_TAGS
    c.decision = MARK
    assert c.validate_tags(live_brief()).board == []


def test_the_prompt_example_traces_her_paper_machine_on_the_board():
    prompt = thinker_system_prompt(GuidanceBrief.model_json_schema())
    assert "on the board as yours" in prompt and "even when she names her paper" in prompt
    example = next(e for e in THINKER_EXAMPLES if "[[trace t yours" in str(e["brief"]["board"]))
    # The ladder's step 1 (her "no" after Ada's question): her machine copied to the board and
    # traced there, even when her words name her paper.
    c = TutorCoordinator(None, BoardContext())
    c.text, c.decision, c.rung = "I can't see it on my paper.", PAPER_TRACE, (1, False)
    checked = c.validate_tags(GuidanceBrief.model_validate(example["brief"]))
    assert checked.board == example["brief"]["board"]
