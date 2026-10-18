"""The chat's action rows come from what Ada's tags did: one row per drawing, clear, undo, redo,
paper mark and view switch, never for the animation steps between them."""

from tassel.beats.markup import BoardContext, MarkupStream, StageImage
from tassel.beats.models import DiagramSpec
from tassel.chat.actions import named_rows, rows_for, view_row
from tassel.voice.messages import MessageAction


def sentences(text, board=None):
    stream = MarkupStream(board or BoardContext())
    return stream.feed(text) + stream.flush()


def rows(text, board=None):
    return [row for s in sentences(text, board) for row in rows_for(s)]


def row(kind, side, item=None):
    return MessageAction(kind=kind, side=side, item=item, attachment_id=None)


def test_a_removal_or_rename_of_a_part_names_the_part():
    board = BoardContext()
    sentences("[[dfa d start=q0 accept=q1 q0-0-q1 q1-0-q2]] Here.", board)
    board.diagrams["net"] = DiagramSpec.model_validate(
        {
            "title": "Net",
            "direction": "LR",
            "groups": [{"id": "guest", "label": "Guest", "sublabel": "10.0.9.0/24"}],
            "nodes": [
                {"id": "r1", "label": "R1", "icon": "router"},
                {"id": "ap", "label": "AP", "icon": "box", "group": "guest"},
            ],
            "edges": [],
        }
    )
    said = sentences('Gone. [[remove net.guest]] [[remove d.q2]] [[rename net.r1 "Edge"]]', board)
    assert [pair for s in said for pair in named_rows(s)] == [
        (row("clear", "board", "net.guest"), "Guest 10.0.9.0/24"),
        (row("clear", "board", "d.q2"), "q2"),
        (row("draw", "board", "net.r1"), "Edge"),
    ]


def test_a_drawing_is_one_draw_row_named_by_its_item():
    assert rows("Here it is. [[dfa ends start=q0 q0-0-q1]]") == [row("draw", "board", "ends")]


def test_steps_that_only_animate_make_no_rows():
    board = BoardContext()
    rows("[[dfa ends start=q0 q0-0-q1]]", board)
    assert rows("Watch q1. [[highlight ends q1]] [[pulse ends q1]]", board) == []


def test_clear_undo_and_redo_are_their_own_rows():
    board = BoardContext()
    board.begin_turn()
    assert rows("[[dfa ends start=q0 q0-0-q1]]", board) == [row("draw", "board", "ends")]
    board.end_turn()
    board.begin_turn()
    # An undo puts the board back with clears and redraws: still one undo row.
    assert rows("Taking that back. [[undo]]", board) == [row("undo", "board")]
    board.end_turn()
    board.begin_turn()
    assert rows("And again. [[redo]]", board) == [row("redo", "board")]
    board.end_turn()
    assert rows("Gone. [[clear ends]]", board) == [row("clear", "board", "ends")]


def test_a_paper_mark_names_its_mark():
    assert rows("Look here. [[circle m3]]") == [row("mark", "paper", "m1")]


def test_a_stage_tag_and_a_stage_event_are_view_rows():
    assert view_row("paper") == row("view", "paper")
    assert view_row("board") == row("view", "board")
    # Split shows the board beside her paper: the row moves the stage to the board.
    assert view_row("split") == row("view", "board")


def test_a_mark_on_her_image_names_its_mark_and_the_image():
    board = BoardContext(image=StageImage("a-1"))
    shown = MessageAction(kind="view", side="image", item=None, attachment_id="a-1")
    marked = MessageAction(kind="mark", side="image", item="m1", attachment_id="a-1")
    assert rows("[[image show]][[image circle m3]]This one.", board) == [shown, marked]
    cleared = MessageAction(kind="clear", side="image", item=None, attachment_id="a-1")
    assert rows("All clean. [[image clear]]", board) == [cleared]
