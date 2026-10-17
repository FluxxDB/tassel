"""Page geometry is checked against P3's scene, not the page finder's output."""

from math import ceil, cos, hypot, radians, sin

import numpy as np
import pytest

from tassel.domains.dfa.contract import Pt
from tassel.vision.clips import frame_at
from tassel.vision.page import (
    decode_jpeg,
    encode_jpeg,
    find_page_quad,
    flatten_page,
    ink_mask,
    page_size,
    resized,
    usable_quad,
)


def scene_quad(w, h):
    half_h = h * 0.86 / 2
    half_w = half_h * 11 / 8.5
    angle = radians(-1.4)
    return tuple(
        Pt(x=w / 2 + x * cos(angle) - y * sin(angle), y=h / 2 + x * sin(angle) + y * cos(angle))
        for x, y in [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]
    )


@pytest.mark.parametrize("t_ms", [26700, 38500, 47100])
def test_find_page_quad_matches_the_scene(clip, t_ms):
    rgb = decode_jpeg(frame_at(clip("dfa-demo").mjpeg, t_ms))
    h, w = rgb.shape[:2]
    quad = find_page_quad(rgb)
    assert quad is not None
    for got, want in zip(quad, scene_quad(w, h), strict=True):
        assert hypot(got.x - want.x, got.y - want.y) < 4


@pytest.mark.parametrize("t_ms", [26700, 38500, 47100])
def test_flatten_uses_a_given_quad_and_falls_back(clip, t_ms):
    from tassel.vision.marks import find_candidates

    jpeg = frame_at(clip("dfa-demo").mjpeg, t_ms)
    h, w = decode_jpeg(jpeg).shape[:2]
    supplied = scene_quad(w, h)
    given = flatten_page(jpeg, supplied)
    detected = flatten_page(jpeg, None)
    degenerate = flatten_page(jpeg, [Pt(x=0, y=0)] * 4)
    assert given.quad == supplied
    assert given.found and detected.found and degenerate.found
    assert degenerate.quad == detected.quad
    a, b = find_candidates(given).circles, find_candidates(detected).circles
    assert len(a) == len(b) == 4
    for c, d in zip(a, b, strict=True):
        assert hypot(c.cx - d.cx, c.cy - d.cy) < 3
    desk = flatten_page(encode_jpeg(np.full((720, 960, 3), 90, np.uint8)), None)
    assert not desk.found
    assert [(p.x, p.y) for p in desk.quad] == [(96, 72), (864, 72), (864, 648), (96, 648)]


@pytest.mark.parametrize("w,h", [(1100, 850), (850, 1100), (1000, 1000), (1600, 400)])
def test_page_size_stays_in_the_high_res_tier(w, h):
    q = (Pt(x=0, y=0), Pt(x=w, y=0), Pt(x=w, y=h), Pt(x=0, y=h))
    fw, fh = page_size(q)
    assert max(fw, fh) == 1568
    assert abs(fw / fh - w / h) < 0.01
    assert ceil(fw / 28) * ceil(fh / 28) <= 4784
    assert max(fw, fh) <= 2576


def test_usable_quad_rejects_invalid_geometry():
    good = [Pt(x=10, y=10), Pt(x=90, y=10), Pt(x=90, y=90), Pt(x=10, y=90)]
    assert usable_quad(good, 100, 100) == tuple(good)
    for q in [
        None,
        good[:3],
        [good[0]] * 4,
        [good[i] for i in [0, 2, 1, 3]],
        [Pt(x=p.x / 10, y=p.y / 10) for p in good],
        [Pt(x=float("nan"), y=10), *good[1:]],
        [Pt(x=-10, y=10), *good[1:]],
    ]:
        assert usable_quad(q, 100, 100) is None


def test_rgb_jpeg_resize_and_ink():
    rgb = np.full((240, 320, 3), (230, 180, 120), np.uint8)
    rgb[100:120, 100:120] = (10, 10, 10)
    decoded = decode_jpeg(encode_jpeg(rgb))
    assert decoded.shape == rgb.shape
    assert np.max(np.abs(decoded[20, 20].astype(int) - rgb[20, 20])) <= 3
    assert resized(decoded, 160).shape == (120, 160, 3)
    page = flatten_page(encode_jpeg(rgb), None)
    before = page.rgb.copy()
    mask = ink_mask(page)
    assert mask.dtype == np.uint8
    assert set(np.unique(mask)) == {0, 255}
    assert 0 < np.count_nonzero(mask) < mask.size / 10
    np.testing.assert_array_equal(page.rgb, before)
    with pytest.raises(ValueError):
        decode_jpeg(b"not a JPEG")
