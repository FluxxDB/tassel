"""Box targets moved onto her ink, on synthetic Desk View pages (tassel.vision.synth).

Live (2026-10-18): with no markers, the pointer boxed the owner's "192.168.1.0/24" half a line
low, and the underline ran through "Subnet Mask" on the line below.
"""

import numpy as np
import pytest

from tassel.vision.ink_boxes import refine_box
from tassel.vision.page import ink_mask
from tassel.vision.synth import LANGUAGE, MASK, SUBNET, USABLE, desk_view

SHIFTS = [0.0, 0.3, 0.5, -0.4]  # The model's box, moved down by this many of its heights.


def norm(box, page):
    x, y, w, h = box
    return {"x": x / page.width, "y": y / page.height, "w": w / page.width, "h": h / page.height}


@pytest.fixture(scope="module")
def page():
    s = desk_view()
    return s, ink_mask(s.page) != 0


@pytest.mark.parametrize("shift", SHIFTS)
@pytest.mark.parametrize(("text", "below"), [(SUBNET, MASK), (MASK, USABLE)])
def test_an_underline_goes_under_the_line_she_meant_not_through_the_next(page, text, below, shift):
    s, mask = page
    x, y, w, h = s.find(text).box
    model = norm((x - 0.03 * w, y + shift * h, 1.06 * w, h), s.page)
    got = refine_box(mask, "underline", model)
    assert got is not None
    line_y = (got["y"] + got["h"]) * s.page.height
    x0, x1 = round(got["x"] * s.page.width), round((got["x"] + got["w"]) * s.page.width)
    # Under her line's ink…
    assert line_y >= y + h - 2
    # …above the next line's, and through no ink at all.
    assert line_y < s.find(below).box[1] + 2
    assert not mask[round(line_y), x0:x1].any()
    assert got["x"] * s.page.width == pytest.approx(x, abs=0.02 * w)


@pytest.mark.parametrize("verb", ["strike", "circle"])
def test_strike_and_circle_get_the_inks_own_box(page, verb):
    s, mask = page
    x, y, w, h = s.find(LANGUAGE).box
    got = refine_box(mask, verb, norm((x + 0.05 * w, y + 0.3 * h, 0.85 * w, 1.2 * h), s.page))
    gx, gy = got["x"] * s.page.width, got["y"] * s.page.height
    gw, gh = got["w"] * s.page.width, got["h"] * s.page.height
    # The whole line, which the model's box cut short on both sides, tight to its ink.
    assert gx <= x + 0.06 * w and gx + gw >= x + 0.9 * w
    assert abs(gy - y) < 0.25 * h and abs(gy + gh - (y + h)) < 0.25 * h


def test_a_box_over_blank_paper_is_left_as_it_is(page):
    s, mask = page
    assert refine_box(mask, "underline", {"x": 0.6, "y": 0.5, "w": 0.1, "h": 0.03}) is None
    assert refine_box(np.zeros_like(mask), "circle", norm(s.find(SUBNET).box, s.page)) is None
