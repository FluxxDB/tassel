"""Ada's edit history (owner's live test, 2026-10-18): "delete the old drawing" wiped the whole
board with [[clear]]. Her board keeps each drawing turn's prior state, [[undo]] puts back the
board as it was before her last change, and a bare [[clear]] needs her to ask for everything."""

import pytest

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.models import BoardAutomaton, BoardClear
from tassel.voice.action_checker import check_tags
from tassel.voice.director import Decision, guard, rules

A = "[[dfa a start=q0 accept=q1 q0-0-q1]]"
A2 = "[[dfa a start=q0 accept=q1 q0-0-q1 q1-1-q1]]"
B = "[[dfa b start=p0 accept=p0 p0-1-p0]]"


def turn(ctx: BoardContext, text: str):
    """One of Ada's replies: the actions its tags make, in order."""
    ctx.begin_turn()
    stream = MarkupStream(ctx)
    sentences = stream.feed(text + " Done.") + stream.flush()
    ctx.end_turn()
    return [action for sentence in sentences for _, action in sentence.anchors]


def test_undo_clears_what_her_last_turn_added():
    ctx = BoardContext()
    turn(ctx, A)
    turn(ctx, B)
    assert turn(ctx, "[[undo]]") == [BoardClear(kind="board.clear", item="b")]
    assert set(ctx.specs) == {"a"}


def test_undo_restores_what_her_last_turn_changed_or_cleared():
    ctx = BoardContext()
    turn(ctx, A)
    turn(ctx, A2)
    [restored] = turn(ctx, "[[undo]]")
    assert isinstance(restored, BoardAutomaton) and restored.item == "a"
    assert len(restored.spec.transitions) == 1
    turn(ctx, "[[clear a]]")
    [back] = turn(ctx, "[[undo]]")
    assert isinstance(back, BoardAutomaton) and back.item == "a"
    assert "a" in ctx.specs


def test_undo_walks_back_turn_by_turn_and_then_does_nothing():
    ctx = BoardContext()
    turn(ctx, A)
    turn(ctx, B)
    turn(ctx, "[[undo]]")
    assert turn(ctx, "[[undo]]") == [BoardClear(kind="board.clear", item="a")]
    assert ctx.specs == {}
    assert turn(ctx, "[[undo]]") == []


def test_a_turn_that_draws_nothing_is_no_step_in_the_history():
    ctx = BoardContext()
    turn(ctx, A)
    turn(ctx, "Just words.")
    assert turn(ctx, "[[undo]]") == [BoardClear(kind="board.clear", item="a")]


DRAW = Decision(
    focus="board", needs_vision=False, route="thinker", action="draw_board", refers_to="board"
)


def board_with_two():
    ctx = BoardContext()
    turn(ctx, A)
    turn(ctx, B)
    return ctx


def test_a_bare_clear_needs_her_to_ask_for_everything():
    checked = check_tags(
        ["[[clear]]"], DRAW, board_with_two(), student_text="Can you delete the old drawing?"
    )
    assert checked.tags == [] and checked.repair and "[[clear ITEM]]" in checked.repair
    ok = check_tags(["[[clear]]"], DRAW, board_with_two(), student_text="Clear the whole board.")
    assert ok.tags == ["[[clear]]"]
    one = check_tags(["[[clear b]]"], DRAW, board_with_two(), student_text="Delete that one.")
    assert one.tags == ["[[clear b]]"]


@pytest.mark.parametrize(
    "text",
    ["Can you delete the old drawing, please?", "Undo that.", "Erase your last change."],
)
def test_erasing_is_board_work_for_the_thinker(text):
    decision = guard(text, rules(text, focus="board"))
    assert (decision.route, decision.action, decision.refers_to) == (
        "thinker",
        "draw_board",
        "board",
    )
