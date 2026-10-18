"""Offline Desk View edge-softness regression, using P3 paper and margin writing."""

import json
from dataclasses import replace
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

import cv2
import numpy as np

from tassel.frames.tables import Frame
from tassel.vision.clips import frame_at
from tassel.vision.marks import draw_marks, find_candidates
from tassel.vision.page import decode_jpeg, encode_jpeg, flatten_page
from tassel.vision.turn_image import _page_view


def edge_blurred(rgb):
    """Blend Gaussian blur increasingly toward all four page margins."""
    h, w = rgb.shape[:2]
    weight = np.maximum(
        np.linspace(-1, 1, w, dtype=np.float32)[None, :] ** 2,
        np.linspace(-1, 1, h, dtype=np.float32)[:, None] ** 2,
    )[..., None]
    soft = cv2.GaussianBlur(rgb, (0, 0), 2.0)
    return np.rint(rgb * (1 - weight) + soft * weight).astype(np.uint8)


def margin_sharpness(rgb, mask):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    dx = cv2.Sobel(gray, cv2.CV_32F, 1, 0)
    dy = cv2.Sobel(gray, cv2.CV_32F, 0, 1)
    return float(np.hypot(dx, dy)[mask].mean())


def test_edge_soft_clip_improves_without_changing_app_page(clip):
    files = clip("dfa-demo")
    page = flatten_page(frame_at(files.mjpeg, 47100), None)
    # Put writing where Desk View is weakest; P3's states stay in their original locations.
    rgb = page.rgb.copy()
    for x in (18, page.width - 170):
        for y in (110, page.height // 2, page.height - 100):
            cv2.putText(
                rgb,
                "x = 1 + 1",
                (x, y),
                cv2.FONT_HERSHEY_SCRIPT_SIMPLEX,
                0.65,
                (100, 100, 100),
                2,
                cv2.LINE_AA,
            )
    soft = edge_blurred(rgb)
    jpeg = encode_jpeg(soft)
    quad = [
        dict(x=0, y=0),
        dict(x=page.width, y=0),
        dict(x=page.width, y=page.height),
        dict(x=0, y=page.height),
    ]
    row = Frame(id=uuid4(), captured_at=datetime.now(UTC), meta={"page_quad": quad})
    view = _page_view(jpeg, row)
    assert view is not None
    original = decode_jpeg(jpeg)
    assert view.page_jpeg == encode_jpeg(original)
    circles = [e for e in view.elements if e.kind == "circle"]
    truth = json.loads(files.truth.read_text())
    for state in truth["dfa"]["states"]:
        x, y = state["center"]["x"] * page.width, state["center"]["y"] * page.height
        assert any(
            e.box.x < x < e.box.x + e.box.w and e.box.y < y < e.box.y + e.box.h for e in circles
        )
    margin = np.zeros(rgb.shape[:2], bool)
    margin[:, :180] = margin[:, -180:] = True
    ink = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < 170
    mask = margin & (cv2.dilate(ink.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    # Exclude tags and their JPEG boundary so blue numbers cannot inflate the score.
    unmarked_page = replace(page, rgb=original)
    marked = draw_marks(unmarked_page, find_candidates(unmarked_page))
    tags = np.any(marked != original, axis=2).astype(np.uint8)
    mask &= cv2.dilate(tags, np.ones((17, 17), np.uint8)) == 0
    before = margin_sharpness(original, mask)
    after = margin_sharpness(decode_jpeg(view.marked_jpeg), mask)
    print(f"margin Sobel: {before:.2f} -> {after:.2f}")
    assert after > before * 1.15


def test_enhancement_budget_and_numbering(clip):
    from tassel.vision.page import enhance_for_llm

    page = flatten_page(frame_at(clip("dfa-demo").mjpeg, 47100), None)
    original = page.rgb.copy()
    times = []
    for _ in range(25):
        start = perf_counter()
        enhanced = enhance_for_llm(page.rgb)
        times.append((perf_counter() - start) * 1000)
    assert np.array_equal(page.rgb, original)
    assert enhanced.shape == original.shape and enhanced.dtype == np.uint8
    candidates = find_candidates(page)
    marks = draw_marks(page, candidates)
    enhanced_marks = draw_marks(replace(page, rgb=enhanced), candidates)
    # All tag pixels, including antialiased white digits, are drawn after enhancement.
    tag = np.any(marks != original, axis=2)
    assert np.array_equal(marks[tag], enhanced_marks[tag])
    print(
        f"enhance ms: first={times[0]:.2f} median={np.median(times[1:]):.2f} "
        f"p95={np.percentile(times[1:], 95):.2f} max={max(times):.2f}"
    )
    assert np.percentile(times[1:], 95) < 50
