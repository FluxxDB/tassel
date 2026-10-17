"""jpeg_dimensions: a frame's size comes from its JPEG's SOF marker, never from the client."""

import pytest

from tassel.frames.jpeg import NotJpeg, jpeg_dimensions


def bare_sof(marker: int, width: int, height: int) -> bytes:
    """SOI, then one SOFn segment: enough for the size, though not a picture."""
    body = (
        bytes([8]) + height.to_bytes(2, "big") + width.to_bytes(2, "big") + bytes([1, 1, 0x11, 0])
    )
    return b"\xff\xd8" + bytes([0xFF, marker]) + (len(body) + 2).to_bytes(2, "big") + body


def test_jpeg_dimensions(make_jpeg):
    assert jpeg_dimensions(make_jpeg(64, 48)) == (64, 48)  # baseline, SOF0
    assert jpeg_dimensions(make_jpeg(64, 48, progressive=True)) == (64, 48)  # SOF2
    with pytest.raises(NotJpeg):
        jpeg_dimensions(b"nope")


def test_reads_an_extended_sof1_after_fill_bytes():
    data = bare_sof(0xC1, 640, 480)
    assert jpeg_dimensions(data) == (640, 480)
    # Any marker may be preceded by extra 0xFF fill bytes.
    assert jpeg_dimensions(data[:2] + b"\xff\xff" + data[2:]) == (640, 480)


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"", id="empty"),
        pytest.param(b"\xff\xd8", id="soi-only"),
        pytest.param(b"\xff\xd8\xff\xd9", id="no-frame-header"),
        pytest.param(b"\xff\xd8\xff\xda\x00\x08" + bytes(6), id="scan-before-sof"),
        pytest.param(b"\xff\xd8\xff\xe0\x00\x02garbage", id="garbage-after-a-segment"),
        pytest.param(bare_sof(0xC3, 64, 48), id="lossless-sof3"),
        pytest.param(bare_sof(0xC0, 64, 48)[:9], id="cut-inside-sof"),
        pytest.param(bare_sof(0xC0, 0, 48), id="zero-width"),
    ],
)
def test_rejects_jpegs_without_a_usable_frame_header(data):
    with pytest.raises(NotJpeg):
        jpeg_dimensions(data)
