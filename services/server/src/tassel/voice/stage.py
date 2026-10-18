"""Deterministic view policy. Times are supplied monotonic seconds; no tasks or model calls."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from tassel.voice.messages import StageHintEvent, StageStateEvent

View = Literal["paper", "board", "split"]
Side = Literal["paper", "board"]

LINES = {
    "board": {"en": "It's on the board.", "es": "Está en la pizarra.", "ko": "칠판에 있어요."},
    "paper": {"en": "Look at your paper.", "es": "Mira tu hoja.", "ko": "종이를 보세요."},
    "image": {"en": "Look at your image.", "es": "Mira tu imagen.", "ko": "이미지를 보세요."},
}


@dataclass
class StageDrawing:
    """The stage-relevant part of a brief, also used for checked fast-talker marks."""

    board: list[str]
    paper: list[str]
    say: str = ""
    draw: str | None = None
    # Marks on the student's image, which shows in the paper panel's slot.
    image: list[str] = field(default_factory=list)


class StageManager:
    def __init__(self, *, lang=lambda: "en", log: Callable | None = None):
        self.view: View = "paper"
        self.pin: View | None = None
        self.student_view: View = "paper"
        self.last_requested_view: View | None = None
        self._ada_switched = False
        self._pending_views: list[View] = []
        self._reported_view: View = "paper"
        self.last_switch = float("-inf")
        self.last_ink_change = float("-inf")
        self.last_drawing = float("-inf")
        self.page_revision = 0
        self.lang, self.log = lang, log
        self.hinted: set[Side] = set()

    def _record(self, before, reason):
        if self.log:
            self.log("stage", {"from": before, "to": self.view, "reason": reason})

    def on_state(self, state: StageStateEvent, now: float) -> None:
        before = self.view
        if state.page_revision != self.page_revision:
            self.last_ink_change = now
        self.page_revision = state.page_revision
        # Matching Ada's latest request is a renderer acknowledgement. A pin, or a
        # different view, is a student choice. The wire has no explicit origin field.
        if state.pinned is not None:
            self.student_view = state.pinned
            self._pending_views.clear()
        elif state.view in self._pending_views:
            # Earlier acknowledgements may arrive after the brief corrected the view.
            # Consume through this acknowledgement without forgetting the latest request.
            del self._pending_views[: self._pending_views.index(state.view) + 1]
        elif self._pending_views and state.view == self._reported_view:
            # Ink/freeze updates can repeat an intermediate acknowledged view.
            pass
        elif state.view != self.last_requested_view:
            self.student_view = state.view
            self._pending_views.clear()
        self._reported_view = state.view
        self.pin = state.pinned
        self.view = state.pinned or (self._pending_views[-1] if self._pending_views else state.view)
        self._ada_switched = (
            self.view != self.student_view and self.view == self.last_requested_view
        )
        self._record(before, "state")

    def _visible(self, side: Side) -> bool:
        return self.view in (side, "split")

    def _request(self, target: View | None, now: float, reason: str, *, final=False):
        before = self.view
        if target == "board" and self.view != "board" and now - self.last_ink_change < 6:
            target = "split"
        if target is None or target == self.view:
            reason = "already-visible" if target else "no-visual-need"
        elif self.pin is not None:
            reason = "pinned"
        elif not final and now - self.last_switch < 4:
            reason = "debounce"
        else:
            self.view = target
            self.last_requested_view = target
            self._pending_views.append(target)
            self._ada_switched = target != self.student_view
            self.last_switch = now
            self._record(before, reason)
            return target
        self._record(before, reason)
        return None

    def _target(self, paper: bool, board: bool, now: float) -> View | None:
        if not paper and not board:
            return None
        if (not paper or self._visible("paper")) and (not board or self._visible("board")):
            return self.view
        # Ada only ever opens the split view: the side she needs shows beside the other, and
        # full screen is the student's (owner, 2026-10-18).
        return "split"

    def on_turn(self, decision, now: float) -> View | None:
        self.hinted.clear()
        # Her image takes the paper panel's slot: a turn about it needs that side too.
        paper = (
            decision.needs_vision
            or decision.refers_to in ("paper", "image")
            or decision.action in ("mark_paper", "mark_image")
        )
        board = decision.refers_to == "board" or decision.action == "draw_board"
        if not paper and not board:
            return self.on_idle(now)
        preferred = self.pin or self.student_view
        if (not paper or preferred in ("paper", "split")) and (
            not board or preferred in ("board", "split")
        ):
            returned = self.on_idle(now)
            if returned is not None:
                return returned
        target = self._target(paper, board, now)
        if target is not None and target != self.view and decision.focus == "split":
            target = "split"
        return self._request(target, now, "turn")

    def on_brief(self, brief, decision, now: float) -> View | StageHintEvent | None:
        # A draw intent is emitted only on these director routes (TutorCoordinator._run).
        board = bool(brief.board) or bool(
            brief.draw
            and (
                decision.action == "draw_board"
                or (decision.action in ("explain", "trace") and decision.refers_to == "board")
            )
        )
        paper = bool(brief.paper) or bool(getattr(brief, "image", None))
        if paper or board:
            self.last_drawing = now
        if self.pin is not None:
            for side, drawing in (("paper", paper), ("board", board)):
                if drawing and not self._visible(side) and side not in self.hinted:
                    self.hinted.add(side)
                    # Marks on her image alone: the line names the image, the side stays paper.
                    image_only = side == "paper" and not brief.paper
                    line = LINES["image" if image_only else side][self.lang()]
                    brief.say = brief.say.rstrip() + " " + line
                    self._record(self.view, "hidden-" + side)
                    return StageHintEvent(side=side)
        # The checked brief is authoritative: it must land before its first drawing beat.
        return self._request(self._target(paper, board, now), now, "brief", final=True)

    def on_idle(self, now: float) -> View | None:
        if self._ada_switched and now - max(self.last_drawing, self.last_switch) >= 25:
            return self._request(self.pin or self.student_view, now, "idle")
        self._record(self.view, "idle-wait")
        return None
