"""Frames from P3's synthetic clips: splitting an MJPEG, picking a frame, and making the clip."""

from pathlib import Path

import cv2
import numpy as np
import pytest

from tassel.vision.clips import ClipFiles, ensure_clip, frame_at, split_mjpeg, variant_of


def _jpeg(value: int, size: tuple[int, int] = (8, 16)) -> bytes:
    """A small real JPEG whose two halves encode ``value``, so every value gives other bytes."""
    image = np.zeros(size, dtype=np.uint8)
    image[:, : size[1] // 2] = value % 256
    image[:, size[1] // 2 :] = (value // 256) * 40
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def _with_app1(jpeg: bytes, payload: bytes) -> bytes:
    """``jpeg`` with an APP1 segment holding ``payload`` right after its SOI."""
    assert jpeg[:2] == b"\xff\xd8"
    segment = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
    return jpeg[:2] + segment + jpeg[2:]


def test_split_mjpeg_splits_back_to_back_jpegs():
    frames = [_jpeg(1), _jpeg(2), _jpeg(3)]
    assert split_mjpeg(b"".join(frames)) == frames


def test_split_mjpeg_skips_an_eoi_inside_an_app1_segment():
    # An Exif thumbnail is a whole JPEG inside APP1, EOI and all.
    thumbnail = _jpeg(9, size=(8, 8))
    assert b"\xff\xd9" in thumbnail
    frames = [_with_app1(_jpeg(1), b"Exif\x00\x00" + thumbnail), _jpeg(2), _jpeg(3)]
    assert split_mjpeg(b"".join(frames)) == frames


def test_frame_at_picks_index_801_for_26700_ms(tmp_path):
    frames = [_jpeg(i) for i in range(810)]
    clip = tmp_path / "clip.mjpeg"
    clip.write_bytes(b"".join(frames))
    assert frame_at(clip, 26700) == frames[801]
    assert frame_at(clip, 0) == frames[0]


def test_variant_of_parses_the_name():
    assert variant_of(Path("dfa-demo-hold-960x720-1a2b3c4d.truth.json")) == "dfa-demo-hold"
    assert variant_of(Path("/clips/dfa-short-960x720-0f0f0f0f.truth.json")) == "dfa-short"


def test_ensure_clip_creates_the_files_once(clip):
    first = clip("dfa-short")
    assert isinstance(first, ClipFiles) and first.variant == "dfa-short"
    assert first.mjpeg.is_file() and first.truth.is_file()
    assert variant_of(first.truth) == "dfa-short"
    stamps = (first.mjpeg.stat().st_mtime_ns, first.truth.stat().st_mtime_ns)
    again = ensure_clip("dfa-short")
    assert again == first
    assert (again.mjpeg.stat().st_mtime_ns, again.truth.stat().st_mtime_ns) == stamps


def test_ensure_clip_without_noise_gives_other_files(clip):
    noisy = clip("dfa-short")
    clean = clip("dfa-short", noise=False)
    assert clean.mjpeg.is_file() and clean.truth.is_file()
    assert {clean.mjpeg, clean.truth}.isdisjoint({noisy.mjpeg, noisy.truth})


# Beyond the brief's examples.


def test_split_mjpeg_refuses_what_isnt_back_to_back_jpegs():
    jpeg = _jpeg(1)
    for data in (b"junk" + jpeg, jpeg + b"junk", jpeg[:-2], jpeg[: len(jpeg) // 2]):
        with pytest.raises(ValueError):
            split_mjpeg(data)
    assert split_mjpeg(b"") == []


def test_split_mjpeg_allows_fill_bytes_before_a_marker():
    # Fill bytes (0xFF) may pad before any marker; entropy data stuffs 0xFF as FF 00.
    jpeg = _jpeg(5)
    padded = jpeg[:2] + b"\xff\xff" + jpeg[2:]
    assert split_mjpeg(padded + jpeg) == [padded, jpeg]


def test_frame_at_refuses_a_time_outside_the_clip(tmp_path):
    clip = tmp_path / "clip.mjpeg"
    clip.write_bytes(b"".join(_jpeg(i) for i in range(30)))
    assert frame_at(clip, 966) == _jpeg(29)  # round(28.98) = 29, the last frame
    for t_ms in (-100, 1000):
        with pytest.raises(IndexError):
            frame_at(clip, t_ms)
    assert frame_at(clip, 500, fps=10) == _jpeg(5)


def test_variant_of_refuses_other_names():
    for name in (
        "dfa-demo.truth.json",
        "dfa-demo-960x720-1a2b3c4d.mjpeg",
        "x-1x1-zzzzzzzz.truth.json",
    ):
        with pytest.raises(ValueError):
            variant_of(Path(name))
