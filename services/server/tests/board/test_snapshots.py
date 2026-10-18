import asyncio
import base64
import io
import time
import uuid

import pytest
from PIL import Image


async def auth(client):
    token = (await client.post("/v1/devices")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def create(client, headers):
    response = await client.post(
        "/v1/sessions",
        headers=headers,
        json={
            "type": "homework",
            "language": "en",
            "source": "paper",
        },
    )
    assert response.status_code == 201
    return response.json()


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_registry_returns_only_fresh_snapshot_and_isolates_sessions():
    from tassel.board.snapshots import BoardSnapshots

    snapshots = BoardSnapshots()
    session = uuid.uuid4()
    snapshots.put(session, b"old")
    since = time.monotonic()
    assert await snapshots.wait(session, since, timeout=0.01) is None
    task = asyncio.create_task(snapshots.wait(session, since, timeout=0.1))
    await asyncio.sleep(0)
    snapshots.put(uuid.uuid4(), b"other")
    assert not task.done()
    snapshots.put(session, b"new")
    assert await task == b"new"
    assert await snapshots.wait(session, since, timeout=0) == b"new"


@pytest.mark.asyncio
async def test_upload_supplies_waiter(client, app):
    owner = await auth(client)
    session_id = (await create(client, owner))["id"]
    since = time.monotonic()
    image = png()
    response = await client.post(
        f"/v1/sessions/{session_id}/board/snapshot",
        headers=owner,
        json={"image_png": base64.b64encode(image).decode()},
    )
    assert response.status_code == 204
    assert await app.state.board_snapshots.wait(uuid.UUID(session_id), since, timeout=0) == image


@pytest.mark.asyncio
async def test_upload_requires_owner(client):
    owner, intruder = await auth(client), await auth(client)
    session_id = (await create(client, owner))["id"]
    url = f"/v1/sessions/{session_id}/board/snapshot"
    body = {"image_png": base64.b64encode(png()).decode()}
    assert (await client.post(url, json=body)).status_code == 401
    assert (await client.post(url, json=body, headers=intruder)).status_code == 404
    url = f"/v1/sessions/{uuid.uuid4()}/board/snapshot"
    assert (await client.post(url, json=body, headers=owner)).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "image,status",
    [
        ("not base64!", 422),
        (base64.b64encode(b"not png").decode(), 422),
        (base64.b64encode(b"\x89PNG\r\n\x1a\ntruncated").decode(), 422),
        (base64.b64encode(b"x" * (2 * 1024 * 1024 + 1)).decode(), 413),
    ],
    ids=["base64", "not-png", "truncated", "too-large"],
)
async def test_upload_rejects_invalid_images(client, image, status):
    owner = await auth(client)
    session_id = (await create(client, owner))["id"]
    response = await client.post(
        f"/v1/sessions/{session_id}/board/snapshot",
        headers=owner,
        json={"image_png": image},
    )
    assert response.status_code == status


@pytest.mark.asyncio
async def test_registry_expires_snapshots_after_sixty_seconds(monkeypatch):
    from tassel.board.snapshots import BoardSnapshots

    clock = [100.0]
    monkeypatch.setattr("tassel.board.snapshots.time.monotonic", lambda: clock[0])
    snapshots = BoardSnapshots()
    session = uuid.uuid4()
    snapshots.put(session, b"expired")
    clock[0] = 161.0
    assert await snapshots.wait(session, since=0, timeout=0) is None


@pytest.mark.asyncio
async def test_registry_keeps_only_128_most_recently_updated_sessions():
    from tassel.board.snapshots import BoardSnapshots

    snapshots = BoardSnapshots()
    sessions = [uuid.uuid4() for _ in range(129)]
    for session in sessions[:128]:
        snapshots.put(session, b"image")
    snapshots.put(sessions[0], b"refreshed")
    snapshots.put(sessions[128], b"new")
    assert await snapshots.wait(sessions[1], since=0, timeout=0) is None
    assert await snapshots.wait(sessions[0], since=0, timeout=0) == b"refreshed"
    assert await snapshots.wait(sessions[128], since=0, timeout=0) == b"new"
