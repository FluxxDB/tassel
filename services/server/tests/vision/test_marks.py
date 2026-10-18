"""Real OpenCV on noisy synthetic camera frames; truth is used only by assertions."""

import json
from math import hypot

import cv2
import numpy as np
import pytest

from tassel.domains.dfa.contract import Pt
from tassel.vision.clips import frame_at
from tassel.vision.marks import Candidates, CircleMark, LabelMark, draw_marks, find_candidates
from tassel.vision.page import FlatPage, flatten_page


def demo(clip, t_ms=47100, noise=True):
    files = clip("dfa-demo", noise=noise)
    return flatten_page(frame_at(files.mjpeg, t_ms), None), json.loads(files.truth.read_text())


def contains(label, point, page):
    x, y = point["x"] * page.width, point["y"] * page.height
    pad = 0.02 * page.width
    return label.x - pad <= x <= label.x + label.w + pad and (
        label.y - pad <= y <= label.y + label.h + pad
    )


def test_four_circles_and_one_accept(clip):
    page, truth = demo(clip)
    circles = find_candidates(page).circles
    assert len(circles) == 4
    for c, state in zip(circles, truth["dfa"]["states"], strict=True):
        assert (
            hypot(
                c.cx - state["center"]["x"] * page.width, c.cy - state["center"]["y"] * page.height
            )
            < 0.2 * c.r
        )
        assert abs(c.r - state["radius"] * page.width) < 0.2 * c.r
        assert c.inner == state["accept"]


@pytest.mark.parametrize("t_ms", [26700, 38500, 47100])
def test_labels_cover_every_transition(clip, t_ms, monkeypatch):
    # Exercise label detection without selection: the model cap intentionally omits
    # smaller labels. The separate crowded-page test verifies that cap.
    monkeypatch.setattr("tassel.vision.marks.MAX_MARKS", 40)
    page, truth = demo(clip, t_ms)
    labels = find_candidates(page).labels
    for edge in truth["dfa"]["transitions"]:
        present = (
            edge["from"] != edge["to"]
            or (edge["from"] == "q3" and t_ms >= 38500)
            or (edge["from"] == "q0" and t_ms >= 47100)
        )
        covered = any(contains(label, edge["labelAt"], page) for label in labels)
        assert covered == present, edge


def test_numbering_is_deterministic_and_capped(clip):
    page, _ = demo(clip)
    first = find_candidates(page)
    assert first == find_candidates(page)
    marks = [m.mark for m in (*first.circles, *first.labels)]
    assert marks == list(range(1, len(marks) + 1))
    assert len(marks) <= 12
    # More than forty disconnected ink groups, so the cap actually has to act.
    rgb = np.full((1200, 1568, 3), 255, np.uint8)
    for row in range(6):
        for col in range(10):
            x, y = 30 + col * 150, 40 + row * 180
            side = 15 if row == 0 else 25
            cv2.rectangle(rgb, (x, y), (x + side, y + side), (0, 0, 0), -1)
    crowded = FlatPage(rgb, 1568, 1200, page.quad, True)
    candidates = find_candidates(crowded)
    assert candidates == find_candidates(crowded)
    assert len(candidates.labels) == 12
    assert not candidates.circles
    assert all(label.y > 100 for label in candidates.labels)  # smallest groups lose
    assert [m.mark for m in candidates.labels] == list(range(1, 13))


def test_draw_marks_keeps_inner_disks_clear(clip):
    page, _ = demo(clip)
    c = find_candidates(page)
    original = page.rgb.copy()
    marked = draw_marks(page, c)
    assert np.any(marked != original)
    assert np.any(np.all(marked == (29, 78, 216), axis=2))
    yy, xx = np.ogrid[: page.height, : page.width]
    for circle in c.circles:
        disk = (xx - circle.cx) ** 2 + (yy - circle.cy) ** 2 <= (0.9 * circle.r) ** 2
        np.testing.assert_array_equal(marked[disk], original[disk])
    np.testing.assert_array_equal(page.rgb, original)


def test_noise_doesnt_change_the_circles(clip):
    noisy, _ = demo(clip)
    clean, _ = demo(clip, noise=False)
    a, b = find_candidates(noisy).circles, find_candidates(clean).circles
    assert len(a) == len(b) == 4
    for c, d in zip(a, b, strict=True):
        assert hypot(c.cx - d.cx, c.cy - d.cy) < 0.1 * c.r
        assert c.inner == d.inner


def test_marks_protect_nearby_circles_and_do_not_mutate_mask():
    rgb = np.full((500, 700, 3), 245, np.uint8)
    q = (Pt(x=0, y=0), Pt(x=700, y=0), Pt(x=700, y=500), Pt(x=0, y=500))
    page = FlatPage(rgb, 700, 500, q, True)
    c = Candidates(
        (CircleMark(1, 200, 200, 50, False), CircleMark(2, 250, 150, 50, True)),
        (LabelMark(3, 190, 190, 20, 20),),
    )
    marked = draw_marks(page, c)
    yy, xx = np.ogrid[:500, :700]
    for circle in c.circles:
        disk = (xx - circle.cx) ** 2 + (yy - circle.cy) ** 2 <= (0.9 * circle.r) ** 2
        np.testing.assert_array_equal(marked[disk], rgb[disk])
    mask = np.zeros((500, 700), np.uint8)
    before = mask.copy()
    assert find_candidates(page, mask) == Candidates((), ())
    np.testing.assert_array_equal(mask, before)


def test_closed_states_are_separate_from_open_transition_arcs():
    rgb = np.full((800, 1000, 3), 255, np.uint8)
    cv2.circle(rgb, (230, 430), 60, (0, 0, 0), 3)
    cv2.circle(rgb, (710, 570), 70, (0, 0, 0), 3)
    cv2.circle(rgb, (710, 570), 56, (0, 0, 0), 3)
    # An attached open self-loop plus a detached arc, at non-demo positions/sizes.
    cv2.ellipse(rgb, (230, 350), (35, 35), 0, 140, 400, (0, 0, 0), 3)
    cv2.ellipse(rgb, (500, 200), (45, 45), 0, 40, 300, (0, 0, 0), 3)
    quad = (Pt(x=0, y=0), Pt(x=1000, y=0), Pt(x=1000, y=800), Pt(x=0, y=800))
    circles = find_candidates(FlatPage(rgb, 1000, 800, quad, True)).circles
    assert len(circles) == 2
    for circle, (x, y, accept) in zip(circles, [(230, 430, False), (710, 570, True)], strict=True):
        assert hypot(circle.cx - x, circle.cy - y) < 3
        assert circle.inner == accept


def test_nearby_label_tags_remain_distinct():
    rgb = np.full((1200, 1568, 3), 255, np.uint8)
    quad = (Pt(x=0, y=0), Pt(x=1568, y=0), Pt(x=1568, y=1200), Pt(x=0, y=1200))
    page = FlatPage(rgb, 1568, 1200, quad, True)
    # Distinct candidate boxes can share the same top-right anchor.
    labels = (
        LabelMark(1, 100, 100, 30, 20),
        LabelMark(2, 110, 100, 20, 20),
        LabelMark(3, 120, 5, 10, 20),
        LabelMark(4, 110, 5, 20, 20),
    )
    marked = draw_marks(page, Candidates((), labels))
    blue = np.all(marked == (29, 78, 216), axis=2).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(blue)
    assert count - 1 == 4
    assert all(s[4] > 10 for s in stats[1:])
