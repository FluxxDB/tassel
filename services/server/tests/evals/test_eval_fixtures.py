"""Synthetic page fixtures: handwriting-like pages rendered in code (never a camera frame), sent
through the same page view a turn's stored frame takes, with truth boxes for the mark checks."""

import pytest

from tassel.beats.markup import BoardContext
from tassel.evals.fixtures import FIXTURES, overlap_ok, render, turn_page
from tassel.vision.turn_image import CAPTION


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_fixtures_render_the_same_page_every_time(name):
    page = render(name)
    assert page.jpeg.startswith(b"\xff\xd8")
    assert render(name) is page
    again = FIXTURES[name]()
    assert again.jpeg == page.jpeg and again.truths == page.truths
    for truth in page.truths.values():
        x, y, w, h = truth.box
        assert 0 <= x and 0 <= y and x + w <= page.width and y + h <= page.height


def test_a_turn_page_marks_the_fixture_and_sets_the_board():
    board = BoardContext()
    page = render("dfa-page")
    turn, elements = turn_page(page, board)
    assert turn.image.startswith(b"\xff\xd8") and turn.ink_image.startswith(b"\xff\xd8")
    assert turn.caption.startswith(CAPTION)
    detected = board.paper_elements.detected
    # The whole sheet is the page: marks are in the fixture's own pixel coordinates.
    assert (detected.width, detected.height) == (page.width, page.height)
    assert set(elements) == {item.id for item in detected.items}
    # The page view finds the drawn states.
    assert any(overlap_ok(box, page.truths["q0"]) for box in elements.values()), elements


def test_overlap_modes():
    page = render("ip-page")
    ip = page.truths["ip"]
    x, y, w, h = ip.box
    assert overlap_ok({"x": x, "y": y, "w": w, "h": h}, ip)
    assert not overlap_ok({"x": x, "y": y, "w": w * 0.2, "h": h}, ip)
