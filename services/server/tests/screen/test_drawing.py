import asyncio

import pytest
from pydantic import ValidationError

from tassel.screen.drawing import Region, checked_board, checked_edit, deliver, grounded_points
from tassel.screen.session import ScreenSession
from tassel.voice.pointer import Box


def test_edit_uses_inventory_without_a_frame():
    objects = [{"id": "circle", "points": [{"x": 0.2, "y": 0.3}, {"x": 0.5, "y": 0.6}]}]
    assert checked_edit({"operation": "remove", "ids": ["circle"]}, objects)["ids"] == ["circle"]
    assert checked_edit({"operation": "clear"}, objects)["ids"] == ["circle"]
    with pytest.raises(ValueError):
        checked_edit({"operation": "remove", "ids": ["stale"]}, objects)
    with pytest.raises(ValueError):
        checked_edit({"operation": "move", "ids": ["circle"], "dx": 0.8, "dy": 0}, objects)


def test_grounding_preserves_full_image_coordinates():
    box = Box(x=0.6, y=0.4, w=0.3, h=0.2)
    points = grounded_points("circle", box)
    assert points[0].x == 0.6
    assert points[1].x == pytest.approx(0.9)
    assert grounded_points("underline", box)[0].y == pytest.approx(0.604)
    assert grounded_points("pointer", box)[0].x == pytest.approx(0.75)


def test_whiteboard_dfa_is_checked_with_existing_schema():
    action = {
        "kind": "board.automaton",
        "item": "dfa",
        "spec": {
            "kind": "dfa",
            "states": [{"id": "q0", "accept": True}],
            "start": "q0",
            "transitions": [{"from": "q0", "to": "q0", "symbols": ["0"]}],
        },
    }
    result = checked_board({"action": action, "region": {"x": 0.4, "y": 0.2, "w": 0.5, "h": 0.6}})
    assert result["action"] == action
    assert result["region"]["color"] == "violet"
    with pytest.raises(ValueError):
        checked_board(
            {"action": {"kind": "paper.clear"}, "region": {"x": 0, "y": 0, "w": 1, "h": 1}}
        )
    with pytest.raises(ValidationError):
        Region(x=0.8, y=0, w=0.3, h=0.5)


@pytest.mark.asyncio
async def test_draw_success_requires_owner_ack_and_reset_rejects_pending():
    screen = ScreenSession()
    screen.control(source="display", epoch=1, active=True)
    sent = []

    async def send(payload):
        sent.append(payload["tassel"])

    pending = asyncio.create_task(deliver(screen, send, {"edit": {"operation": "clear"}}))
    await asyncio.sleep(0)
    assert not pending.done()
    screen.pending[sent[-1]["request_id"]].set_result(True)
    assert await pending
    pending = asyncio.create_task(deliver(screen, send, {"edit": {"operation": "clear"}}))
    await asyncio.sleep(0)
    screen.control(source="display", epoch=2, active=True)
    assert not await pending
    assert not screen.pending


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "box,accepted",
    [
        ({"x": 0.6, "y": 0.3, "w": 0.2, "h": 0.2}, True),
        (None, False),
        ({"x": 0.9, "y": 0.3, "w": 0.4, "h": 0.2}, False),
    ],
)
async def test_screen_pointer_uses_only_delivered_image_and_checks_box(box, accepted):
    import json
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from tassel.voice.pointer import Pointer

    pointer = object.__new__(Pointer)
    pointer.timeout_s = 0.5
    pointer.client = SimpleNamespace(
        complete=AsyncMock(return_value=json.dumps({"marks": [{"i": 0, "id": None, "box": box}]}))
    )
    result = await pointer.resolve_screen("the YouTube thumbnail", b"current-frame")
    assert (result is not None) == accepted
    request = pointer.client.complete.call_args.args[0]
    assert "YouTube thumbnail" in request[1]["content"][0]["text"]
    assert "Y3VycmVudC1mcmFtZQ==" in request[1]["content"][1]["image_url"]["url"]


def test_semantic_target_does_not_require_the_talker_to_guess_coordinates():
    from tassel.screen.api import ScreenDrawing

    drawing = ScreenDrawing(frame_id="current", kind="circle", target="the YouTube thumbnail")
    assert drawing.points == []
    with pytest.raises(ValidationError):
        ScreenDrawing(frame_id="current", kind="circle")
