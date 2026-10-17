"""Frames from P3's synthetic clips: splitting an MJPEG, picking a frame, and making the clip."""

import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from tassel.vision import clips
from tassel.vision.clips import (
    ClipFiles,
    NodeMissing,
    ensure_clip,
    frame_at,
    split_mjpeg,
    variant_of,
)


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


# ensure_clip without P3's CLI: what it runs, what it reads back, and how it fails.


@pytest.fixture
def fake_cli(monkeypatch, tmp_path):
    """A stand-in gen-clip.ts and node; returns the calls subprocess.run received."""
    cli = tmp_path / "gen-clip.ts"
    cli.write_text("", encoding="utf-8")
    monkeypatch.setattr(clips, "_GEN_CLIP", cli)
    monkeypatch.setattr(clips.shutil, "which", lambda name: "/opt/node/bin/node")
    calls: list[tuple[list[str], dict]] = []
    replies: list[subprocess.CompletedProcess] = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return replies.pop(0)

    monkeypatch.setattr(clips.subprocess, "run", run)
    return cli, calls, replies


def _printed(tmp_path: Path, name: str) -> str:
    return json.dumps(
        {
            "mjpeg": str(tmp_path / f"{name}.mjpeg"),
            "truth": str(tmp_path / f"{name}.truth.json"),
            "frames": 600,
            "sha256": "0" * 64,
        }
    )


def test_ensure_clip_runs_the_cli_and_takes_the_paths_it_prints(fake_cli, tmp_path):
    cli, calls, replies = fake_cli
    out = tmp_path / "clips"
    for name in ("dfa-short-960x720-0c8249e6", "dfa-short-960x720-3f613ad7"):
        line = _printed(tmp_path, name)
        replies.append(subprocess.CompletedProcess([], 0, stdout=f"\n{line}\n", stderr=""))
    noisy = ensure_clip("dfa-short", clips_dir=out)
    clean = ensure_clip("dfa-short", noise=False, clips_dir=out)
    assert noisy == ClipFiles(
        "dfa-short",
        tmp_path / "dfa-short-960x720-0c8249e6.mjpeg",
        tmp_path / "dfa-short-960x720-0c8249e6.truth.json",
    )
    assert clean.mjpeg == tmp_path / "dfa-short-960x720-3f613ad7.mjpeg"
    command = ["/opt/node/bin/node", str(cli), "--variant", "dfa-short", "--out", str(out)]
    assert [args for args, _ in calls] == [command, [*command, "--no-noise"]]
    assert all(kwargs["cwd"] == clips.REPO_DIR for _, kwargs in calls)


def test_ensure_clip_reports_a_failing_cli(fake_cli):
    _, _, replies = fake_cli
    refusal = 'gen-clip: --variant must be one of dfa-demo, dfa-short; got "nope"'
    replies.append(subprocess.CompletedProcess([], 2, stdout="", stderr=refusal + "\n"))
    with pytest.raises(RuntimeError, match="must be one of"):
        ensure_clip("nope")
    replies.append(subprocess.CompletedProcess([], 0, stdout="", stderr=""))
    with pytest.raises(RuntimeError, match="printed nothing"):
        ensure_clip("dfa-short")


def test_ensure_clip_needs_node_and_the_cli(monkeypatch, tmp_path):
    monkeypatch.setattr(clips.shutil, "which", lambda name: None)
    with pytest.raises(NodeMissing):
        ensure_clip("dfa-short")
    monkeypatch.setattr(clips.shutil, "which", lambda name: "/opt/node/bin/node")
    monkeypatch.setattr(clips, "_GEN_CLIP", tmp_path / "missing" / "gen-clip.ts")
    with pytest.raises(FileNotFoundError, match="paper-synth"):
        ensure_clip("dfa-short")


def test_the_default_clips_dir_is_in_the_repository_cache():
    assert (clips.REPO_DIR / "services" / "server" / "pyproject.toml").is_file()
    assert clips.DEFAULT_CLIPS_DIR == clips.REPO_DIR / ".cache" / "paper-clips"
