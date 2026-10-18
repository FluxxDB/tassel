"""Set-of-Mark grounding on synthetic screen frames at scale 1 and 2."""

import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from PIL import Image, ImageDraw

from tassel.screen.drawing import grounded_points
from tassel.screen.grounding import ScreenMarks, element_box, ground
from tassel.voice.pointer import Pointer

pytestmark = pytest.mark.asyncio


def screen_jpeg(scale: int) -> bytes:
    """A 640x400 'display' at the given pixel scale: a title line and a game tile."""
    image = Image.new("RGB", (640 * scale, 400 * scale), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((60 * scale, 40 * scale, 360 * scale, 58 * scale), fill="black")
    draw.rectangle((420 * scale, 200 * scale, 560 * scale, 300 * scale), fill="#2244aa")
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=92)
    return buffer.getvalue()


def fake_pointer(reply: dict) -> Pointer:
    pointer = object.__new__(Pointer)
    pointer.timeout_s = 0.5
    pointer.log = lambda *args, **kwargs: None
    pointer.client = SimpleNamespace(complete=AsyncMock(return_value=json.dumps(reply)))
    return pointer


async def test_marked_frame_numbers_the_tile_and_a_picked_marker_lands_on_it():
    marks = ScreenMarks()
    view = await marks.view_for("frame-1", screen_jpeg(1))
    assert view.width == 640 and view.height == 400
    assert view.elements
    tile = next(e for e in view.elements if abs(e.box.x - 420) < 8 and abs(e.box.y - 200) < 8)
    pointer = fake_pointer({"marks": [{"i": 0, "id": tile.id, "box": None}]})
    box = await ground(pointer, "circle", "the Hypershot game tile", view)
    assert box is not None
    assert box.x == pytest.approx(420 / 640, abs=0.02)
    assert box.y == pytest.approx(200 / 400, abs=0.02)
    assert box.w == pytest.approx(140 / 640, abs=0.03)
    assert box.h == pytest.approx(100 / 400, abs=0.03)
    # The pointer saw the marked image and the legend, never a bare screenshot.
    request = pointer.client.complete.call_args.args[0]
    assert tile.id in request[1]["content"][0]["text"]
    assert "image_url" in request[1]["content"][1]
    # The same view serves every draw call on this frame; a new frame is marked afresh.
    assert await marks.view_for("frame-1", b"ignored") is view
    a, b = grounded_points("underline", box)
    assert a.y == b.y and a.y > box.y + box.h and a.x < b.x


async def test_scale_two_frame_grounds_to_the_same_fractions():
    one = await ScreenMarks().view_for("f1", screen_jpeg(1))
    two = await ScreenMarks().view_for("f2", screen_jpeg(2))
    assert (two.width, two.height) == (1280, 800)
    tile_one = next(e for e in one.elements if abs(e.box.x - 420) < 8)
    tile_two = next(e for e in two.elements if abs(e.box.x - 840) < 16)
    a, b = element_box(one, tile_one.id), element_box(two, tile_two.id)
    assert a is not None and b is not None
    for field in ("x", "y", "w", "h"):
        assert getattr(a, field) == pytest.approx(getattr(b, field), abs=0.01)


async def test_a_box_answer_is_trimmed_and_an_unknown_marker_is_refused():
    view = await ScreenMarks().view_for("f", screen_jpeg(1))
    boxed = fake_pointer(
        {"marks": [{"i": 0, "id": None, "box": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}}]}
    )
    box = await ground(boxed, "circle", "the search field", view)
    assert box is not None and (box.x, box.y, box.w, box.h) == (0.1, 0.2, 0.3, 0.1)
    unknown = fake_pointer({"marks": [{"i": 0, "id": "m99", "box": None}]})
    assert await ground(unknown, "pointer", "the thing", view) is None
    nothing = fake_pointer({"marks": [{"i": 0, "id": None, "box": None}]})
    assert await ground(nothing, "underline", "the thing", view) is None
