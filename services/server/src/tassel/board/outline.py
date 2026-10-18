"""The board outline: the board as the thinker reads it, a compact tree with every part named the
way [[remove ITEM.PART]] and [[rename ITEM.PART "…"]] take it, plus what [[undo]] and [[redo]]
would put back (owner, 2026-10-18: "every element and group has a name"). The talker and the
director get the one-line ``summary``.

    net: diagram "Office"; zone net.sales "Sales" 10.0.1.0/24 [net.pc1 pc "PC 1", …]; no zone
      [net.r1 router "R1"]; 4 links
    d: dfa "Ends in 1"; states d.q0 (start), d.q1 (accept); 4 moves
    n1: note "accepts here" by d.q1
"""

import json

from tassel.beats.markup import BoardContext

HEADER = (
    "Board outline (name a part as ITEM.PART in [[remove ITEM.PART …]] and "
    '[[rename ITEM.PART "NAME"]]; keep these ids when you redraw):'
)


def _q(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def _node(item, node) -> str:
    sub = f" {node.sublabel}" if node.sublabel else ""
    return f"{item}.{node.id} {node.icon} {_q(node.label)}{sub}"


def _diagram(item, spec) -> str:
    title = f" {_q(spec.title)}" if spec.title else ""
    parts = []
    for group in spec.groups:
        sub = f" {group.sublabel}" if group.sublabel else ""
        nodes = ", ".join(_node(item, n) for n in spec.nodes if n.group == group.id)
        parts.append(f"zone {item}.{group.id} {_q(group.label)}{sub} [{nodes}]")
    loose = [_node(item, n) for n in spec.nodes if n.group is None]
    if loose:
        parts.append(f"no zone [{', '.join(loose)}]")
    parts.append(f"{len(spec.edges)} links")
    return f"{item}: diagram{title}; " + "; ".join(parts)


def _automaton(item, spec, title) -> str:
    named = f" {_q(title)}" if title else ""
    states = []
    for state in spec.states:
        flags = [f for f, on in (("start", state.id == spec.start), ("accept", state.accept)) if on]
        states.append(f"{item}.{state.id}" + (f" ({', '.join(flags)})" if flags else ""))
    return f"{item}: {spec.kind}{named}; states {', '.join(states)}; {len(spec.transitions)} moves"


def _note(item, note) -> str:
    text, near, el = note
    where = f" by {near}.{el.split(':', 1)[-1]}" if near and el and el != "start" else ""
    if near and not where:
        where = f" by {near}"
    return f"{item}: note {_q(text)}{where}"


def outline_items(board: BoardContext) -> dict[str, str]:
    """Each item's outline line, by its id."""
    items = {}
    for item, spec in board.diagrams.items():
        items[item] = _diagram(item, spec)
    for item, spec in board.specs.items():
        items[item] = _automaton(item, spec, board.titles.get(item))
    for item, note in board.notes.items():
        items[item] = _note(item, note)
    for item, (on, text) in board.traces.items():
        items[item] = f"{item}: trace of {_q(text)} on {on}"
    return items


def outline(board: BoardContext) -> str:
    lines = list(outline_items(board).values())
    if not lines:
        lines = ["The board is empty."]
    steps = [
        f"{tag} would restore: {', '.join(items)}"
        for tag, items in (("[[undo]]", board.undo_items()), ("[[redo]]", board.redo_items()))
        if items
    ]
    return "\n".join([HEADER, *lines, *(["; ".join(steps)] if steps else [])])


def summary(board: BoardContext) -> str:
    """One line: each item with its kind and size."""
    parts = []
    for item, spec in board.diagrams.items():
        zones = f"{len(spec.groups)} zones, " if spec.groups else ""
        parts.append(f"{item} (diagram, {zones}{len(spec.nodes)} nodes)")
    for item, spec in board.specs.items():
        parts.append(f"{item} ({spec.kind}, {len(spec.states)} states)")
    parts += [f"{item} (note)" for item in board.notes]
    parts += [f"{item} (trace)" for item in board.traces]
    return ", ".join(parts) if parts else "The board is empty."
