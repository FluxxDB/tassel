"""Frames fixtures: synthetic JPEGs made with Pillow, and the ink meta every language shares.

Every image here is generated; none is a camera frame.
"""

import io
import json
import random
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

# The server's example `meta`. The desktop uploader's contract test (frame-meta.test.ts) reads
# the same file.
META_EXAMPLE = Path(__file__).with_name("frame-meta-example.json")


def synthetic_jpeg(width: int, height: int, *, noise: bool = False, **options: Any) -> bytes:
    """A flat paper-coloured JPEG, or seeded noise, which compresses badly, for size limits."""
    if noise:
        pixels = random.Random(width * 10_000 + height).randbytes(width * height * 3)
        image = Image.frombytes("RGB", (width, height), pixels)
    else:
        image = Image.new("RGB", (width, height), (244, 241, 234))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=90, **options)
    return buffer.getvalue()


@pytest.fixture
def make_jpeg() -> Callable[..., bytes]:
    return synthetic_jpeg


@pytest.fixture
def ink_meta() -> dict[str, Any]:
    """A fresh copy of the example: an ink frame with its crop rectangle and mask."""
    return json.loads(META_EXAMPLE.read_text(encoding="utf-8"))
