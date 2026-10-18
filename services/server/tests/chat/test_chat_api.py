"""The chat routes: a student's images in (checked, downscaled, stored in the session's prefix),
served back, a paper frame snapped into one, and the saved conversation, oldest first.

Every image here is synthetic.
"""

import io
import json
import uuid
from pathlib import Path

import pytest
from PIL import Image

from tassel.chat import repo
from tassel.chat.store import ChatStore
from tassel.storage.db import make_engine, session_factory
from tassel.voice.messages import ChatMessageEvent, MessageAction, MessageAttachment

pytestmark = pytest.mark.asyncio

NEW_SESSION = {"type": "homework", "language": "en", "source": "paper"}
META_EXAMPLE = Path(__file__).parents[1] / "frames" / "frame-meta-example.json"


def picture(width, height, fmt="JPEG", mode="RGB", color=(200, 120, 40)) -> bytes:
    image = Image.new(mode, (width, height), color)
    out = io.BytesIO()
    image.save(out, fmt)
    return out.getvalue()


async def auth(client) -> dict[str, str]:
    token = (await client.post("/v1/devices")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def learner(client) -> tuple[dict[str, str], str, str]:
    headers = await auth(client)
    learner_id = (await client.get("/v1/me", headers=headers)).json()["learner_id"]
    r = await client.post("/v1/sessions", json=NEW_SESSION, headers=headers)
    return headers, learner_id, r.json()["id"]


async def send(client, headers, session_id, data, mime="image/jpeg"):
    return await client.post(
        f"/v1/sessions/{session_id}/attachments",
        files={"image": ("blob", data, mime)},
        headers=headers,
    )


async def test_an_image_is_stored_and_served_back(client, store):
    headers, learner_id, session_id = await learner(client)
    r = await send(client, headers, session_id, picture(640, 480))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["w"] == 640 and body["h"] == 480
    uuid.UUID(body["id"])
    prefix = f"learners/{learner_id}/sessions/{session_id}/attachments/"
    assert store.keys() == [f"{prefix}{body['id']}.jpg"]
    got = await client.get(f"/v1/sessions/{session_id}/attachments/{body['id']}", headers=headers)
    assert got.status_code == 200
    assert got.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(got.content)).size == (640, 480)


async def test_a_large_image_is_downscaled_to_2048_on_the_long_side(client):
    headers, _, session_id = await learner(client)
    r = await send(client, headers, session_id, picture(4096, 1024, "PNG"), "image/png")
    assert r.status_code == 201
    assert (r.json()["w"], r.json()["h"]) == (2048, 512)
    got = await client.get(
        f"/v1/sessions/{session_id}/attachments/{r.json()['id']}", headers=headers
    )
    # No transparency: stored as a JPEG.
    assert got.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(got.content)).size == (2048, 512)


async def test_a_transparent_png_stays_a_png_and_webp_is_accepted(client):
    headers, _, session_id = await learner(client)
    clear = picture(100, 50, "PNG", "RGBA", (0, 0, 0, 0))
    r = await send(client, headers, session_id, clear, "image/png")
    got = await client.get(
        f"/v1/sessions/{session_id}/attachments/{r.json()['id']}", headers=headers
    )
    assert got.headers["content-type"] == "image/png"
    r = await send(client, headers, session_id, picture(300, 200, "WEBP"), "image/webp")
    assert r.status_code == 201 and (r.json()["w"], r.json()["h"]) == (300, 200)


async def test_more_than_8_mib_is_refused_with_413(client, store):
    headers, _, session_id = await learner(client)
    r = await send(client, headers, session_id, b"\xff\xd8\xff" + b"\0" * (8 * 1024 * 1024))
    assert r.status_code == 413
    assert store.keys() == []


@pytest.mark.parametrize(
    "data",
    [
        b"GIF89a" + b"\0" * 100,
        b"hello, not an image",
        # A JPEG signature with nothing that decodes after it.
        b"\xff\xd8\xff\xe0" + b"\0" * 64,
    ],
    ids=["gif", "text", "broken-jpeg"],
)
async def test_anything_but_a_jpeg_png_or_webp_is_refused_with_415(client, store, data):
    headers, _, session_id = await learner(client)
    assert (await send(client, headers, session_id, data)).status_code == 415
    assert store.keys() == []


async def test_an_upload_needs_exactly_one_of_an_image_or_a_frame(client):
    headers, _, session_id = await learner(client)
    url = f"/v1/sessions/{session_id}/attachments"
    assert (await client.post(url, headers=headers)).status_code == 422
    r = await client.post(
        url,
        params={"frame_id": str(uuid.uuid4())},
        files={"image": ("blob", picture(10, 10), "image/jpeg")},
        headers=headers,
    )
    assert r.status_code == 422


async def test_routes_need_a_device_token(client):
    _, _, session_id = await learner(client)
    assert (await client.get(f"/v1/sessions/{session_id}/messages")).status_code == 401


async def test_another_learners_session_and_images_are_not_found(client):
    owner, _, session_id = await learner(client)
    r = await send(client, owner, session_id, picture(20, 20))
    attachment = r.json()["id"]
    stranger, _, own_session = await learner(client)
    assert (await send(client, stranger, session_id, picture(20, 20))).status_code == 404
    url = f"/v1/sessions/{session_id}/attachments/{attachment}"
    assert (await client.get(url, headers=stranger)).status_code == 404
    # Nor through a session of the stranger's own.
    url = f"/v1/sessions/{own_session}/attachments/{attachment}"
    assert (await client.get(url, headers=stranger)).status_code == 404
    url = f"/v1/sessions/{session_id}/messages"
    assert (await client.get(url, headers=stranger)).status_code == 404
    unknown = f"/v1/sessions/{session_id}/attachments/{uuid.uuid4()}"
    assert (await client.get(unknown, headers=owner)).status_code == 404


async def upload_frame(client, headers, session_id, jpeg) -> str:
    meta = {
        **json.loads(META_EXAMPLE.read_text()),
        "reason": "page",
        "crop_rect": None,
        "mask": None,
    }
    r = await client.post(
        f"/v1/sessions/{session_id}/frames",
        files={"frame": ("blob", jpeg, "image/jpeg")},
        data={"meta": json.dumps(meta)},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_snap_my_paper_copies_her_own_frame_into_an_attachment(client, store):
    headers, _, session_id = await learner(client)
    frame_id = await upload_frame(client, headers, session_id, picture(1280, 960))
    r = await client.post(
        f"/v1/sessions/{session_id}/attachments",
        params={"frame_id": frame_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    got = await client.get(
        f"/v1/sessions/{session_id}/attachments/{r.json()['id']}", headers=headers
    )
    assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(got.content)).size == (r.json()["w"], r.json()["h"])
    # Another learner can't snap it, and an unknown frame isn't found.
    stranger, _, own_session = await learner(client)
    for session, frame in ((session_id, frame_id), (own_session, frame_id)):
        r = await client.post(
            f"/v1/sessions/{session}/attachments", params={"frame_id": frame}, headers=stranger
        )
        assert r.status_code == 404
    r = await client.post(
        f"/v1/sessions/{session_id}/attachments",
        params={"frame_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert r.status_code == 404


async def test_deleting_the_session_deletes_its_images(client, store):
    headers, _, session_id = await learner(client)
    await send(client, headers, session_id, picture(20, 20))
    assert store.keys()
    r = await client.delete(f"/v1/sessions/{session_id}", headers=headers)
    assert r.status_code == 204
    assert store.keys() == []


def line(**changes) -> ChatMessageEvent:
    fields = dict(
        id=str(uuid.uuid4()),
        client_id=None,
        role="tutor",
        source="voice",
        text="Hello",
        final=True,
        interrupted=False,
        attachments=[],
        action=None,
    )
    return ChatMessageEvent(**(fields | changes))


async def test_the_saved_conversation_comes_back_oldest_first(client, app, db_url):
    headers, _, session_id = await learner(client)
    url = f"/v1/sessions/{session_id}/messages"
    assert (await client.get(url, headers=headers)).json() == {"messages": []}
    attachment = (await send(client, headers, session_id, picture(64, 32))).json()
    sid = uuid.UUID(session_id)
    engine = make_engine(db_url)
    try:
        chat = ChatStore(session_factory(engine), app.state.object_store)
        typed = line(
            role="student",
            source="typed",
            client_id="c-1",
            text="Here's part b",
            attachments=[MessageAttachment(**attachment)],
        )
        drew = line(
            role="action",
            source=None,
            text="",
            action=MessageAction(kind="draw", side="board", item="dfa", attachment_id=None),
        )
        reply = line(text="Part b wants strings ending in 10.", interrupted=True)
        # Saved out of order: the seq is what orders them.
        await chat.save(sid, 3, reply)
        await chat.save(sid, 1, typed)
        await chat.save(sid, 2, drew)
        # A reconnect's bot racing the last write still keeps the line, after the others.
        late = line(text="One more thing.")
        await chat.save(sid, 2, late)
        async with session_factory(engine)() as db:
            assert await repo.last_seq(db, sid) == 4
    finally:
        await engine.dispose()
    messages = (await client.get(url, headers=headers)).json()["messages"]
    assert [m["id"] for m in messages] == [typed.id, drew.id, reply.id, late.id]
    first = messages[0]
    assert first["client_id"] == "c-1" and first["source"] == "typed"
    assert first["attachments"] == [attachment]
    assert messages[1]["action"] == {
        "kind": "draw",
        "side": "board",
        "item": "dfa",
        "attachment_id": None,
    }
    assert messages[2]["interrupted"] is True and messages[2]["role"] == "tutor"
    assert all("created_at" in m for m in messages)
