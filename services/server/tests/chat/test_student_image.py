"""The student's image Ada can show and mark: the latest she sent, its Set-of-Mark computed once
per attachment, the boxes the app reads to place `el` marks, and the elements route.

Every image here is synthetic (tests/image_marks_fixtures.py).
"""

import io
import uuid

import pytest
from image_marks_fixtures import textbook
from PIL import Image

from tassel.beats.models import DetectedElements
from tassel.chat import student_image
from tassel.chat.store import ChatStore, LoadedAttachment
from tassel.chat.student_image import LatestImage, detected_elements, view_of
from tassel.storage.db import make_engine, session_factory
from tassel.vision.image_marks import image_view

pytestmark = pytest.mark.asyncio

NEW_SESSION = {"type": "homework", "language": "en", "source": "paper"}


@pytest.fixture(scope="module")
def page() -> bytes:
    return textbook().png()


def attachment(data: bytes, attachment_id: str | None = None) -> LoadedAttachment:
    with Image.open(io.BytesIO(data)) as image:
        w, h = image.size
    return LoadedAttachment(attachment_id or str(uuid.uuid4()), data, "image/png", w, h)


async def test_an_attachments_view_is_computed_once(page, monkeypatch):
    calls = []

    def counted(data):
        calls.append(len(data))
        return image_view(data)

    monkeypatch.setattr(student_image, "image_view", counted)
    attachment_id = str(uuid.uuid4())
    first = await view_of(attachment_id, page)
    second = await view_of(attachment_id, page)
    assert first is second and len(calls) == 1
    assert first.elements and first.width == 1000 and first.height == 850


async def test_an_image_that_wont_decode_has_no_view():
    assert await view_of(str(uuid.uuid4()), b"not an image") is None


async def test_the_detected_boxes_are_the_views_elements_in_image_pixels(page):
    view = await view_of(str(uuid.uuid4()), page)
    detected = detected_elements(view)
    assert isinstance(detected, DetectedElements)
    assert (detected.width, detected.height) == (view.width, view.height)
    assert [e.id for e in detected.items] == [e.id for e in view.elements]
    for item in detected.items:
        assert item.box.x + item.box.w <= detected.width
        assert item.box.y + item.box.h <= detected.height


class Chat:
    def __init__(self, stored=None):
        self.stored = stored
        self.asked = 0

    async def latest_attachment(self, learner_id, session_id):
        self.asked += 1
        return self.stored


async def test_the_latest_image_is_the_last_she_sent_with_its_view(page):
    older, newer = attachment(page), attachment(page)
    latest = LatestImage(Chat(stored=older), uuid.uuid4(), uuid.uuid4())
    latest.sent([older, newer])
    image = await latest.current()
    assert image.id == newer.id
    assert image.view.elements
    stage = image.stage()
    assert stage.id == newer.id
    assert [e.id for e in stage.detected.items] == [e.id for e in image.view.elements]


async def test_after_a_reconnect_the_latest_image_is_the_sessions_last_stored(page):
    stored = attachment(page)
    chat = Chat(stored=stored)
    latest = LatestImage(chat, uuid.uuid4(), uuid.uuid4())
    assert (await latest.current()).id == stored.id
    assert chat.asked == 1


async def test_no_image_without_one_sent_or_stored():
    assert await LatestImage(Chat(), uuid.uuid4(), uuid.uuid4()).current() is None
    assert await LatestImage(None, uuid.uuid4(), uuid.uuid4()).current() is None
    # A store that can't say (an older fake) is no image, never an error.
    assert await LatestImage(object(), uuid.uuid4(), uuid.uuid4()).current() is None


async def auth(client):
    token = (await client.post("/v1/devices")).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    learner_id = (await client.get("/v1/me", headers=headers)).json()["learner_id"]
    session_id = (await client.post("/v1/sessions", json=NEW_SESSION, headers=headers)).json()["id"]
    return headers, learner_id, session_id


async def upload(client, headers, session_id, data):
    r = await client.post(
        f"/v1/sessions/{session_id}/attachments",
        files={"image": ("blob", data, "image/png")},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_store_knows_the_sessions_latest_image(client, app, db_url, page):
    headers, learner_id, session_id = await auth(client)
    other_headers, other_learner, other_session = await auth(client)
    await upload(client, headers, session_id, page)
    newest = await upload(client, headers, session_id, page)
    engine = make_engine(db_url)
    try:
        chat = ChatStore(session_factory(engine), app.state.object_store)
        latest = await chat.latest_attachment(uuid.UUID(learner_id), uuid.UUID(session_id))
        assert latest.id == newest["id"] and (latest.width, latest.height) == (1000, 850)
        assert latest.data and latest.mime == "image/jpeg"
        # Another learner's session finds nothing of hers, and none of its own yet.
        assert await chat.latest_attachment(uuid.UUID(other_learner), uuid.UUID(session_id)) is None
        assert (
            await chat.latest_attachment(uuid.UUID(other_learner), uuid.UUID(other_session)) is None
        )
    finally:
        await engine.dispose()


async def test_the_elements_route_serves_the_images_set_of_mark(client, page):
    headers, _, session_id = await auth(client)
    sent = await upload(client, headers, session_id, page)
    url = f"/v1/sessions/{session_id}/attachments/{sent['id']}/elements"
    r = await client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    view = image_view(page)
    assert (body["width"], body["height"]) == (view.width, view.height) == (sent["w"], sent["h"])
    assert [item["id"] for item in body["items"]] == [e.id for e in view.elements]
    first = body["items"][0]
    assert set(first) == {"id", "kind", "box"} and set(first["box"]) == {"x", "y", "w", "h"}
    assert r.headers["cache-control"] == "private, no-store"


async def test_the_elements_route_finds_nothing_for_another_learner(client, page):
    headers, _, session_id = await auth(client)
    other, _, other_session = await auth(client)
    sent = await upload(client, headers, session_id, page)
    for who, session in ((other, session_id), (other, other_session), (headers, other_session)):
        url = f"/v1/sessions/{session}/attachments/{sent['id']}/elements"
        assert (await client.get(url, headers=who)).status_code == 404
    missing = f"/v1/sessions/{session_id}/attachments/{uuid.uuid4()}/elements"
    assert (await client.get(missing, headers=headers)).status_code == 404
    assert (await client.get(missing)).status_code == 401
