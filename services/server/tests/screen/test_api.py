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
