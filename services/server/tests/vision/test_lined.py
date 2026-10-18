"""Ruled-paper regressions; owner video is decoded only in memory, never saved."""

from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
import pytest

from tassel.vision.clips import frame_at
from tassel.vision.page import enhance_for_llm, flatten_page


def test_ruled_soft_paper_preserves_graphite(clip):
    page = flatten_page(frame_at(clip("dfa-demo").mjpeg, 47100), None).rgb
    h, w = page.shape[:2]
    ink = cv2.cvtColor(page, cv2.COLOR_RGB2GRAY) < 150
    ruled = page.copy()
    lines = np.zeros((h, w), np.uint8)
    for y in range(35, h, 45):
        cv2.line(ruled, (0, y), (w - 1, y), (193, 207, 225), 2)
        cv2.line(lines, (0, y), (w - 1, y), 255, 2)
    cv2.line(ruled, (80, 0), (80, h - 1), (230, 180, 180), 2)
    cv2.line(lines, (80, 0), (80, h - 1), 255, 2)
    # Graphite is above ruling, including crossings and horizontal diagram arrows.
    ruled[ink] = page[ink]
    light = np.linspace(0.7, 1.0, w)[None, :, None]
    soft = cv2.GaussianBlur((ruled * light).astype(np.uint8), (0, 0), 1.1)
    before = soft.copy()
    out = enhance_for_llm(soft)
    safe_lines = (lines > 0) & (cv2.dilate(ink.astype(np.uint8), np.ones((15, 15))) == 0)
    assert out[safe_lines].mean() > 240
    assert out[ink].mean() < soft[ink].mean() - 15
    assert np.array_equal(soft, before)
    assert out.shape == soft.shape and out.dtype == np.uint8
    assert np.array_equal(out[:, :, 0], out[:, :, 2])


def test_grey_rules_and_crossing_stroke():
    paper = np.full((500, 900, 3), 235, np.uint8)
    for y in (100, 200, 300, 400):
        cv2.line(paper, (0, y), (899, y), (205, 205, 205), 2)
    cv2.line(paper, (300, 60), (300, 440), (125, 125, 125), 3)
    cv2.arrowedLine(paper, (350, 250), (550, 250), (125, 125, 125), 3)
    out = enhance_for_llm(cv2.GaussianBlur(paper, (0, 0), 1))
    assert out[100, 100, 0] > 245
    assert out[200, 300, 0] < 120
    assert out[250, 450, 0] < 120


def test_owner_clip_in_memory():
    path = Path.home() / "Movies/tassel-clips/dfa-owner-1.mp4"
    if not path.exists():
        pytest.skip("local owner clip absent")
    cap = cv2.VideoCapture(str(path))
    times = []
    try:
        for second in (5, 12, 18, 24, 30, 35):
            cap.set(cv2.CAP_PROP_POS_MSEC, second * 1000)
            ok, bgr = cap.read()
            assert ok
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            original = rgb.copy()
            for _ in range(5):
                start = perf_counter()
                out = enhance_for_llm(rgb)
                times.append((perf_counter() - start) * 1000)
            assert np.array_equal(rgb, original)
            assert out.shape == rgb.shape
        print(f"owner enhance ms median={np.median(times):.2f} p95={np.percentile(times, 95):.2f}")
        assert np.percentile(times, 95) < 60
    finally:
        cap.release()
