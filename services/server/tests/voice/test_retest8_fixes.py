"""Regressions from the owner's retest #8 (2026-10-18 00:22): a circle on the wrong state from a
stale mark ID, board traces rejected, the same sentence three times, words instead of drawings
when she stayed confused, and the full answer when she asked for help."""

import asyncio

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_two_tier import brief

from tassel.beats.markup import BoardContext
from tassel.voice.action_checker import TargetLanguage, check_tags
from tassel.voice.director import Decision, escalate, guard
from tassel.voice.prompts import TALKER_RULES, TUTOR_PLAYBOOK, thinker_system_prompt
from tassel.voice.thinker import TutorCoordinator, compose


def decision(**kw):
    base = dict(
        focus="paper", needs_vision=True, route="thinker", action="mark_paper", refers_to="paper"
    )
    return Decision(**{**base, **kw})


TARGET = TargetLanguage(regex="0101", alphabet=["0", "1"])
# Her machine as drawn: accepts 010, one symbol too soon.
YOURS = "[[dfa yours start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3]]"


# --- Stale mark IDs: m14 from an earlier frame circled a different state ---------------------


@pytest.mark.asyncio
async def test_notes_never_carry_mark_ids_into_the_next_turn():
    class Thinker:
        def __init__(self):
            self.seen = []

        async def think(self, messages, effort=None):
            self.seen.append(str(messages))
            return brief().model_copy(
                update=dict(
                    page="Heading 0101; m14 is the double-circled final state.",
                    paper=["[[freeze]]", "[[circle m14]]"],
                )
            )

        async def close(self):
            pass

    thinker = Thinker()
    c = TutorCoordinator(thinker, BoardContext())
    ctx = LLMContext([{"role": "user", "content": "circle it"}])
    await c.prepare(ctx, "circle it", decision=decision())
    await c.result()
    await c.prepare(ctx, "again", decision=decision())
    await c.result()
    assert "m14" not in thinker.seen[1]
    assert "m14" not in str(ctx.get_messages())
    await c.close()


def test_marks_must_be_identified_and_own_marks_are_not_her_ink():
    prompt = thinker_system_prompt({})
    assert "IDs change with every image" in prompt
    assert "purple" in prompt and "not her ink" in prompt


# --- Drawing is allowed whenever it helps, and a trace walks through her machine -------------


def test_board_trace_is_allowed_on_a_board_turn():
    tags = [
        "[[nfa exact start=q0 accept=q4 q0-0-q1 q1-1-q2 q2-0-q3 q3-1-q4]]",
        "[[trace t exact 0101]]",
        "[[step t]]",
    ]
    out = check_tags(
        tags,
        decision(action="draw_board", focus="board", refers_to="board", needs_vision=False),
        BoardContext(),
        TARGET,
    )
    assert out.tags == tags


def test_explaining_may_draw_on_the_board_and_mark_her_paper_never_stage():
    out = check_tags(
        ["[[dfa fix start=q0 accept=q1 q0-0-q1]]", "[[stage board]]"],
        decision(action="explain"),
        BoardContext(),
    )
    assert out.tags == ["[[dfa fix start=q0 accept=q1 q0-0-q1]]"]


def test_a_copy_of_her_wrong_machine_can_be_traced():
    # Verification is for Ada's own constructions; "yours" is her machine as drawn.
    tags = [YOURS, "[[trace t yours 010 student]]", "[[step t]]", "[[step t]]"]
    out = check_tags(tags, decision(action="trace"), BoardContext(), TARGET)
    assert out.tags == tags and out.repair is None
    wrong = "[[dfa fix start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3]]"
    assert check_tags([wrong], decision(action="draw_board"), BoardContext(), TARGET).repair


def test_trace_steps_land_one_per_sentence():
    spoken = compose(
        brief().model_copy(
            update=dict(
                board=[YOURS, "[[trace t yours 010 student]]", "[[step t]]", "[[step t]]"],
                say="Let's run 010. First a zero. Then a one. Then a zero, and it accepts.",
            )
        )
    )
    assert spoken.index("[[step t]]First a zero.") < spoken.index("[[step t]]Then a one.")
    assert spoken.index(YOURS) < spoken.index("Let's run 010.")


# --- Escalation: one failed explanation in words, then she draws -----------------------------


@pytest.mark.parametrize(
    "text",
    [
        "I'm not sure.",
        "I don't understand what you're talking about.",
        "You're just repeating yourself.",
        "What do you mean?",
        "I'm confused",
    ],
)
def test_confusion_after_an_explanation_escalates_to_drawing(text):
    first = escalate(text, decision(action="explain", focus="paper"), confusions=1)
    assert first.route == "thinker" and first.action == "mark_paper"
    again = escalate(text, decision(action="mark_paper"), confusions=2)
    assert (again.action, again.focus) == ("trace", "split") and again.needs_vision


def test_no_escalation_without_confusion():
    d = decision(action="explain")
    assert escalate("Okay, what next?", d, confusions=0) == d


def test_help_me_make_is_not_a_request_for_the_answer():
    out = guard(
        "I'm trying to make a DFA for the language 0101. Can you help me?",
        decision(focus="board", needs_vision=False, action="draw_board", refers_to="board"),
    )
    assert out.action != "draw_board" and out.refers_to == "paper" and out.needs_vision


def test_help_me_fix_this_dfa_looks_at_her_paper():
    out = guard(
        "Can you help me fix this DFA?",
        decision(focus="board", action="draw_board", refers_to="paper"),
    )
    assert out.action != "draw_board" and out.focus == "paper"


# --- The playbook: guide, don't narrate; hints before answers; never repeat ------------------


def test_playbook_reaches_both_tiers():
    for rule in ("Guide, don't narrate", "Hints before answers", "draw", "Never repeat"):
        assert rule in TUTOR_PLAYBOOK
    assert TUTOR_PLAYBOOK in thinker_system_prompt({})
    assert "Guide, don't narrate" in TALKER_RULES


SAME = "Your chain reaches the double circle after 010, so it accepts."
NEW = "Let's trace 010 on a copy of your machine instead."


@pytest.mark.asyncio
async def test_a_repeated_answer_is_rewritten_once():
    class Thinker:
        def __init__(self):
            self.calls = []

        async def think(self, messages, effort=None):
            self.calls.append(str(messages))
            if len(self.calls) == 3:
                return brief().model_copy(
                    update={"say": "Let's trace 010 on a copy of your machine instead."}
                )
            return brief().model_copy(
                update={"say": "Your chain reaches the double circle after 010, so it accepts."}
            )

        async def close(self):
            pass

    thinker = Thinker()
    c = TutorCoordinator(thinker, BoardContext())
    ctx = LLMContext([{"role": "user", "content": "help"}])
    await c.prepare(ctx, "help", decision=decision(action="explain"))
    await c.result()
    await c.prepare(ctx, "I don't get it", decision=decision(action="explain"))
    second = await c.result()
    assert len(thinker.calls) == 3 and "already said" in thinker.calls[2]
    assert second.say.startswith("Let's trace")
    await c.close()


# --- The page is fetched off the bridge's path ----------------------------------------------


@pytest.mark.asyncio
async def test_the_thinker_waits_for_the_page_not_the_bridge():
    seen = []

    class Thinker:
        async def think(self, messages, effort=None):
            seen.append(str(messages))
            return brief()

        async def close(self):
            pass

    gate = asyncio.Event()

    async def page():
        await gate.wait()
        return b"jpeg", "the page"

    c = TutorCoordinator(Thinker(), BoardContext())
    ctx = LLMContext([{"role": "user", "content": "see my paper?"}])
    await asyncio.wait_for(
        c.prepare(ctx, "see my paper?", decision=decision(action="explain"), page=page), 0.5
    )
    assert c.pending() and not seen
    gate.set()
    await c.result()
    assert "image_url" in seen[0] and "the page" in seen[0]
    assert "image_url" not in str(ctx.get_messages())
    await c.close()


def test_help_with_her_drawing_is_not_an_answer_request():
    out = guard(
        "I'm trying to draw a DFA that takes 0101. Can you help me fix this DFA?",
        decision(focus="board", action="draw_board", refers_to="paper"),
    )
    assert out.action != "draw_board" and out.focus == "paper"


def test_write_me_the_correct_version_is_a_board_construction():
    # Live, the model once answered this with paper marks only.
    out = guard(
        "So can you write me an NFA for the correct version of this language?",
        decision(action="mark_paper", needs_vision=False),
    )
    assert (out.action, out.focus) == ("draw_board", "board")


def test_tags_written_inside_say_are_kept_not_dropped():
    from tassel.voice.thinker import lift_say_tags

    out = lift_say_tags(
        brief().model_copy(
            update={"say": "[[freeze]][[circle m4]]This double circle. [[step t]]Then a one."}
        )
    )
    assert out.paper == ["[[freeze]]", "[[circle m4]]"] and out.board == ["[[step t]]"]
    assert "[[" not in out.say


@pytest.mark.asyncio
async def test_an_escalated_trace_tells_the_thinker_which_rung():
    seen = []

    class Thinker:
        async def think(self, messages, effort=None):
            seen.append(str(messages))
            return brief()

        async def close(self):
            pass

    c = TutorCoordinator(Thinker(), BoardContext())
    await c.prepare(
        LLMContext([{"role": "user", "content": "still lost"}]),
        "still lost",
        decision=decision(action="trace", focus="split"),
    )
    await c.result()
    assert "copy her machine exactly as drawn" in seen[0]
    await c.close()


def test_turn_caption_lists_where_each_mark_is():
    import uuid
    from datetime import UTC, datetime

    from tassel.beats.models import DetectedElement, PixelBox
    from tassel.vision.turn_image import PageView, legend

    view = PageView(
        b"",
        b"",
        (
            DetectedElement(id="m4", kind="label", box=PixelBox(x=200, y=100, w=60, h=60)),
            DetectedElement(id="m1", kind="circle", box=PixelBox(x=1100, y=250, w=100, h=100)),
        ),
        uuid.uuid4(),
        datetime.now(UTC),
        1280,
        720,
    )
    text = legend(view)
    assert "m4 label at top left" in text and "m1 circle at middle right" in text
    assert text.index("m4") < text.index("m1")


@pytest.mark.asyncio
async def test_still_lost_after_her_trace_moves_to_the_contrast_rung():
    seen = []

    class Thinker:
        async def think(self, messages, effort=None):
            seen.append(str(messages))
            return brief().model_copy(update={"board": [YOURS], "say": f"Say {len(seen)}."})

        async def close(self):
            pass

    c = TutorCoordinator(Thinker(), BoardContext())
    ctx = LLMContext([{"role": "user", "content": "lost"}])
    for _ in range(2):
        await c.prepare(ctx, "lost", decision=decision(action="trace", focus="split"))
        await c.result()
    assert "rung c" in seen[0] and "rung d" in seen[1]
    await c.close()


def test_a_construction_drawn_on_the_board_shows_the_board():
    # Live: the model chose draw_board but kept the paper in view.
    out = guard(
        "So can you write me an NFA for the correct version of this language?",
        decision(action="draw_board", focus="paper"),
    )
    assert out.focus == "board"


@pytest.mark.asyncio
async def test_a_trace_is_never_rewritten_as_a_repeat():
    # Live: a full walk-through on the fix resembled the trace on hers, and was cut to one step.
    class Thinker:
        def __init__(self):
            self.calls = 0

        async def think(self, messages, effort=None):
            self.calls += 1
            return brief().model_copy(
                update={
                    "board": [YOURS, "[[trace t yours 010]]", "[[step t]]"],
                    "say": "Start at q zero. Zero takes you to q one.",
                }
            )

        async def close(self):
            pass

    thinker = Thinker()
    c = TutorCoordinator(thinker, BoardContext())
    ctx = LLMContext([{"role": "user", "content": "walk me through"}])
    for _ in range(2):
        await c.prepare(ctx, "walk me through", decision=decision(action="trace", focus="split"))
        await c.result()
    assert thinker.calls == 2
    await c.close()
