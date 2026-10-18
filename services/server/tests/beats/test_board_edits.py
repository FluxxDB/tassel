"""Element-level board edits (owner, 2026-10-18: "Ada removes exactly what was named"): [[remove
ITEM.PART …]] and [[rename ITEM[.PART] "…"]] are applied deterministically to the item's spec and
sent as the whole item redrawn in place, so undo, persistence and the app need nothing new."""

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.models import DiagramSpec

NET = DiagramSpec.model_validate(
    {
        "title": "Two networks",
        "direction": "LR",
        "groups": [
            {"id": "lan10", "label": "Internal", "sublabel": "10.0.0.0/26"},
            {"id": "lan192", "label": "Sales", "sublabel": "192.168.1.0/24"},
        ],
        "nodes": [
            {"id": "core", "label": "Core", "icon": "router"},
            {"id": "r10", "label": "R10", "icon": "router", "group": "lan10"},
            {"id": "pc1", "label": "PC 1", "icon": "pc", "group": "lan10"},
            {"id": "sw", "label": "Switch", "icon": "switch", "group": "lan192"},
            {"id": "pc3", "label": "PC 3", "icon": "pc", "group": "lan192"},
        ],
        "edges": [
            {"from": "core", "to": "r10", "directed": False, "style": "solid"},
            {"from": "r10", "to": "pc1", "directed": False, "style": "solid"},
            {"from": "core", "to": "sw", "directed": False, "style": "solid"},
            {"from": "sw", "to": "pc3", "directed": False, "style": "solid"},
        ],
    }
)
DFA = "[[dfa d title=\"Ends in 1\" start=q0 accept=q1 q0-0-q0 q0-1-q1 q1-0-q2 q1-1-q1 q2-0,1-q2]]"


def board():
    ctx = BoardContext()
    ctx.diagrams["net"] = NET
    run(ctx, DFA)
    return ctx


def run(ctx, *tags):
    stream = MarkupStream(ctx)
    sentences = stream.feed(" ".join(tags) + " Done.") + stream.flush()
    return sentences


def actions(sentences):
    return [a for s in sentences for _, a in s.anchors]


def test_removing_a_zone_takes_its_nodes_and_links_and_keeps_the_rest():
    ctx = board()
    sentences = run(ctx, "[[remove net.lan10]]")
    [action] = actions(sentences)
    assert action.kind == "board.diagram" and action.item == "net"
    spec = ctx.diagrams["net"]
    assert [g.id for g in spec.groups] == ["lan192"]
    assert [n.id for n in spec.nodes] == ["core", "sw", "pc3"]
    assert [(e.from_, e.to) for e in spec.edges] == [("core", "sw"), ("sw", "pc3")]
    assert action.spec == spec
    assert sentences[0].named == ["Internal 10.0.0.0/26"]
    assert "d" in ctx.specs


def test_removing_nodes_drops_their_links_and_a_zone_left_empty():
    ctx = board()
    run(ctx, "[[remove net.r10 net.pc1 net.pc3]]")
    spec = ctx.diagrams["net"]
    assert [n.id for n in spec.nodes] == ["core", "sw"]
    assert [g.id for g in spec.groups] == ["lan192"]
    assert [(e.from_, e.to) for e in spec.edges] == [("core", "sw")]


def test_parts_may_follow_the_item_without_dots():
    ctx = board()
    run(ctx, "[[remove net pc1 pc3]]")
    assert [n.id for n in ctx.diagrams["net"].nodes] == ["core", "r10", "sw"]


def test_removing_every_node_clears_the_item():
    ctx = board()
    [action] = actions(run(ctx, "[[remove net.lan10 net.lan192 net.core]]"))
    assert action.kind == "board.clear" and action.item == "net"
    assert "net" not in ctx.diagrams


def test_removing_a_state_drops_its_moves_and_keeps_the_title():
    ctx = BoardContext()
    run(ctx, "[[nfa n title=\"Guess\" start=a accept=c a-0-b b-1-c a-1-c]]")
    [action] = actions(run(ctx, "[[remove n.b]]"))
    assert action.kind == "board.automaton" and action.title == "Guess"
    assert [s.id for s in ctx.specs["n"].states] == ["a", "c"]
    assert [(t.from_, t.to) for t in ctx.specs["n"].transitions] == [("a", "c")]


def test_an_unknown_part_or_the_start_state_is_a_bad_command():
    ctx = board()
    sentences = run(ctx, "[[remove net.guest]] [[remove d.q0]]")
    assert actions(sentences) == []
    assert len([p for s in sentences for p in s.problems]) == 2
    assert ctx.diagrams["net"] == NET


def test_rename_a_zone_a_node_and_a_title():
    ctx = board()
    sentences = run(
        ctx,
        '[[rename net.lan192 "Sales floor"]] [[rename net.core "Edge"]] [[rename d "Odd ones"]]',
    )
    kinds = [a.kind for a in actions(sentences)]
    assert kinds == ["board.diagram", "board.diagram", "board.automaton"]
    spec = ctx.diagrams["net"]
    assert spec.groups[1].label == "Sales floor" and spec.groups[1].sublabel == "192.168.1.0/24"
    assert spec.nodes[0].label == "Edge"
    assert actions(sentences)[-1].title == "Odd ones"
    assert sentences[0].named == ["Sales floor", "Edge", "Odd ones"]


def test_a_removal_is_one_undo_step():
    ctx = board()
    ctx.begin_turn()
    run(ctx, "[[remove net.lan10]]")
    ctx.end_turn()
    assert ctx.undo_items() == ["net"]
    ctx.begin_turn()
    [action] = actions(run(ctx, "[[undo]]"))
    ctx.end_turn()
    assert action.kind == "board.diagram" and ctx.diagrams["net"] == NET


def test_notes_and_traces_are_tracked_and_go_with_their_item():
    ctx = board()
    run(ctx, '[[note n1 "ends here" near=d:q1]] [[trace t d 0101]]')
    assert set(ctx.notes) == {"n1"} and set(ctx.traces) == {"t"}
    run(ctx, "[[remove d.q2]]")
    assert "n1" in ctx.notes
    run(ctx, "[[remove d.q1]]")
    assert ctx.notes == {}  # it sat by q1
    run(ctx, '[[note n2 "the machine"]] [[note n3 "by d" near=d:start]] [[clear d]]')
    assert set(ctx.notes) == {"n2"}
    run(ctx, "[[clear]]")
    assert ctx.notes == {} and ctx.traces == {} and ctx.titles == {}
