"""Controlled reproductions of existing page-finder limitations, without real camera images.

These assert current failure behavior as audit evidence, not as intended product behavior.
"""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import cv2
import numpy as np

from tassel.vision.page import encode_jpeg, find_page_quad
from tassel.vision.turn_image import _page_view


def scene(background=45, paper=240, box=(160, 70, 480, 410)):
    image = np.full((480, 640, 3), background, np.uint8)
    x0, y0, x1, y1 = box
    cv2.rectangle(image, (x0, y0), (x1, y1), (paper,) * 3, -1)
    cv2.putText(image, "x + y = 2", (x0 + 20, y0 + 65), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20,) * 3, 2)
    return image


def test_control_high_contrast_page_detects():
    assert find_page_quad(scene()) is not None


def test_bright_background_and_dark_writing_merges_paper_with_background():
    assert find_page_quad(scene(background=230, paper=245)) is None


def test_small_visible_sheet_is_rejected_by_twenty_percent_area_floor():
    assert find_page_quad(scene(box=(250, 160, 390, 320))) is None


def test_paper_touching_frame_edge_is_rejected():
    assert find_page_quad(scene(box=(-20, 70, 480, 410))) is None


def test_bright_connection_to_background_hides_the_whole_page():
    image = scene()
    cv2.rectangle(image, (0, 150), (170, 175), (240,) * 3, -1)
    assert find_page_quad(image) is None


def test_larger_nonrectangular_distractor_prevents_trying_valid_page():
    image = scene(box=(360, 60, 620, 420))
    cv2.ellipse(image, (170, 240), (155, 220), 0, 0, 360, (240,) * 3, -1)
    assert find_page_quad(image) is None


def test_geometric_bright_panel_without_writing_also_passes_as_paper():
    image = np.full((480, 640, 3), 45, np.uint8)
    cv2.rectangle(image, (160, 70), (480, 410), (240,) * 3, -1)
    assert find_page_quad(image) is not None


def test_model_image_accepts_fallback_quad_even_when_client_says_no_page():
    image = np.full((300, 400, 3), 180, np.uint8)
    assert find_page_quad(image) is None
    quad = [{"x": 40, "y": 30}, {"x": 360, "y": 30}, {"x": 360, "y": 270}, {"x": 40, "y": 270}]
    row = SimpleNamespace(
        id=uuid.uuid4(),
        captured_at=datetime.now(UTC),
        meta={"page_found": False, "page_quad": quad},
    )
    # No actual paper exists, but the geometrically valid fallback quad bypasses re-detection.
    assert _page_view(encode_jpeg(image), row) is not None
