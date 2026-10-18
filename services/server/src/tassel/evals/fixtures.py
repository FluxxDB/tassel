"""Synthetic pages for the eval: handwriting-like ink drawn with OpenCV's Hershey script font on a
plain sheet, never a camera frame. Each page knows where its ink is (truth boxes), so a paper mark
can be checked against what it was meant to land on.

A page goes through the stored-frame path a real turn takes (``turn_image._page_view``: page
finding, Set-of-Mark candidates, the marked model copy), and sets the board's paper elements as
``fresh_turn_image_for`` does. The sheet fills the frame, so marks share the fixture's pixels.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import cache
from types import SimpleNamespace
from typing import Literal
from uuid import UUID

import cv2
import numpy as np

from tassel.beats.markup import BoardContext
from tassel.vision.page import encode_jpeg
from tassel.vision.turn_image import CAPTION, PageView, TurnPage, _page_view, legend

WIDTH, HEIGHT = 1600, 1200
PAPER = (236, 243, 246)  # BGR: a warm off-white sheet.
INK = (70, 45, 40)  # BGR: dark blue-black pen.
SCRIPT = cv2.FONT_HERSHEY_SCRIPT_SIMPLEX
PLAIN = cv2.FONT_HERSHEY_SIMPLEX


@dataclass(frozen=True)
class Truth:
    """Where a piece of her ink is, in page pixels. ``cover``: a mark must cover most of it (a
    line of text); ``inside``: a mark must sit mostly inside it (a state, ring or label)."""

    box: tuple[int, int, int, int]
    match: Literal["cover", "inside"]


@dataclass(frozen=True)
class PageFixture:
    name: str
    jpeg: bytes
    width: int
    height: int
    truths: dict[str, Truth]


class _Sheet:
    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        noise = self.rng.integers(-4, 5, (HEIGHT, WIDTH, 1))
        self.img = (np.full((HEIGHT, WIDTH, 3), PAPER, np.int16) + noise).clip(0, 255)
        self.img = self.img.astype(np.uint8)
        self.truths: dict[str, Truth] = {}

    def text(self, s, x, y, *, scale=2.2, thickness=4, font=SCRIPT, truth=None):
        """Write `s` with its baseline at y, one glyph at a time with a small hand wobble."""
        left, top, bottom = x, y, y
        for char in s:
            (w, h), base = cv2.getTextSize(char, font, scale, thickness)
            dy = int(self.rng.integers(-3, 4))
            cv2.putText(self.img, char, (x, y + dy), font, scale, INK, thickness, cv2.LINE_AA)
            top, bottom = min(top, y + dy - h), max(bottom, y + dy + base)
            x += w + int(self.rng.integers(-1, 3))
        if truth:
            self.truths[truth] = Truth((left - 4, top - 4, x - left + 8, bottom - top + 8), "cover")
        return x

    def ring(self, cx, cy, r):
        angles = np.linspace(0, 2 * math.pi, 90)
        pts = [
            (
                cx + (r + self.rng.normal(0, 1.2)) * math.cos(t),
                cy + (r + self.rng.normal(0, 1.2)) * math.sin(t),
            )
            for t in angles
        ]
        cv2.polylines(self.img, [np.array(pts, np.int32)], True, INK, 4, cv2.LINE_AA)

    def state(self, name, cx, cy, *, r=80, accept=False):
        self.ring(cx, cy, r)
        if accept:
            self.ring(cx, cy, r - 18)
        (w, h), _ = cv2.getTextSize(name, SCRIPT, 1.4, 3)
        cv2.putText(self.img, name, (cx - w // 2, cy + h // 2), SCRIPT, 1.4, INK, 3, cv2.LINE_AA)
        self.truths[name] = Truth((cx - r - 6, cy - r - 6, 2 * r + 12, 2 * r + 12), "inside")

    def arrow(self, x1, y1, x2, y2, label):
        cv2.arrowedLine(self.img, (x1, y1), (x2, y2), INK, 4, cv2.LINE_AA, tipLength=0.15)
        mx, my = (x1 + x2) // 2, (y1 + y2) // 2
        cv2.putText(self.img, label, (mx - 10, my - 20), SCRIPT, 1.4, INK, 3, cv2.LINE_AA)

    def done(self, name) -> PageFixture:
        rgb = cv2.cvtColor(self.img, cv2.COLOR_BGR2RGB)
        return PageFixture(name, encode_jpeg(rgb), WIDTH, HEIGHT, dict(self.truths))


def ip_page() -> PageFixture:
    """Her subnetting notes: an address with its prefix, the mask, and a zone label."""
    sheet = _Sheet(seed=1)
    sheet.text("10.0.0.0/24", 160, 260, scale=2.4, truth="ip")
    sheet.text("255.255.255.0", 160, 420, scale=2.0, truth="mask")
    sheet.text("Sales", 160, 600, scale=2.0, truth="label")
    sheet.text("30 hosts", 760, 600, scale=2.0, truth="hosts")
    return sheet.done("ip-page")


def dfa_page() -> PageFixture:
    """Her DFA for strings that start with 010, with a mistake: q3 isn't accepting."""
    sheet = _Sheet(seed=2)
    sheet.text("starts with 010", 160, 200, scale=2.0, truth="title")
    states = [("q0", 300, 700), ("q1", 620, 700), ("q2", 940, 700), ("q3", 1260, 700)]
    for name, cx, cy in states:
        sheet.state(name, cx, cy)
    for (_, x1, y), (_, x2, _), symbol in zip(states, states[1:], "010", strict=False):
        sheet.arrow(x1 + 84, y, x2 - 84, y, symbol)
    # The start arrow into q0.
    cv2.arrowedLine(sheet.img, (110, 700), (214, 700), INK, 4, cv2.LINE_AA, tipLength=0.2)
    return sheet.done("dfa-page")


FIXTURES: dict[str, Callable[[], PageFixture]] = {"ip-page": ip_page, "dfa-page": dfa_page}


@cache
def render(name: str) -> PageFixture:
    return FIXTURES[name]()


@cache
def _view(name: str) -> PageView:
    # One stored frame per page: the same page on later turns is the same frame.
    row = SimpleNamespace(
        meta={},
        id=UUID(int=sorted(FIXTURES).index(name) + 1),
        captured_at=datetime.now(UTC),
    )
    view = _page_view(render(name).jpeg, row)
    if view is None:
        raise ValueError(f"No page view for fixture {name}")
    return view


def page_view(name: str) -> PageView:
    """The page view for a fixture (CPU work: call it off the event loop)."""
    return _view(name)


def turn_page(page: PageFixture, board: BoardContext) -> tuple[TurnPage, dict[str, dict]]:
    """The turn's page as the model sees it, with the board's paper elements set, and each mark
    id's box in page pixels."""
    view = page_view(page.name)
    view.set_context(board)
    elements = {e.id: e.box.model_dump(mode="json") for e in view.elements}
    turn = TurnPage(view.marked_jpeg, CAPTION + legend(view), ink_image=view.page_jpeg)
    return turn, elements


def overlap_ok(box: dict, truth: Truth, *, share: float = 0.5) -> bool:
    """Whether a mark's box lands on this truth: covering most of a text line, or sitting mostly
    inside a state."""
    tx, ty, tw, th = truth.box
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    ix = max(0.0, min(x + w, tx + tw) - max(x, tx))
    iy = max(0.0, min(y + h, ty + th) - max(y, ty))
    inter = ix * iy
    if truth.match == "cover":
        return inter >= share * tw * th
    return w * h > 0 and inter >= share * w * h
