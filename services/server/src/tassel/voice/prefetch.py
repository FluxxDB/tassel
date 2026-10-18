"""The ladder's next step, thought ahead (owner, 2026-10-18: "the agent takes too long").

After Ada's step 0 or 1 on her paper, the likely next turn is "no" or "I still don't get it": the
ladder climbs, and the thinker's brief for that rung comes from her page, the notes and the rung,
not from her exact words. So while Ada speaks, the thinker's call for the next rung runs in the
background. The turn that climbs to that rung, right after, with her page unchanged, takes it
instead of calling the thinker (6–7 s in the ladder eval); any other turn drops it. Only the model
call is ahead: pointing, the action checker and its repair run on the real turn, against the board
as it is then."""

import asyncio
import time
from dataclasses import dataclass, field

import numpy as np

from tassel.voice.history import windowed
from tassel.voice.ladder import INK_CHANGE, TOP

# The stuck line standing in for her answer, per rung reached.
STUCK = {1: "No, I can't see it.", 2: "I still don't get it."}


@dataclass
class Ahead:
    step: int
    # The coordinator's turn this was thought after: only the next turn may take it.
    turn: int
    ink: np.ndarray | None
    task: asyncio.Task
    started: float = field(default_factory=time.monotonic)

    def fits(self, step: int | None, attempt: bool, turn: int, ink) -> str | None:
        """Why this turn can't take it, or None when it can."""
        if attempt or step != self.step:
            return "rung"
        if turn != self.turn + 1:
            return "turn"
        if ink is None or self.ink is None or ink.shape != self.ink.shape:
            return "page"
        if float(np.mean(ink != self.ink)) > INK_CHANGE:
            return "page"
        return None


def next_step(step: int | None, attempt: bool, problem: str | None) -> int | None:
    """The rung worth thinking ahead after this one, or None."""
    if problem != "paper" or attempt or step is None or step >= TOP:
        return None
    return step + 1


def next_request(
    context_messages: list[dict],
    *,
    say: str,
    step: int,
    note: str,
    page: list[dict],
    window: int,
    notes_prefix: str,
    drop_prefixes: tuple[str, ...] = (),
) -> list[dict]:
    """The messages the next rung's turn would send: the conversation (her page only on her
    latest line, never earlier), Ada's reply, her stuck line with the page, the tutor notes, then
    the rung's note. As on a real turn (``TutorCoordinator._notes_context``), the notes follow her
    latest line and the transient notes (``drop_prefixes``) are gone."""
    notes = []
    body = []
    for message in context_messages:
        content = message.get("content")
        if message.get("role") == "system" and isinstance(content, str):
            if content.startswith(notes_prefix):
                notes.append(message)
                continue
            if drop_prefixes and content.startswith(drop_prefixes):
                continue
        if isinstance(content, list):
            text = [p for p in content if p.get("type") not in ("image", "image_url")]
            message = {**message, "content": text}
        body.append(message)
    last = next((m for m in reversed(body) if m.get("role") != "system"), None)
    if not (last and last.get("role") == "assistant" and last.get("content") == say):
        body.append({"role": "assistant", "content": say})
    body.append({"role": "user", "content": [{"type": "text", "text": STUCK[step]}, *page]})
    return [*windowed([*body, *notes], window), {"role": "system", "content": note}]
