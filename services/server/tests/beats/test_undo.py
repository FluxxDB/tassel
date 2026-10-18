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


def test_redo_puts_back_what_undo_took_and_a_new_drawing_ends_it():
    # Live test 2de450e6: "Add the PCs back, please" after an undo had nothing to go on.
    ctx = BoardContext()
    turn(ctx, A)
    turn(ctx, B)
    turn(ctx, "[[undo]]")
    assert ctx.redo_items() == ["b"]
    [back] = turn(ctx, "[[redo]]")
    assert isinstance(back, BoardAutomaton) and back.item == "b"
    assert set(ctx.specs) == {"a", "b"}
    assert turn(ctx, "[[redo]]") == []
    # And it can be undone again.
    assert turn(ctx, "[[undo]]") == [BoardClear(kind="board.clear", item="b")]
    # A new drawing turn ends the redo.
    turn(ctx, A2)
    assert ctx.redo_items() == []
    assert turn(ctx, "[[redo]]") == []


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


def test_a_dfa_without_a_name_gets_one():
    # Real-token eval (2026-10-18): the thinker wrote [[dfa start=q0 accept=q3 …]] with no item,
    # the checker dropped it, and the trace and the note after it had no DFA to work on.
    ctx = BoardContext()
    [action] = turn(ctx, "[[dfa start=q0 accept=q1 q0-0-q1]]")
    assert isinstance(action, BoardAutomaton) and action.item == "dfa"
    [second] = turn(ctx, "[[nfa start=p0 accept=p0 p0-1-p0]]")
    assert second.item == "nfa"
    [third] = turn(ctx, "[[dfa start=s accept=s s-0-s]]")
    assert third.item == "dfa2"


@pytest.mark.parametrize(
    "text",
    ["Okay, put the PCs back, please.", "Can you restore what you removed?", "Redo that."],
)
def test_putting_things_back_is_board_work_for_the_thinker(text):
    decision = guard(text, rules(text, focus="board"))
    assert (decision.route, decision.action) == ("thinker", "draw_board")
