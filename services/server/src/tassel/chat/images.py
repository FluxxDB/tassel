"""The images a student sends: JPEG, PNG or WebP in (by their bytes, never their name or
declared type), decoded and checked with Pillow, and stored at most 2048 px on the long side.

An image with transparency stays a PNG, so its see-through parts don't turn black; every other
image is stored as a JPEG.
"""

import io
from dataclasses import dataclass

from PIL import Image, ImageOps

MAX_SIDE = 2048
# Past this many pixels an image isn't decoded at all (a decompression bomb, not homework).
MAX_PIXELS = 50_000_000
JPEG_QUALITY = 88


class UnsupportedImage(ValueError):
    """Not a JPEG, PNG or WebP that decodes."""


@dataclass(frozen=True)
class PreparedImage:
    data: bytes
    mime: str  # image/jpeg or image/png
    width: int
    height: int


def sniff(data: bytes) -> str | None:
    """The format the bytes start with: "jpeg", "png", "webp", or None."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _has_alpha(image: Image.Image) -> bool:
    if image.mode in ("RGBA", "LA", "PA"):
        return image.getextrema()[-1][0] < 255
    return image.mode == "P" and "transparency" in image.info


def prepare(data: bytes) -> PreparedImage:
    """The image as stored: upright (EXIF orientation applied), downscaled to MAX_SIDE, and
    re-encoded, which also drops its metadata. Raises UnsupportedImage."""
    kind = sniff(data)
    if kind is None:
        raise UnsupportedImage("not a JPEG, PNG or WebP image")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format is None or probe.format.lower() != kind:
                raise UnsupportedImage("the image's contents don't match its signature")
            if probe.width * probe.height > MAX_PIXELS:
                raise UnsupportedImage("the image has too many pixels")
            probe.verify()
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            image = ImageOps.exif_transpose(opened)
            alpha = _has_alpha(image)
            image = image.convert("RGBA" if alpha else "RGB")
    except UnsupportedImage:
        raise
    except Exception as error:  # noqa: BLE001 - Pillow raises many types for a bad file
        raise UnsupportedImage("the image doesn't decode") from error
    if max(image.size) > MAX_SIDE:
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    if alpha:
        image.save(out, "PNG", optimize=True)
        mime = "image/png"
    else:
        image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
        mime = "image/jpeg"
    return PreparedImage(out.getvalue(), mime, image.width, image.height)
