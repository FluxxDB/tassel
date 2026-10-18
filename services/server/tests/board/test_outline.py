"""The board outline: what the thinker sees of the board, every part named the way [[remove]] and
[[rename]] take it, plus what [[undo]] and [[redo]] would put back; the talker gets one line."""

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.models import BEAT_ACTION
from tassel.board.history import replay
from tassel.board.outline import outline, outline_items, summary

NET = {
    "title": "Two networks",
    "direction": "LR",
    "groups": [
        {"id": "lan10", "label": "Internal", "sublabel": "10.0.0.0/26"},
        {"id": "lan192", "label": "Sales", "sublabel": "192.168.1.0/24"},
    ],
    "nodes": [
        {"id": "core", "label": "Core", "icon": "router"},
        {"id": "pc1", "label": "PC 1", "sublabel": "10.0.0.2", "icon": "pc", "group": "lan10"},
        {"id": "pc3", "label": "PC 3", "icon": "pc", "group": "lan192"},
    ],
    "edges": [
        {"from": "core", "to": "pc1", "directed": False, "style": "solid"},
        {"from": "core", "to": "pc3", "directed": False, "style": "solid"},
    ],
}


def board():
    ctx = BoardContext()
    replay(ctx, [BEAT_ACTION.validate_python({"kind": "board.diagram", "item": "net", "spec": NET})])
    stream = MarkupStream(ctx)
    stream.feed('[[dfa d title="Ends in 1" start=q0 accept=q1 q0-0-q0 q0-1-q1 q1-0,1-q1]] ')
    stream.feed('[[note n1 "accepts here" near=d:q1]] Done.')
    stream.flush()
    return ctx


def test_the_outline_names_every_zone_node_and_state():
    text = outline(board())
    assert 'net: diagram "Two networks"' in text
    assert 'zone net.lan10 "Internal" 10.0.0.0/26 [net.pc1 pc "PC 1" 10.0.0.2]' in text
    assert 'zone net.lan192 "Sales" 192.168.1.0/24 [net.pc3 pc "PC 3"]' in text
    assert 'no zone [net.core router "Core"]' in text
    assert 'd: dfa "Ends in 1"; states d.q0 (start), d.q1 (accept)' in text
    assert 'n1: note "accepts here" by d.q1' in text
    assert "[[undo]]" not in text


def test_the_outline_says_what_undo_and_redo_would_restore():
    ctx = board()
    ctx.begin_turn()
    stream = MarkupStream(ctx)
    stream.feed("[[remove net.lan10]] Done.")
    stream.flush()
    ctx.end_turn()
    assert "[[undo]] would restore: net" in outline(ctx)
    ctx.undo()
    assert "[[redo]] would restore: net" in outline(ctx)


def test_the_summary_is_one_line_and_an_empty_board_says_so():
    line = summary(board())
    assert "\n" not in line
    assert line == "net (diagram, 2 zones, 3 nodes), d (dfa, 2 states), n1 (note)"
    assert summary(BoardContext()) == "The board is empty."
    assert set(outline_items(board())) == {"net", "d", "n1"}


def test_replay_restores_notes_traces_and_titles():
    ctx = BoardContext()
    replay(
        ctx,
        [
            BEAT_ACTION.validate_python(a)
            for a in [
                {
                    "kind": "board.automaton",
                    "item": "d",
                    "title": "T",
                    "spec": {"kind": "dfa", "states": [{"id": "a"}], "start": "a",
                             "transitions": []},
                },
                {"kind": "board.note", "item": "n1", "text": "hi"},
                {"kind": "board.trace", "item": "t", "on": "d", "input": "0",
                 "spec": {"kind": "dfa", "states": [{"id": "a"}], "start": "a",
                          "transitions": []}},
            ]
        ],
    )
    assert ctx.titles == {"d": "T"} and set(ctx.notes) == {"n1"} and ctx.traces == {"t": ("d", "0")}
