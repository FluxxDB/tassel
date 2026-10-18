"""Offline regressions at Desk View resolution."""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import cv2
import numpy as np

from tassel.vision.marks import Candidates, LabelMark, draw_marks
from tassel.vision.page import FlatPage, decode_jpeg, encode_jpeg
from tassel.vision.turn_image import _page_view


def test_real_size_page_budget(monkeypatch):
    rgb = np.random.default_rng(42).integers(190, 256, (1440, 1920, 3), dtype=np.uint8)
    for y in range(150, 1300, 100):
        cv2.putText(rgb, "Language for 0101?", (180, y), 0, 2, (20, 20, 20), 3)
    page = FlatPage(rgb, 1920, 1440, (), True)
    monkeypatch.setattr("tassel.vision.turn_image.flatten_page", lambda *_: page)
    view = _page_view(
        encode_jpeg(rgb), SimpleNamespace(meta={}, id=uuid.uuid4(), captured_at=datetime.now(UTC))
    )
    assert max(decode_jpeg(view.marked_jpeg).shape[:2]) <= 1024
    assert len(view.marked_jpeg) < 90_000
    assert decode_jpeg(view.page_jpeg).shape == rgb.shape
    print(f"1920x1440: {len(encode_jpeg(rgb))} -> {len(view.marked_jpeg)} bytes")


def test_badges_never_overwrite_ink_and_skip_when_no_room():
    rgb = np.full((500, 700, 3), 255, np.uint8)
    rgb[60:100, 100:400] = 0
    page = FlatPage(rgb, 700, 500, (), True)
    marked = draw_marks(page, Candidates((), (LabelMark(7, 100, 100, 30, 20),)))
    np.testing.assert_array_equal(marked[rgb[:, :, 0] == 0], rgb[rgb[:, :, 0] == 0])
    black = np.zeros_like(rgb)
    np.testing.assert_array_equal(
        draw_marks(
            FlatPage(black, 700, 500, (), True), Candidates((), (LabelMark(7, 100, 100, 30, 20),))
        ),
        black,
    )


def test_skipped_badge_does_not_renumber_remaining_element(monkeypatch):
    rgb = np.full((500, 700, 3), 255, np.uint8)
    rgb[:, :350] = 0
    page = FlatPage(rgb, 700, 500, (), True)
    candidates = Candidates((), (LabelMark(7, 100, 100, 30, 20), LabelMark(9, 500, 100, 30, 20)))
    monkeypatch.setattr("tassel.vision.turn_image.flatten_page", lambda *_: page)
    monkeypatch.setattr("tassel.vision.turn_image.find_candidates", lambda *_: candidates)
    view = _page_view(
        encode_jpeg(rgb), SimpleNamespace(meta={}, id=uuid.uuid4(), captured_at=datetime.now(UTC))
    )
    assert [el.id for el in view.elements] == ["m9"]
    assert view.elements[0].box.x == 500
