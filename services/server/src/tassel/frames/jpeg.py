"""Reads a JPEG's size from its frame header, so the server never trusts the client's numbers."""

# Baseline, extended sequential and progressive: the frame headers a browser can show.
_SOF_MARKERS = frozenset({0xC0, 0xC1, 0xC2})
# Markers with no length field after them: TEM and the restart markers RST0 to RST7.
_STANDALONE = frozenset({0x01, *range(0xD0, 0xD8)})
_EOI, _SOS = 0xD9, 0xDA


class NotJpeg(ValueError):
    """The bytes aren't a JPEG with a usable frame header."""


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """``(width, height)`` from the first SOF0, SOF1 or SOF2 segment.

    Raises ``NotJpeg`` when the data doesn't start with ``FF D8 FF``, or ends, starts its scan
    or meets another kind of frame before such a segment.
    """
    if not data.startswith(b"\xff\xd8\xff"):
        raise NotJpeg("not a JPEG: it doesn't start with FF D8 FF")
    end = len(data)
    i = 2  # just past SOI
    while i < end:
        if data[i] != 0xFF:
            raise NotJpeg(f"not a JPEG: no marker at byte {i}")
        while i < end and data[i] == 0xFF:  # a marker may follow any number of fill bytes
            i += 1
        if i == end:
            break
        marker = data[i]
        i += 1
        if marker in _STANDALONE:
            continue
        if marker in (_EOI, _SOS):
            break  # the scan (or the image) begins before any frame header
        if i + 2 > end:
            break
        length = int.from_bytes(data[i : i + 2], "big")  # counts its own two bytes
        if marker in _SOF_MARKERS:
            # length (2), precision (1), height (2), width (2), ...
            if length < 8 or i + 7 > end:
                raise NotJpeg("not a JPEG: its frame header is cut short")
            height = int.from_bytes(data[i + 3 : i + 5], "big")
            width = int.from_bytes(data[i + 5 : i + 7], "big")
            if width == 0 or height == 0:
                raise NotJpeg("not a JPEG: its frame header has no size")
            return width, height
        if length < 2:
            raise NotJpeg(f"not a JPEG: a segment at byte {i} has length {length}")
        i += length
    raise NotJpeg("not a JPEG: no SOF0, SOF1 or SOF2 frame header")
