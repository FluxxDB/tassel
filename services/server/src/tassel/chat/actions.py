"""The chat's action rows: what Ada did on the stage, read from the tags of one of her sentences
(``beats.markup.Sentence``) or from a stage event, for the app to show and click to."""

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


def _row(kind, side, item=None) -> MessageAction:
    return MessageAction(kind=kind, side=side, item=item, attachment_id=None)


def view_row(view: Literal["paper", "board", "split"]) -> MessageAction:
    """A view switch. Split shows the board beside her paper, so its row goes to the board."""
    return _row("view", "paper" if view == "paper" else "board")


def rows_for(sentence: Sentence) -> list[MessageAction]:
    """One row per thing this sentence's tags did, in order: an [[undo]] or [[redo]] is one row
    however many items it changed, and several actions on one item are one drawing."""
    rows: list[MessageAction] = []
    origins = sentence.origins or [""] * len(sentence.anchors)
    last_step = None
    for (_, action), origin in zip(sentence.anchors, origins, strict=False):
        step = origin[2:-2].strip().lower() if origin.startswith("[[") else ""
        if step in ("undo", "redo"):
            if origin is not last_step:
                rows.append(_row(step, "board"))
            last_step = origin
            continue
        last_step = None
        row = _action_row(action)
        if row is not None and row not in rows:
            rows.append(row)
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
    return None
