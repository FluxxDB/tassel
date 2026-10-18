"""Exercise real routing, validation and ownership without Postgres or providers."""

from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image

from tassel.auth import current_learner
from tassel.screen.api import router
from tassel.screen.session import ScreenSessions
from tassel.storage import sessions_repo
from tassel.storage.db import get_db


@pytest.mark.asyncio
async def test_owned_explicit_sharing_is_required_and_reset_rejects_old_frames(monkeypatch):
    learner = SimpleNamespace(id=uuid4())
    session_id = uuid4()
    app = FastAPI()
    app.state.screens = ScreenSessions()
    app.include_router(router)
    app.dependency_overrides[current_learner] = lambda: learner
    app.dependency_overrides[get_db] = lambda: None

    async def owned(db, learner_id, sid):
        return SimpleNamespace(id=sid) if sid == session_id else None

    monkeypatch.setattr(sessions_repo, "get_for", owned)
    image = BytesIO()
    Image.new("RGB", (100, 100), "white").save(image, format="JPEG")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://localhost"
    ) as client:
        base = f"/sessions/{session_id}/screen"
        params = {"source": "display", "epoch": 1, "revision": 0, "frame_id": "frame-one"}
        assert (
            await client.post(
                base + "/frame",
                params=params,
                content=image.getvalue(),
                headers={"Content-Type": "image/jpeg"},
            )
        ).status_code == 409
        assert (
            await client.post(
                base + "/control", json={"source": "display", "epoch": 1, "active": True}
            )
        ).status_code == 200
        assert (
            await client.post(
                base + "/frame",
                params=params,
                content=b"bad",
                headers={"Content-Type": "image/jpeg"},
            )
        ).status_code == 415
        assert (
            await client.post(
                base + "/frame",
                params=params,
                content=image.getvalue(),
                headers={"Content-Type": "image/jpeg"},
            )
        ).status_code == 201
        from unittest.mock import AsyncMock

        screen = app.state.screens.get(learner.id, session_id)
        screen.cancel = AsyncMock()
        for revision, active in [(1, False), (2, True)]:
            response = await client.post(
                base + "/activity",
                json={
                    "source": "display",
                    "epoch": 1,
                    "revision": revision,
                    "active": active,
                },
            )
            assert response.status_code == 200
            assert screen.active is active
            assert screen.frame is None
        screen.cancel.assert_not_awaited()
        assert (
            await client.post(
                base + "/activity",
                json={
                    "source": "display",
                    "epoch": 1,
                    "revision": 1,
                    "active": False,
                },
            )
        ).status_code == 409
        assert (
            await client.post(
                base + "/control", json={"source": "display", "epoch": 2, "active": False}
            )
        ).json() == {"epoch": 2, "active": False}
        assert (
            await client.post(
                base + "/frame",
                params=params,
                content=image.getvalue(),
                headers={"Content-Type": "image/jpeg"},
            )
        ).status_code == 409
        assert (
            await client.post(
                f"/sessions/{uuid4()}/screen/control",
                json={"source": "display", "epoch": 3, "active": True},
            )
        ).status_code == 404
        assert (
            await client.post(
                base + "/control", json={"source": "display", "epoch": "3", "active": True}
            )
        ).status_code == 422


@pytest.mark.parametrize("kind", ["circle", "underline", "arrow"])
def test_screen_shapes_require_two_distinct_points(kind):
    from pydantic import ValidationError

    from tassel.screen.api import ScreenDrawing

    for points in [[{"x": 0.7, "y": 0.6}], [{"x": 0.7, "y": 0.6}] * 2]:
        with pytest.raises(ValidationError):
            ScreenDrawing(frame_id="current", kind=kind, points=points)


def test_pointer_requires_one_point_and_circle_requires_area():
    from pydantic import ValidationError

    from tassel.screen.api import ScreenDrawing

    with pytest.raises(ValidationError):
        ScreenDrawing(frame_id="current", kind="pointer", points=[{"x": 0.2, "y": 0.3}] * 2)
    with pytest.raises(ValidationError):
        ScreenDrawing(
            frame_id="current", kind="circle", points=[{"x": 0.2, "y": 0.3}, {"x": 0.8, "y": 0.3}]
        )


def test_screen_tool_defines_image_coordinates_and_shape_geometry():
    from tassel.voice.tools import DRAW_SCREEN

    schema = DRAW_SCREEN.to_default_dict()
    points = schema["parameters"]["properties"]["points"]["description"]
    assert "opposite corners" in points
    assert "underline" in points and "below" in points
    assert "pointer" in points and "one" in points
    assert "width" in schema["description"] and "height" in schema["description"]


@pytest.mark.parametrize(
    "kind,points,text",
    [
        ("text", [{"x": 0.2, "y": 0.3}], "A useful note"),
        ("rectangle", [{"x": 0.2, "y": 0.3}, {"x": 0.6, "y": 0.7}], None),
        ("freehand", [{"x": 0.2, "y": 0.3}, {"x": 0.6, "y": 0.7}, {"x": 0.4, "y": 0.5}], None),
    ],
)
def test_extended_screen_shapes(kind, points, text):
    from tassel.screen.api import ScreenDrawing

    assert ScreenDrawing(frame_id="current", kind=kind, points=points, text=text).kind == kind


@pytest.mark.asyncio
async def test_objects_and_results_require_current_owned_screen(monkeypatch):
    import asyncio

    learner = SimpleNamespace(id=uuid4())
    session_id = uuid4()
    app = FastAPI()
    app.state.screens = ScreenSessions()
    app.include_router(router)
    app.dependency_overrides[current_learner] = lambda: learner
    app.dependency_overrides[get_db] = lambda: None

    async def owned(db, learner_id, sid):
        return SimpleNamespace(id=sid) if sid == session_id else None

    monkeypatch.setattr(sessions_repo, "get_for", owned)
    screen = app.state.screens.get(learner.id, session_id)
    screen.control(source="display", epoch=4, active=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://localhost"
    ) as client:
        base = f"/sessions/{session_id}/screen"
        body = {
            "source": "display",
            "epoch": 4,
            "version": 1,
            "objects": [
                {
                    "id": "circle",
                    "kind": "circle",
                    "author": "tutor",
                    "color": "violet",
                    "points": [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.5}],
                }
            ],
        }
        assert (await client.post(base + "/objects", json=body)).status_code == 200
        assert screen.objects[0]["id"] == "circle"
        assert (await client.post(base + "/objects", json=body)).status_code == 409
        assert (
            await client.post(base + "/objects", json={**body, "epoch": 3, "version": 2})
        ).status_code == 409
        assert (
            await client.post(f"/sessions/{uuid4()}/screen/objects", json=body)
        ).status_code == 404
        screen = app.state.screens.get(learner.id, session_id)
        future = asyncio.get_running_loop().create_future()
        screen.pending["request"] = future
        result = {"source": "display", "epoch": 4, "request_id": "request", "ok": True}
        assert (await client.post(base + "/result", json={**result, "epoch": 3})).status_code == 409
        assert not future.done()
        assert (await client.post(base + "/result", json=result)).status_code == 200
        assert await future
        rejected = asyncio.get_running_loop().create_future()
        screen.pending["rejected"] = rejected
        assert (
            await client.post(
                base + "/result",
                json={
                    **result,
                    "request_id": "rejected",
                    "ok": False,
                    "reason": "screen-frame-changed",
                },
            )
        ).status_code == 200
        with pytest.raises(ValueError, match="screen-frame-changed"):
            await rejected


def test_screen_result_accepts_only_bounded_rejection_reasons():
    from pydantic import ValidationError

    from tassel.screen.api import ScreenResult

    body = {"source": "display", "epoch": 1, "request_id": "draw", "ok": False}
    assert ScreenResult(**body, reason="screen-frame-changed").reason == "screen-frame-changed"
    with pytest.raises(ValidationError):
        ScreenResult(**body, reason="arbitrary instructions")
