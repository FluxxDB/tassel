"""Frames from P3's synthetic clips, for tests and the evaluations.

P3's paper-synth CLI (``packages/paper-synth/scripts/gen-clip.ts``) writes a clip as an MJPEG,
whole JPEGs back to back at 30 fps, beside a ``.truth.json`` that says what was drawn, where and
when. ``ensure_clip`` runs it (it skips work that already exists) and returns the two paths;
``frame_at`` picks the JPEG shown at a time. Nothing here decodes a JPEG or loads OpenCV.
"""

import json
import re
import shutil
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

# src/tassel/vision/clips.py -> the repository is five levels up.
REPO_DIR = Path(__file__).resolve().parents[5]
DEFAULT_CLIPS_DIR = REPO_DIR / ".cache" / "paper-clips"

_GEN_CLIP = REPO_DIR / "packages" / "paper-synth" / "scripts" / "gen-clip.ts"
# Making the longest clip once, in pure JavaScript, takes a few minutes at most.
_GEN_CLIP_TIMEOUT_S = 600

_TRUTH_NAME = re.compile(r"^(?P<variant>.+)-\d+x\d+-[0-9a-f]{8}\.truth\.json$")


@dataclass(frozen=True)
class ClipFiles:
    variant: str
    mjpeg: Path
    truth: Path


class NodeMissing(RuntimeError):
    """``node`` isn't on PATH, so P3's CLI can't run."""


def ensure_clip(
    variant: str, *, noise: bool = True, clips_dir: Path = DEFAULT_CLIPS_DIR
) -> ClipFiles:
    """The clip's MJPEG and truth, made by P3's CLI in ``clips_dir`` unless they already exist.

    It always runs the CLI (``--no-noise`` when ``noise`` is false), from the repository root.
    The CLI skips work that exists, and the paths come from the JSON line it prints, never from
    a glob, so a clip made with other options or by another generator version is never mistaken
    for this one.
    """
    node = shutil.which("node")
    if node is None:
        raise NodeMissing("`node` isn't on PATH: P3's paper-synth needs Node 22.18+")
    if not _GEN_CLIP.is_file():
        raise FileNotFoundError(f"P3's paper-synth CLI isn't at {_GEN_CLIP}")
    args = [node, str(_GEN_CLIP), "--variant", variant, "--out", str(clips_dir)]
    if not noise:
        args.append("--no-noise")
    done = subprocess.run(
        args,
        cwd=REPO_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=_GEN_CLIP_TIMEOUT_S,
    )
    if done.returncode != 0:
        raise RuntimeError(f"gen-clip {variant} failed ({done.returncode}): {done.stderr.strip()}")
    lines = [line for line in done.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"gen-clip {variant} printed nothing")
    made = json.loads(lines[-1])
    return ClipFiles(variant=variant, mjpeg=Path(made["mjpeg"]), truth=Path(made["truth"]))


# Markers that stand alone, with no length: TEM and the restart markers RST0–RST7.
_STANDALONE = frozenset({0x01, *range(0xD0, 0xD8)})
_SOI, _EOI, _SOS = 0xD8, 0xD9, 0xDA


def _jpeg_spans(data: bytes) -> Iterator[tuple[int, int]]:
    """The start and end of each JPEG in ``data``, which must be JPEGs back to back.

    Each JPEG runs from its SOI to its EOI. Its marker segments are walked by their lengths up to
    the SOS, so an EOI inside a segment (an Exif thumbnail in APP1) is never taken for the end.
    After the SOS the first EOI ends the JPEG: inside entropy-coded data a 0xFF byte is always
    followed by 0x00 or a restart marker.
    """
    size = len(data)
    start = 0
    while start < size:
        if data[start : start + 2] != b"\xff\xd8":
            raise ValueError(f"no JPEG starts at byte {start}")
        at = start + 2
        end = None
        while end is None:
            if at + 2 > size:
                raise ValueError(f"the JPEG at byte {start} is cut short")
            if data[at] != 0xFF:
                raise ValueError(f"no marker at byte {at}")
            marker = data[at + 1]
            if marker == 0xFF:  # a fill byte before the marker
                at += 1
            elif marker == _EOI:  # a JPEG of tables only
                end = at + 2
            elif marker == _SOI:
                raise ValueError(f"a JPEG starts at byte {at} inside the one at byte {start}")
            elif marker in _STANDALONE:
                at += 2
            else:
                if at + 4 > size:
                    raise ValueError(f"the JPEG at byte {start} is cut short")
                at += 2 + int.from_bytes(data[at + 2 : at + 4], "big")
                if marker == _SOS:
                    eoi = data.find(b"\xff\xd9", at)
                    if eoi < 0:
                        raise ValueError(f"the JPEG at byte {start} has no end")
                    end = eoi + 2
        yield start, end
        start = end


def split_mjpeg(data: bytes) -> list[bytes]:
    """Each JPEG in an MJPEG, SOI to EOI. Anything else in ``data`` raises ``ValueError``."""
    return [data[start:end] for start, end in _jpeg_spans(data)]


def frame_at(mjpeg: Path, t_ms: int, fps: int = 30) -> bytes:
    """The JPEG shown at ``t_ms``: the one at index ``round(t_ms * fps / 1000)``."""
    index = round(t_ms * fps / 1000)
    data = mjpeg.read_bytes()
    if index >= 0:
        for i, (start, end) in enumerate(_jpeg_spans(data)):
            if i == index:
                return data[start:end]
    raise IndexError(f"{mjpeg.name} has no frame {index} ({t_ms} ms at {fps} fps)")


def variant_of(truth: Path) -> str:
    """The variant of a truth file: "dfa-demo-hold" for "dfa-demo-hold-960x720-1a2b3c4d.truth.json".

    The name is ``<variant>-<width>x<height>-<hash8>.truth.json``, as P3's CLI writes it.
    """
    match = _TRUTH_NAME.match(truth.name)
    if match is None:
        raise ValueError(f"{truth.name} isn't a paper-synth truth file")
    return match["variant"]
