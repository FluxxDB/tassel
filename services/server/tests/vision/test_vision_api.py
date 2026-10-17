"""The real upload hook and authenticated vision routes, with synthetic inputs only."""

import base64
import json
from pathlib import Path
from uuid import UUID

import cv2
import numpy as np
import pytest

from tassel.app import create_app
from tassel.config import Settings
from tassel.vision.clips import frame_at
from tassel.vision.fakes.deepcheck import NamedFixtureDeepCheck
from tassel.vision.gate import FakeGate
from tassel.vision.settings import VisionConfigError, VisionSettings

pytestmark = pytest.mark.asyncio


async def owner(client):
    token = (await client.post("/v1/devices")).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    result = await client.post(
        "/v1/sessions",
        headers=headers,
        json={"type": "homework", "language": "en", "source": "paper"},
    )
    return headers, result.json()["id"]


async def upload(client, headers, sid, data):
    meta = json.loads((Path(__file__).parents[1] / "frames/frame-meta-example.json").read_text())
    meta.update(reason="page", page_quad=None, crop_rect=None, mask=None)
    return await client.post(
        f"/v1/sessions/{sid}/frames",
        headers=headers,
        files={"frame": ("frame", data, "image/jpeg")},
        data={"meta": json.dumps(meta)},
    )


async def test_upload_feeds_snapshot(client, app, clip):
    headers, sid = await owner(client)
    url = f"/v1/sessions/{sid}/vision"
    empty = await client.get(url, headers=headers)
    assert empty.status_code == 200 and empty.json()["frames_seen"] == 0
    response = await upload(client, headers, sid, frame_at(clip("dfa-demo").mjpeg, 26700))
    assert response.status_code == 201
    snapshot = (await client.get(url, headers=headers)).json()
    assert snapshot["frames_seen"] == 1
    assert app.state.vision.get(UUID(sid)) is not None


@pytest.mark.parametrize("missing", [True, False])
async def test_upload_survives_missing_or_failing_registry(client, app, clip, missing):
    headers, sid = await owner(client)
    saved = app.state.vision

    class Broken:
        def on_frame(self, **kwargs):
            raise RuntimeError("private provider detail")

    if missing:
        del app.state.vision
    else:
        app.state.vision = Broken()
    try:
        response = await upload(client, headers, sid, frame_at(clip("dfa-demo").mjpeg, 26700))
        assert response.status_code == 201
        image = await client.get(
            f"/v1/sessions/{sid}/frames/{response.json()['id']}/image",
            headers=headers,
            params={"part": "full"},
        )
        assert image.status_code == 200
    finally:
        app.state.vision = saved


async def test_vision_routes_require_owner_and_validate_board(client):
    headers, sid = await owner(client)
    other, _ = await owner(client)
    url = f"/v1/sessions/{sid}/vision"
    reading = NamedFixtureDeepCheck("demo-wrong")._reading.model_dump(mode="json")
    reading["source"] = "board"
    png = cv2.imencode(".png", np.full((24, 32, 3), 255, np.uint8))[1].tobytes()
    body = {"reading": reading, "image_png": base64.b64encode(png).decode()}
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=other)).status_code == 404
    assert (await client.post(url + "/board", headers=other, json=body)).status_code == 404
    assert (await client.post(url + "/board", headers=headers, json=body)).status_code == 202
    assert (
        await client.post(url + "/board", headers=headers, json={**body, "reading": {}})
    ).status_code == 422
    for invalid in ("not base64!", base64.b64encode(b"not a png").decode()):
        assert (
            await client.post(url + "/board", headers=headers, json={**body, "image_png": invalid})
        ).status_code == 422
    huge = base64.b64encode(b"x" * (3 * 1024 * 1024)).decode()
    assert (
        await client.post(url + "/board", headers=headers, json={**body, "image_png": huge})
    ).status_code == 413


async def test_lifespan_rejects_missing_live_key(db_url):
    app = create_app(
        Settings(database_url=db_url, object_store="memory"),
        vision_settings=VisionSettings(_env_file=None, gate_provider="live"),
    )
    with pytest.raises(VisionConfigError, match="OPENAI_API_KEY"):
        async with app.router.lifespan_context(app):
            pass


async def test_lifespan_is_fake_under_the_scrub(app, monkeypatch):
    monkeypatch.setenv("TASSEL_PROVIDERS", "auto")
    async with app.router.lifespan_context(app):
        assert isinstance(app.state.vision.gate, FakeGate)
        assert isinstance(app.state.vision.deepcheck, NamedFixtureDeepCheck)


async def test_board_rejects_png_decoder_errors_as_422(client):
    import struct
    import zlib

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    # A tiny invalid PNG whose IHDR makes OpenCV raise cv2.error, not ValueError.
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 65536, 65536, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00"))
        + chunk(b"IEND", b"")
    )
    headers, sid = await owner(client)
    reading = NamedFixtureDeepCheck("demo-wrong")._reading.model_dump(mode="json")
    response = await client.post(
        f"/v1/sessions/{sid}/vision/board",
        headers=headers,
        json={"reading": reading, "image_png": base64.b64encode(png).decode()},
    )
    assert response.status_code == 422
