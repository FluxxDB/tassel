"""The chat's action rows: what Ada did on the stage, read from the tags of one of her sentences
(``beats.markup.Sentence``) or from a stage event, for the app to show and click to."""

import re
from typing import Literal

from tassel.beats.markup import Sentence
from tassel.voice.messages import MessageAction

# Board actions that put something new on the board: each is a "drew" row. Reveals, highlights,
# pulses, trace steps, verdicts and focus only animate what is there.
_DRAWS = {
    "board.automaton",
    "board.diagram",
    "board.addState",
    "board.addTransition",
    "board.note",
    "board.trace",
}


def _row(kind, side, item=None, attachment_id=None) -> MessageAction:
    return MessageAction(kind=kind, side=side, item=item, attachment_id=attachment_id)


def view_row(view: Literal["paper", "board", "split"]) -> MessageAction:
    """A view switch. Split shows the board beside her paper, so its row goes to the board."""
    return _row("view", "paper" if view == "paper" else "board")


def rows_for(sentence: Sentence) -> list[MessageAction]:
    return [row for row, _ in named_rows(sentence)]


# [[remove ITEM.PART …]] and [[rename ITEM.PART "…"]]: rows that name the part.
_EDIT = re.compile(r"\[\[\s*(remove|rename)\s+([\w-]+)(?:\.([\w-]+)|\s+([\w-]+))?", re.I)


def named_rows(sentence: Sentence) -> list[tuple[MessageAction, str]]:
    """One row per thing this sentence's tags did, in order, each with the name the app shows
    for it ("" for its own words): an [[undo]] or [[redo]] is one row however many items it
    changed, and several actions on one item are one drawing. A removal or rename of a part
    is its own row, with the item as ITEM.PART and the part's name (CONTRACT?, B)."""
    rows: list[tuple[MessageAction, str]] = []
    origins = sentence.origins or [""] * len(sentence.anchors)
    named = sentence.named or [""] * len(sentence.anchors)
    last_step = None
    for (_, action), origin, name in zip(sentence.anchors, origins, named, strict=False):
        step = origin[2:-2].strip().lower() if origin.startswith("[[") else ""
        edit = _EDIT.match(origin)
        if edit and action.kind in ("board.diagram", "board.automaton"):
            verb, item, part, loose = edit.groups()
            kind = "clear" if verb.lower() == "remove" else "draw"
            target = f"{item}.{part or loose}" if part or loose else item
            rows.append((_row(kind, "board", target), name))
            last_step = None
            continue
        if step in ("undo", "redo"):
            if origin is not last_step:
                rows.append((_row(step, "board"), ""))
            last_step = origin
            continue
        last_step = None
        row = _action_row(action)
        if row is not None and row not in [r for r, _ in rows]:
            rows.append((row, ""))
    return rows


def _action_row(action) -> MessageAction | None:
    kind = action.kind
    if kind in _DRAWS:
        return _row("draw", "board", action.item)
    if kind == "board.clear":
        return _row("clear", "board", action.item)
    if kind == "paper.mark":
        return _row("mark", "paper", action.mark.id)
    if kind == "paper.unmark":
        return _row("clear", "paper", action.id)
    if kind == "paper.clear":
        return _row("clear", "paper")
    if kind == "stage":
        return view_row(action.view)
    # Her image: showing it is a view row, a mark or a clear names it.
    if kind == "image.show":
        return _row("view", "image", attachment_id=action.attachment_id)
    if kind == "image.mark":
        return _row("mark", "image", action.mark.id, action.attachment_id)
    if kind == "image.clear":
        return _row("clear", "image", attachment_id=action.attachment_id)
    return None
