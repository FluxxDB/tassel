"""Screen drawing validation and acknowledgement, sharing the whiteboard's action schema."""

import asyncio
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tassel.beats.models import BEAT_ACTION
from tassel.screen.api import ScreenPoint

COLORS = ("violet", "red", "blue", "green", "orange", "black", "white")


class Region(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def contained(self):
        if self.x + self.w > 1.000001 or self.y + self.h > 1.000001:
            raise ValueError("Region extends outside the shared display")
        return self


def grounded_points(kind, box):
    """Pointer bounds and coordinates always refer to the full delivered image."""
    if kind == "pointer":
        return [ScreenPoint(x=box.x + box.w / 2, y=box.y + box.h / 2)]
    if kind == "underline":
        y = min(1, box.y + box.h + 0.004)
        return [ScreenPoint(x=box.x, y=y), ScreenPoint(x=box.x + box.w, y=y)]
    return [ScreenPoint(x=box.x, y=box.y), ScreenPoint(x=box.x + box.w, y=box.y + box.h)]


def checked_board(arguments):
    action = BEAT_ACTION.validate_python(arguments["action"])
    if action.kind not in ("board.automaton", "board.diagram", "board.note"):
        raise ValueError("Expected a whiteboard action")
    region = Region.model_validate(arguments["region"])
    color = arguments.get("color", "violet")
    if color not in COLORS:
        raise ValueError("Unknown drawing color")
    return {
        "action": action.model_dump(by_alias=True, exclude_none=True),
        "region": {**region.model_dump(), "color": color},
    }


def checked_edit(arguments, objects):
    operation = arguments.get("operation")
    if operation == "list":
        return {"operation": "list"}
    if operation == "clear":
        return {"operation": "clear", "ids": [obj["id"] for obj in objects]}
    ids = arguments.get("ids")
    if (
        not isinstance(ids, list)
        or not ids
        or len(ids) > 300
        or not all(isinstance(i, str) for i in ids)
    ):
        raise ValueError("Supply existing object IDs")
    known = {obj["id"]: obj for obj in objects}
    if len(set(ids)) != len(ids) or any(i not in known for i in ids):
        raise ValueError("Unknown or duplicate object ID")
    if operation == "remove":
        return {"operation": operation, "ids": ids}
    if operation == "recolor" and arguments.get("color") in COLORS:
        return {"operation": operation, "ids": ids, "color": arguments["color"]}
    if operation == "move":
        dx, dy = arguments.get("dx"), arguments.get("dy")
        if any(
            isinstance(value, bool) or not isinstance(value, (int, float)) or not -1 <= value <= 1
            for value in (dx, dy)
        ):
            raise ValueError("Move requires finite dx and dy between -1 and 1")
        for obj_id in ids:
            for point in known[obj_id]["points"]:
                # ScreenPoint also rejects NaN and infinity.
                ScreenPoint(x=point["x"] + dx, y=point["y"] + dy)
        return {"operation": operation, "ids": ids, "dx": dx, "dy": dy}
    raise ValueError("Invalid edit")


async def deliver(screen, send, payload):
    """An applied owner acknowledgement is required before the tutor reports success."""
    request_id = str(uuid4())
    epoch, source = screen.epoch, screen.source
    future = asyncio.get_running_loop().create_future()
    screen.pending[request_id] = future
    try:
        await send(
            {
                "tassel": {
                    "kind": "screen-marks",
                    "source": source,
                    "epoch": epoch,
                    "revision": screen.revision,
                    "request_id": request_id,
                    **payload,
                }
            }
        )
        async with asyncio.timeout(8):
            ok = await future
        return bool(ok and epoch == screen.epoch and source == screen.source)
    except TimeoutError:
        return False
    finally:
        screen.pending.pop(request_id, None)
