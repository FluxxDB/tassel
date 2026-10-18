"""Set-of-Mark on a raw Desk View frame (tassel.vision.synth.desk_view), never a camera frame.

The owner's live session (2026-10-18): every stored frame gave zero marks. His frames have a
blue cast, a left-to-right brightness gradient, thin faint pencil, and a black band along the
bottom where the de-warp has no desk; the page fills the rest and is never flattened. The ink
mask called a tenth of the frame ink (mostly the band), the three small states were below the
smallest radius looked for, and every tag counted the blue paper as dark, so none was drawn.
"""

from datetime import UTC, datetime
from uuid import uuid4

import numpy as np
import pytest

from tassel.frames.tables import Frame
from tassel.vision.marks import Candidates, LabelMark, draw_marks, find_candidates
from tassel.vision.page import encode_jpeg, ink_mask
from tassel.vision.synth import DESK_VIEW, LANGUAGE, MASK, SUBNET, USABLE, desk_view
from tassel.vision.turn_image import TURN_MAX_MARKS, _page_view

VARIANTS = [
    dict(seed=0),
    dict(seed=1, gradient=0.3, quality=70),
    dict(seed=2, pen_alpha=0.5, grain=2.0),
    dict(seed=3, cast=(0.6, 0.7, 0.95), band=0.12),
]
IDS = ["base", "steep-jpeg70", "faint-grainy", "less-blue"]
LINES = [LANGUAGE, SUBNET, MASK, USABLE]


def on_line(mark, truth):
    """A marker on this written line: within its height, over at least 40 % of its width or a
    fifth of the frame (a long line is split into word-sized markers)."""
    x, y, w, h = mark
    tx, ty, tw, th = truth
    across = max(0.0, min(x + w, tx + tw) - max(x, tx))
    middle = y + h / 2
    return ty <= middle <= ty + th and across >= min(0.4 * tw, 0.2 * 1920) and h < 2 * th


def covered(inner, outer):
    """The fraction of `inner`'s area inside `outer`."""
    ix = max(0.0, min(inner[0] + inner[2], outer[0] + outer[2]) - max(inner[0], outer[0]))
    iy = max(0.0, min(inner[1] + inner[3], outer[1] + outer[3]) - max(inner[1], outer[1]))
    return ix * iy / (inner[2] * inner[3])


def band_top(s, variant):
    return (1 - variant.get("band", DESK_VIEW["band"])) * s.page.height


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_the_ink_mask_is_her_pencil_not_the_desk(variant):
    s = desk_view(**variant)
    mask = ink_mask(s.page) != 0
    assert 0.003 < mask.mean() < 0.04
    assert not mask[round(band_top(s, variant)) - 4 :].any()
    # Most of each state's ring is ink, so the ring can be found.
    for t in s.truth:
        if t.kind == "state":
            x, y, w, h = map(round, t.box)
            ring = np.zeros_like(mask)
            ring[y : y + h, x : x + w] = True
            assert mask[ring].mean() > 0.04


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_the_three_small_states_are_circles(variant):
    s = desk_view(**variant)
    c = find_candidates(s.page)
    states = [t for t in s.truth if t.kind == "state"]
    assert len(c.circles) == len(states) == 3
    for state, accept in zip(states, (True, False, True), strict=True):
        x, y, w, h = state.box
        circle = min(c.circles, key=lambda m: abs(m.cx - (x + w / 2)) + abs(m.cy - (y + h / 2)))
        assert abs(circle.cx - (x + w / 2)) < 0.2 * w and abs(circle.cy - (y + h / 2)) < 0.2 * h
        assert circle.inner is accept


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_each_written_line_gets_a_marker_and_the_desk_and_divider_none(variant):
    s = desk_view(**variant)
    c = find_candidates(s.page)
    assert len(c.circles) + len(c.labels) < 25
    for text in LINES:
        truth = s.find(text).box
        assert any(on_line((m.x, m.y, m.w, m.h), truth) for m in c.labels), text
    top = band_top(s, variant)
    assert all(m.y + m.h < top for m in c.labels)
    divider = next(t.box for t in s.truth if t.kind == "line")
    for m in c.labels:
        assert covered((m.x, m.y, m.w, m.h), divider) < 0.5


def row(meta):
    return Frame(id=uuid4(), captured_at=datetime.now(UTC), meta=meta)


FALLBACK = [
    {"x": 192, "y": 144},
    {"x": 1728, "y": 144},
    {"x": 1728, "y": 1296},
    {"x": 192, "y": 1296},
]


@pytest.mark.parametrize(
    "meta",
    [
        {"page_found": False, "page_quad": None, "trigger": "turn"},
        # The detector sends its fallback region when it finds no page: it isn't a page, and
        # flattening it would cut off her first lines and keep the desk band.
        {"page_found": False, "page_quad": FALLBACK, "trigger": "detector"},
    ],
    ids=["turn", "detector-fallback"],
)
def test_a_stored_desk_view_frame_gives_ada_marks(meta):
    s = desk_view()
    view = _page_view(encode_jpeg(s.page.rgb, quality=88), row(meta))
    assert (view.width, view.height) == (s.page.width, s.page.height)
    kinds = [e.kind for e in view.elements]
    assert kinds.count("circle") == 3
    assert 3 <= kinds.count("label") and len(kinds) <= TURN_MAX_MARKS
    for text in (SUBNET, MASK, LANGUAGE):
        truth = s.find(text).box
        assert any(
            on_line((e.box.x, e.box.y, e.box.w, e.box.h), truth)
            for e in view.elements
            if e.kind == "label"
        ), text


def test_a_mark_never_vanishes_for_want_of_empty_paper():
    """With ink everywhere a tag could go, it still goes on, on its own plate."""
    s = desk_view()
    page = s.page
    rng = np.random.default_rng(0)
    busy = page.rgb.copy()
    # Scribble over the whole frame so no tag position is free of ink.
    busy[rng.random(busy.shape[:2]) < 0.35] = (20, 20, 20)
    page = type(page)(busy, page.width, page.height, page.quad, page.found)
    labels = tuple(LabelMark(i + 1, 100.0 + 150 * i, 300.0, 80.0, 30.0) for i in range(5))
    drawn: set[int] = set()
    marked = draw_marks(page, Candidates((), labels), drawn=drawn)
    assert drawn == {1, 2, 3, 4, 5}
    assert not np.array_equal(marked, page.rgb)


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_every_candidate_is_drawn_on_blue_paper(variant):
    s = desk_view(**variant)
    c = find_candidates(s.page)
    drawn: set[int] = set()
    draw_marks(s.page, c, drawn=drawn)
    assert drawn == {m.mark for m in (*c.circles, *c.labels)}
