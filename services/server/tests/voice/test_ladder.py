"""The whiteboard ladder (owner, 2026-10-18): "Can you take a look at my DFA?" gets only "there's
an error, can you spot it?"; "no" redraws her machine on the board, highlights it and steps one
breaking input through it; still stuck draws the correct one. One stored rung per problem."""

import asyncio
from types import SimpleNamespace

import numpy as np
import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_two_tier import brief as base_brief

from tassel.beats.markup import BoardContext
from tassel.voice.director import Decision, escalate, rules
from tassel.voice.ladder import Ladder, failed
from tassel.voice.thinker import LADDER, TutorCoordinator, compose


def brief(**changes):
    return base_brief().model_copy(update=changes)


YOURS = "[[dfa yours start=q0 accept= q0-0-q1 q1-1-q2 q2-0-q3]]"
FIX = "[[dfa fix start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3]]"


def paper(**kw):
    base = dict(focus="paper", needs_vision=True, route="thinker", action="none", refers_to="paper")
    return Decision(**{**base, **kw})


def talker(**kw):
    base = dict(
        focus="paper", needs_vision=False, route="talker", action="none", refers_to="conversation"
    )
    return Decision(**{**base, **kw})


# --- The stored ladder ---------------------------------------------------------------------


def test_a_ladder_begins_at_step_zero_and_climbs_to_two():
    ladder = Ladder()
    assert not ladder.open
    ladder.begin("paper")
    assert ladder.open and ladder.take() == (0, False)
    ladder.record(0, False, brief())
    for want in (1, 2, 2):
        ladder.climb()
        rung = ladder.take()
        assert rung == (want, False)
        ladder.record(*rung, brief(board=[YOURS]))
    assert ladder.step == 2


def test_a_right_attempt_closes_the_ladder_a_wrong_one_climbs():
    ladder = Ladder()
    ladder.begin("paper")
    ladder.record(*ladder.take(), brief())
    ladder.climb(attempt=True)
    rung = ladder.take()
    assert rung == (1, True)
    ladder.record(*rung, brief(board=[YOURS]))  # Wrong: Ada showed step 1.
    assert ladder.step == 1
    ladder.climb(attempt=True)
    ladder.record(*ladder.take(), brief())  # Right: Ada only confirmed.
    assert not ladder.open


def test_her_ink_changing_past_the_notes_threshold_starts_over():
    ladder = Ladder()
    ladder.begin("paper")
    ink = np.zeros((128, 128), bool)
    assert not ladder.see(ink)
    ladder.record(0, False, brief())
    ladder.climb()
    noise = ink.copy()
    noise[0, :100] = True  # 0.6% of the page: camera noise, not new work.
    assert not ladder.see(noise) and ladder.open
    redrawn = ink.copy()
    redrawn[:20] = True  # 15%: she changed her machine.
    assert ladder.see(redrawn) and not ladder.open


def test_a_new_problem_resets_the_ladder():
    ladder = Ladder()
    ladder.begin("paper")
    ladder.record(*ladder.take(), brief())
    out = escalate(
        "Can you draw a DFA on the board for strings that end in 11?",
        rules("Can you draw a DFA on the board for strings that end in 11?"),
        ladder=ladder,
    )
    assert out.action == "draw_board" and not ladder.open


@pytest.mark.parametrize(
    "text,stuck",
    [
        ("No.", True),
        ("No, I can't see it.", True),
        ("I can't see it", True),
        ("not sure", True),
        ("I don't know.", True),
        ("I still don't get it.", True),
        ("Nope", True),
        ("No idea, can you help me?", True),
        ("No, is it q3?", False),
        ("Is it the arrow from q2?", False),
        ("Okay.", False),
    ],
)
def test_failed_answers(text, stuck):
    assert failed(text) == stuck


# --- The director: the ladder's step routes the turn -----------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Can you take a look at my DFA?",
        "Is it right?",
        "Can you check my work?",
        "Could you look over my network?",
        "Does my DFA work?",
    ],
)
def test_check_my_work_is_step_zero_on_her_paper(text):
    ladder = Ladder()
    out = escalate(text, talker(), ladder=ladder, answered=True)
    assert (out.route, out.action, out.refers_to, out.needs_vision) == (
        "thinker",
        "explain",
        "paper",
        True,
    )
    assert ladder.take() == (0, False)


def test_whats_wrong_with_my_dfa_on_your_whiteboard_starts_by_showing_hers():
    ladder = Ladder()
    text = "What's wrong with my DFA? on your whiteboard."
    out = escalate(text, rules(text), ladder=ladder)
    assert (out.action, out.refers_to, out.focus) == ("draw_board", "paper", "split")
    assert ladder.problem == "paper" and ladder.take() == (1, False)


def test_a_ladder_step_opens_the_board_beside_her_paper():
    from tassel.voice.stage import StageManager

    ladder = Ladder()
    escalate("Can you take a look at my DFA?", talker(), ladder=ladder)
    ladder.record(*ladder.take(), brief())
    out = escalate("No.", talker(), ladder=ladder)
    stage = StageManager()
    stage.view = stage.student_view = "paper"
    assert stage.on_turn(out, now=100.0) == "split"


def test_check_my_work_on_the_board_is_a_board_ladder():
    ladder = Ladder()
    d = rules("Can you check my network on the board?")
    out = escalate("Can you check my network on the board?", d, ladder=ladder)
    assert (out.route, out.refers_to, out.needs_vision) == ("thinker", "board", False)
    assert ladder.problem == "board" and ladder.take() == (0, False)


@pytest.mark.parametrize("text", ["No.", "No, I can't see it.", "I can't see it", "not sure"])
def test_a_failed_answer_after_adas_question_climbs(text):
    ladder = Ladder()
    escalate("Can you take a look at my DFA?", talker(), ladder=ladder)
    ladder.record(*ladder.take(), brief(say="There's an error in your DFA. Can you spot it?"))
    out = escalate(text, talker(), ladder=ladder, answered=True)
    assert (out.route, out.action, out.refers_to, out.needs_vision) == (
        "thinker",
        "draw_board",
        "paper",
        True,
    )
    assert ladder.take() == (1, False)
    ladder.record(1, False, brief(board=[YOURS]))
    out = escalate("I still don't get it.", talker(), ladder=ladder, answered=True)
    assert out.action == "draw_board" and ladder.take() == (2, False)


def test_no_with_no_open_ladder_stays_with_the_talker():
    ladder = Ladder()
    d = talker()
    assert escalate("No.", d, ladder=ladder, answered=True) == d
    assert ladder.take() == (None, False)


def test_a_board_ladder_climbs_on_the_board():
    ladder = Ladder()
    escalate("Can you check my network on the board?", rules("check my board"), ladder=ladder)
    ladder.record(*ladder.take(), brief())
    out = escalate("I don't see it.", talker(focus="board"), ladder=ladder, answered=True)
    assert (out.action, out.refers_to, out.needs_vision) == ("draw_board", "board", False)


def test_an_attempt_goes_to_the_thinker_at_the_next_step():
    ladder = Ladder()
    escalate("Can you take a look at my DFA?", talker(), ladder=ladder)
    ladder.record(*ladder.take(), brief())
    out = escalate("Is it the arrow from q2?", talker(), ladder=ladder, answered=True)
    assert out.route == "thinker" and ladder.take() == (1, True)


def test_asking_for_the_answer_on_an_open_ladder_jumps_to_the_correct_machine():
    ladder = Ladder()
    escalate("Can you take a look at my DFA?", talker(), ladder=ladder)
    ladder.record(*ladder.take(), brief())
    out = escalate("Just show me the answer.", talker(), ladder=ladder, answered=True)
    assert out.action == "draw_board" and ladder.take() == (2, False)


def test_still_confused_without_a_ladder_draws_on_the_board():
    # The old counter's job: one failed explanation in words, then she draws.
    ladder = Ladder()
    out = escalate("I'm confused", talker(focus="board"), ladder=ladder, answered=True)
    assert (out.route, out.action, out.focus) == ("thinker", "draw_board", "board")
    assert not ladder.open
    paper_turn = escalate("I don't understand.", paper(action="explain"), ladder=ladder)
    assert paper_turn.action == "draw_board" and ladder.take() == (1, False)


def test_her_image_still_gets_a_mark_when_she_is_lost():
    ladder = Ladder()
    d = talker(refers_to="image", focus="paper")
    out = escalate("I'm not sure", d, ladder=ladder, answered=True)
    assert (out.route, out.action) == ("thinker", "mark_image")


# --- The rungs: each step's note reaches the thinker ----------------------------------------


class Recording:
    def __init__(self, reply=None):
        self.seen, self.efforts = [], []
        self.reply = reply or brief()

    async def think(self, messages, effort=None):
        self.seen.append([m.get("content") for m in messages])
        self.efforts.append(effort)
        return self.reply

    async def close(self):
        pass


def test_the_rungs_say_what_each_step_does():
    assert "spot it" in LADDER[0] and "draw nothing" in LADDER[0].lower()
    for words in (
        "let me help you out",
        "[[dfa yours",
        "[[highlight",
        "[[trace t yours",
        "[[step t]]",
    ):
        assert words.lower() in LADDER[1].lower(), words
    assert "draw" in LADDER[1] and "question" in LADDER[1]
    assert "correct" in LADDER[2] and "[[trace" in LADDER[2]
    for step in (1, 2):
        assert "her paper" in LADDER[step]  # Board only: nothing on her paper.


@pytest.mark.asyncio
@pytest.mark.parametrize("step", [0, 1, 2])
async def test_each_rung_reaches_the_thinker_and_steps_one_and_two_think_at_low(step):
    thinker = Recording()
    thinker.settings = SimpleNamespace(thinker_draw_effort="low")
    c = TutorCoordinator(thinker, BoardContext())
    c.ladder.begin("paper", step=step)
    d = paper(action="explain" if step == 0 else "draw_board")
    await c.prepare(LLMContext([{"role": "user", "content": "No."}]), "No.", decision=d)
    await c.result()
    assert LADDER[step] in thinker.seen[0]
    assert thinker.efforts[0] == (None if step == 0 else "low")
    assert c.ladder.step == step
    await c.close()


def test_drawn_briefs_get_room_for_a_redraw_and_a_trace():
    from test_retest7_fixes import _recording_thinker

    thinker, requests = _recording_thinker()
    asyncio.run(thinker.think([{"role": "user", "content": "no"}]))
    asyncio.run(thinker.think([{"role": "user", "content": "no"}], effort="low"))
    assert requests[0]["max_completion_tokens"] == 1200
    assert requests[1]["max_completion_tokens"] >= 4000


# --- validate_tags: her paper named on a ladder turn keeps the board -------------------------


@pytest.mark.asyncio
async def test_board_tags_survive_a_paper_ladder_turn():
    reply = brief(
        say="Okay, let me help you out. Here's your machine. Let's run 010. Zero. One. Zero.",
        board=[YOURS, "[[highlight yours q3]]", "[[trace t yours 010 student]]", "[[step t]]"],
    )
    for step, kept in ((1, True), (None, False)):
        c = TutorCoordinator(Recording(reply), BoardContext())
        if step is not None:
            c.ladder.begin("paper", step=step)
        text = "I can't see the mistake on my paper."
        d = paper(action="draw_board" if step else "explain")
        await c.prepare(LLMContext([{"role": "user", "content": text}]), text, decision=d)
        out = await c.result()
        assert bool(out.board) == kept
        await c.close()


# --- compose: tags land at the sentence that narrates them -----------------------------------


def test_compose_anchors_highlights_and_the_trace_where_she_hears_them():
    spoken = compose(
        brief(
            board=[
                YOURS,
                "[[highlight yours q3]]",
                "[[trace t yours 010 student]]",
                "[[step t]]",
                "[[step t]]",
                "[[step t]]",
            ],
            say="Okay, let me help you out. Here's your machine as you drew it. "
            "Let's run zero one zero. Zero takes you to q one. One takes you to q two. "
            "Zero lands on q three, which doesn't accept. How would you fix q three?",
        )
    )
    assert spoken.startswith(YOURS + "Okay, let me help you out.")
    assert "[[trace t yours 010 student]]Let's run zero one zero." in spoken
    assert "[[step t]]Zero takes you to q one." in spoken
    assert "[[step t]]One takes you to q two." in spoken
    assert "[[highlight yours q3]][[step t]]Zero lands on q three" in spoken
    assert spoken.endswith("How would you fix q three?")


def test_compose_without_a_named_state_keeps_highlights_before_the_walk():
    spoken = compose(
        brief(
            board=[YOURS, "[[highlight yours q2>q3]]", "[[trace t yours 010 student]]"]
            + ["[[step t]]"] * 3,
            say="Here's yours. Watch this run. First a zero. Then a one. Then a zero. Fix it?",
        )
    )
    assert spoken.index("[[highlight yours q2>q3]]") < spoken.index("[[trace")
    assert "[[trace t yours 010 student]]Watch this run." in spoken
    assert spoken.endswith("[[step t]]Then a zero. Fix it?")


def test_compose_puts_extra_steps_after_the_last_sentence():
    spoken = compose(brief(board=["[[trace t ex 0101]]"] + ["[[step t]]"] * 4, say="Run 0101."))
    assert spoken == "[[trace t ex 0101]]Run 0101.[[step t]][[step t]][[step t]][[step t]]"


def test_compose_spoken_korean_state_names():
    spoken = compose(
        brief(
            board=[YOURS, "[[highlight yours q3]]"],
            say="칠판에 그렸어요. 큐 삼을 보세요. 왜 받아들이지 않을까요?",
        )
    )
    assert "[[highlight yours q3]]큐 삼을 보세요." in spoken


# --- The bot: three turns of the owner's flow through the turn context ----------------------


@pytest.mark.asyncio
async def test_the_owners_dfa_flow_climbs_through_the_turn_context():
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.frame_processor import FrameDirection

    from tassel.voice.bot import _TurnContext
    from tassel.voice.director import Director

    replies = iter(
        [
            brief(say="There's an error in your DFA. Can you spot it?"),
            brief(
                say="Okay, let me help you out. Let's run 010. Zero. One. Zero. Can you fix it?",
                board=[YOURS, "[[trace t yours 010 student]]", *["[[step t]]"] * 3],
            ),
            brief(say="Here's the fix. Run 010. Zero. One. Zero.", board=[FIX]),
        ]
    )

    class Scripted(Recording):
        async def think(self, messages, effort=None):
            await super().think(messages, effort)
            return next(replies)

    thinker = Scripted()
    gate = _TurnContext(uuid4(), AsyncMock())
    gate.director = Director()
    gate.coordinator = TutorCoordinator(thinker, BoardContext())
    gate.push_frame = AsyncMock()
    gate._turn_page = AsyncMock(return_value=None)
    history = [{"role": "assistant", "content": "Hi! What are we working on?"}]
    seen = []
    for said in ("Can you take a look at my DFA?", "No, I can't see it.", "I still don't get it."):
        history.append({"role": "user", "content": said})
        context = LLMContext(list(history))
        await gate.process_frame(LLMContextFrame(context), FrameDirection.DOWNSTREAM)
        out = await gate.coordinator.result()
        seen.append((gate.decision.route, gate.decision.action, gate.coordinator.ladder.step))
        history.append({"role": "assistant", "content": out.say})
    assert seen == [
        ("thinker", "explain", 0),
        ("thinker", "draw_board", 1),
        ("thinker", "draw_board", 2),
    ]
    rungs = [next(c for c in m if c in LADDER.values()) for m in thinker.seen]
    assert rungs == [LADDER[0], LADDER[1], LADDER[2]]
    assert thinker.efforts == [None, "low", "low"]
    await gate.coordinator.close()


@pytest.mark.parametrize(
    "text,route",
    [
        ("How does a DFA reject a string?", "thinker"),
        ("Can you explain how a router forwards packets?", "thinker"),
        ("What is a DFA?", "talker"),
        ("How are you today?", "talker"),
    ],
)
def test_explaining_something_visual_goes_to_the_thinker(text, route):
    from tassel.voice.director import guard

    assert guard(text, rules(text)).route == route
