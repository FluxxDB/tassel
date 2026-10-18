"""The frames API: uploads and their checks, the list, images, and cleanup with the session.

Uploads go to the memory store (conftest's `app`); every JPEG is synthetic.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import httpx
import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from tassel.app import create_app
from tassel.config import Settings
from tassel.frames import repo as frames_repo
from tassel.frames.objects import MemoryObjectStore, ObjectStoreError
from tassel.frames.tables import Frame
from tassel.storage.tables import Base

NEW_SESSION = {"type": "homework", "language": "en", "source": "paper"}
# A request from the packaged app, so responses carry its CORS headers.
FROM_APP = {"Origin": "app://tassel"}


def at(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)


async def auth(client) -> dict[str, str]:
    token = (await client.post("/v1/devices")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def new_session(client, headers) -> str:
    r = await client.post("/v1/sessions", json=NEW_SESSION, headers=headers)
    assert r.status_code == 201
    return r.json()["id"]


async def learner_with_session(client) -> tuple[dict[str, str], str, str]:
    """A new learner's auth headers, their id and one session of theirs."""
    headers = await auth(client)
    learner_id = (await client.get("/v1/me", headers=headers)).json()["learner_id"]
    return headers, learner_id, await new_session(client, headers)


async def upload(client, headers, session_id, meta, *, frame, crop=None) -> httpx.Response:
    """POSTs the parts the app sends: `frame`, optionally `crop`, and `meta` as JSON text."""
    files = {"frame": ("blob", frame, "image/jpeg")}
    if crop is not None:
        files["crop"] = ("blob", crop, "image/jpeg")
    body = meta if isinstance(meta, str) else json.dumps(meta)
    return await client.post(
        f"/v1/sessions/{session_id}/frames", files=files, data={"meta": body}, headers=headers
    )


def page_of(ink_meta: dict[str, Any]) -> dict[str, Any]:
    """The example as a page event: no crop rectangle and no mask."""
    return {**ink_meta, "reason": "page", "crop_rect": None, "mask": None}


def image_url(session_id: str, frame_id: str) -> str:
    return f"/v1/sessions/{session_id}/frames/{frame_id}/image"


@asynccontextmanager
async def serve(db_url: str, **settings: Any) -> AsyncIterator[tuple[httpx.AsyncClient, Any]]:
    """A client and store for an app with other settings, built as conftest's `app` is."""
    defaults: dict[str, Any] = {"object_store": "memory", "frame_min_interval_s": 0}
    app = create_app(Settings(database_url=db_url, **(defaults | settings)))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, app.state.object_store


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["fake-clip", "webcam"])
async def test_upload_stores_objects_row_and_returns_frame_out(
    client, store, make_jpeg, ink_meta, source
):
    ink_meta = {**ink_meta, "source": source}
    headers, learner_id, session_id = await learner_with_session(client)
    full, crop = make_jpeg(64, 48), make_jpeg(16, 16)

    r = await upload(client, headers, session_id, ink_meta, frame=full, crop=crop)

    assert r.status_code == 201
    out = r.json()
    assert (out["seq"], out["width"], out["height"], out["has_crop"]) == (1, 64, 48, True)
    assert (out["session_id"], out["bytes"]) == (session_id, len(full))
    assert (out["reason"], out["source"], out["page_found"]) == ("ink", source, True)
    assert at(out["captured_at"]) == at("2026-10-17T14:32:05.120Z")
    assert at(out["created_at"]).tzinfo is not None
    for field in ("page_quad", "crop_rect", "mask"):
        assert out[field] == ink_meta[field]
    frame = f"learners/{learner_id}/sessions/{session_id}/frames/{out['id']}/"
    assert store.keys() == [f"{frame}crop.jpg", f"{frame}full.jpg"]
    assert await store.get(f"{frame}full.jpg") == full
    assert await store.get(f"{frame}crop.jpg") == crop
    assert store.content_type(f"{frame}full.jpg") == "image/jpeg"
    assert store.content_type(f"{frame}crop.jpg") == "image/jpeg"


@pytest.mark.asyncio
async def test_upload_keeps_the_detector_counts_in_the_row(client, db, make_jpeg, ink_meta):
    headers, _, session_id = await learner_with_session(client)
    r = await upload(
        client, headers, session_id, ink_meta, frame=make_jpeg(64, 48), crop=make_jpeg(16, 16)
    )
    row = await db.get_one(Frame, uuid.UUID(r.json()["id"]))
    assert row.meta["detector"] == ink_meta["detector"]
    assert row.meta["mask"] == ink_meta["mask"]


@pytest.mark.asyncio
async def test_upload_bumps_last_activity(client, make_jpeg, ink_meta):
    headers, _, session_id = await learner_with_session(client)
    before = (await client.get(f"/v1/sessions/{session_id}", headers=headers)).json()

    r = await upload(client, headers, session_id, page_of(ink_meta), frame=make_jpeg(64, 48))

    assert r.status_code == 201
    after = (await client.get(f"/v1/sessions/{session_id}", headers=headers)).json()
    assert at(after["last_activity_at"]) > at(before["last_activity_at"])


@pytest.mark.asyncio
async def test_seq_increments_per_session_and_restarts_per_session(client, make_jpeg, ink_meta):
    headers, _, first = await learner_with_session(client)
    second = await new_session(client, headers)
    page, full = page_of(ink_meta), make_jpeg(64, 48)

    seqs = [(await upload(client, headers, first, page, frame=full)).json()["seq"] for _ in "ab"]

    assert seqs == [1, 2]
    assert (await upload(client, headers, second, page, frame=full)).json()["seq"] == 1
    assert (await upload(client, headers, first, page, frame=full)).json()["seq"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("part", ["frame", "crop"])
@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(b"GIF89a, not a JPEG", id="other-format"),
        pytest.param(b"\xff\xd8\xff\xd9", id="no-sof"),
        pytest.param(b"", id="empty"),
    ],
)
async def test_rejects_non_jpeg_415(client, store, make_jpeg, ink_meta, part, bad):
    headers, _, session_id = await learner_with_session(client)
    parts = {"frame": make_jpeg(64, 48), "crop": make_jpeg(16, 16), part: bad}

    r = await upload(client, headers, session_id, ink_meta, **parts)

    assert r.status_code == 415
    assert store.keys() == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("setting", "part"), [("frame_max_bytes", "frame"), ("crop_max_bytes", "crop")]
)
async def test_rejects_oversize_frame_413(db_url, make_jpeg, ink_meta, setting, part):
    noisy = make_jpeg(64, 48, noise=True)
    assert len(noisy) > 1000
    async with serve(db_url, **{setting: 1000}) as (client, store):
        headers, _, session_id = await learner_with_session(client)
        parts = {"frame": make_jpeg(64, 48), "crop": make_jpeg(16, 16), part: noisy}

        r = await upload(client, headers, session_id, ink_meta, **parts)

        assert r.status_code == 413
        assert store.keys() == []


@pytest.mark.asyncio
async def test_a_frame_of_exactly_the_limit_is_accepted(db_url, make_jpeg, ink_meta):
    full = make_jpeg(64, 48)
    async with serve(db_url, frame_max_bytes=len(full)) as (client, _):
        headers, _, session_id = await learner_with_session(client)
        r = await upload(client, headers, session_id, page_of(ink_meta), frame=full)
        assert r.status_code == 201


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["crop part", "mask", "crop_rect"])
async def test_ink_without_crop_or_mask_422(client, store, make_jpeg, ink_meta, missing):
    headers, _, session_id = await learner_with_session(client)
    crop = None if missing == "crop part" else make_jpeg(16, 16)
    meta = ink_meta if missing == "crop part" else {**ink_meta, missing: None}

    r = await upload(client, headers, session_id, meta, frame=make_jpeg(64, 48), crop=crop)

    assert r.status_code == 422
    assert store.keys() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("where", ["top", "crop_rect", "detector"])
async def test_meta_extra_field_422(client, make_jpeg, ink_meta, where):
    headers, _, session_id = await learner_with_session(client)
    if where == "top":
        meta = {**ink_meta, "transcript": "not here"}
    else:
        meta = {**ink_meta, where: {**ink_meta[where], "extra": 1}}

    r = await upload(
        client, headers, session_id, meta, frame=make_jpeg(64, 48), crop=make_jpeg(16, 16)
    )

    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("meta", ["{not json", '"a string"', "[]", ""])
async def test_meta_that_is_not_a_json_object_422(client, make_jpeg, meta):
    headers, _, session_id = await learner_with_session(client)
    r = await upload(client, headers, session_id, meta, frame=make_jpeg(64, 48))
    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("cell", [[50, 0], [0, 38], [-1, 0]])
async def test_mask_cell_out_of_range_422(client, make_jpeg, ink_meta, cell):
    headers, _, session_id = await learner_with_session(client)
    meta = {**ink_meta, "mask": {"cols": 50, "rows": 38, "cells": [[5, 12], cell]}}

    r = await upload(
        client, headers, session_id, meta, frame=make_jpeg(64, 48), crop=make_jpeg(16, 16)
    )

    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [3, 5])
async def test_page_quad_needs_four_points_422(client, make_jpeg, ink_meta, count):
    headers, _, session_id = await learner_with_session(client)
    meta = {**ink_meta, "page_quad": [{"x": 10, "y": 10}] * count}

    r = await upload(
        client, headers, session_id, meta, frame=make_jpeg(64, 48), crop=make_jpeg(16, 16)
    )

    assert r.status_code == 422


@pytest.mark.asyncio
async def test_page_reason_needs_no_crop_201(client, store, make_jpeg, ink_meta):
    headers, _, session_id = await learner_with_session(client)
    meta = {**page_of(ink_meta), "page_found": False, "page_quad": None}

    r = await upload(client, headers, session_id, meta, frame=make_jpeg(64, 48))

    assert r.status_code == 201
    out = r.json()
    assert (out["reason"], out["has_crop"], out["page_found"]) == ("page", False, False)
    assert (out["page_quad"], out["crop_rect"], out["mask"]) == (None, None, None)
    assert [key.rsplit("/", 1)[1] for key in store.keys()] == ["full.jpg"]


def slow_puts(store, monkeypatch) -> None:
    """Each put takes 50 ms, so two uploads overlap while they write their images."""
    put = store.put

    async def slow(key: str, data: bytes, content_type: str) -> None:
        await asyncio.sleep(0.05)
        await put(key, data, content_type)

    monkeypatch.setattr(store, "put", slow)


@pytest.mark.asyncio
async def test_concurrent_uploads_take_turns_for_seq(
    client, store, make_jpeg, ink_meta, monkeypatch
):
    headers, _, session_id = await learner_with_session(client)
    slow_puts(store, monkeypatch)
    page, full = page_of(ink_meta), make_jpeg(64, 48)

    first, second = await asyncio.gather(
        upload(client, headers, session_id, page, frame=full),
        upload(client, headers, session_id, page, frame=full),
    )

    assert (first.status_code, second.status_code) == (201, 201)
    assert sorted([first.json()["seq"], second.json()["seq"]]) == [1, 2]


@pytest.mark.asyncio
async def test_concurrent_uploads_meet_the_rate_guard(db_url, make_jpeg, ink_meta, monkeypatch):
    async with serve(db_url, frame_min_interval_s=60) as (client, store):
        headers, _, session_id = await learner_with_session(client)
        slow_puts(store, monkeypatch)
        page, full = page_of(ink_meta), make_jpeg(64, 48)

        responses = await asyncio.gather(
            upload(client, headers, session_id, page, frame=full),
            upload(client, headers, session_id, page, frame=full),
        )

        assert sorted(r.status_code for r in responses) == [201, 429]
        assert len(store.keys()) == 1


@pytest.mark.asyncio
async def test_rate_guard_429_with_retry_after(db_url, make_jpeg, ink_meta):
    async with serve(db_url, frame_min_interval_s=60) as (client, store):
        headers, _, session_id = await learner_with_session(client)
        page, full = page_of(ink_meta), make_jpeg(64, 48)

        first = await upload(client, headers, session_id, page, frame=full)
        second = await upload(client, headers, session_id, page, frame=full)

        assert first.status_code == 201
        assert second.status_code == 429
        assert second.headers["retry-after"] == "1"
        assert len(store.keys()) == 1  # the refused frame wrote nothing
        # The guard is per session.
        other = await new_session(client, headers)
        assert (await upload(client, headers, other, page, frame=full)).status_code == 201


@pytest.mark.asyncio
async def test_cors_exposes_retry_after(client):
    r = await client.get("/v1/health", headers={"Origin": "app://tassel"})
    assert r.headers["access-control-allow-origin"] == "app://tassel"
    exposed = {
        name.strip().lower() for name in r.headers["access-control-expose-headers"].split(",")
    }
    assert "retry-after" in exposed


@pytest.mark.asyncio
async def test_frame_routes_need_a_device_token(client, make_jpeg, ink_meta):
    headers, _, session_id = await learner_with_session(client)
    frame_id = str(uuid.uuid4())
    page = page_of(ink_meta)
    assert (await upload(client, {}, session_id, page, frame=make_jpeg(64, 48))).status_code == 401
    assert (await client.get(f"/v1/sessions/{session_id}/frames")).status_code == 401
    r = await client.get(image_url(session_id, frame_id), params={"part": "full"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_foreign_session_404_on_post_list_and_image(client, store, make_jpeg, ink_meta):
    owner, _, session_id = await learner_with_session(client)
    full, crop = make_jpeg(64, 48), make_jpeg(16, 16)
    frame_id = (await upload(client, owner, session_id, ink_meta, frame=full, crop=crop)).json()[
        "id"
    ]
    stranger = await auth(client)

    posted = await upload(client, stranger, session_id, ink_meta, frame=full, crop=crop)
    listed = await client.get(f"/v1/sessions/{session_id}/frames", headers=stranger)
    image = await client.get(
        image_url(session_id, frame_id), params={"part": "full"}, headers=stranger
    )

    assert (posted.status_code, listed.status_code, image.status_code) == (404, 404, 404)
    assert len(store.keys()) == 2  # only the owner's frame
    unknown = str(uuid.uuid4())
    assert (
        await upload(client, owner, unknown, ink_meta, frame=full, crop=crop)
    ).status_code == 404
    assert (await client.get(f"/v1/sessions/{unknown}/frames", headers=owner)).status_code == 404


@pytest.mark.asyncio
async def test_list_is_newest_first_and_limited(client, make_jpeg, ink_meta):
    headers, _, session_id = await learner_with_session(client)
    page, full = page_of(ink_meta), make_jpeg(64, 48)
    ids = [
        (await upload(client, headers, session_id, page, frame=full)).json()["id"] for _ in "abc"
    ]
    frames = f"/v1/sessions/{session_id}/frames"

    newest_two = (await client.get(frames, params={"limit": 2}, headers=headers)).json()["items"]
    every = (await client.get(frames, headers=headers)).json()["items"]

    assert [(f["id"], f["seq"]) for f in newest_two] == [(ids[2], 3), (ids[1], 2)]
    assert [f["seq"] for f in every] == [3, 2, 1]
    for limit in (0, 201):
        r = await client.get(frames, params={"limit": limit}, headers=headers)
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_of_a_session_without_frames_is_empty(client):
    headers, _, session_id = await learner_with_session(client)
    r = await client.get(f"/v1/sessions/{session_id}/frames", headers=headers)
    assert r.status_code == 200 and r.json() == {"items": []}


@pytest.mark.asyncio
async def test_image_returns_full_and_crop_bytes(client, make_jpeg, ink_meta):
    headers, _, session_id = await learner_with_session(client)
    full, crop = make_jpeg(64, 48), make_jpeg(16, 16)
    frame_id = (await upload(client, headers, session_id, ink_meta, frame=full, crop=crop)).json()[
        "id"
    ]

    for part, expected in (("full", full), ("crop", crop)):
        r = await client.get(
            image_url(session_id, frame_id), params={"part": part}, headers=headers
        )
        assert r.status_code == 200
        assert r.content == expected
        assert r.headers["content-type"] == "image/jpeg"
        assert r.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_image_missing_crop_404(client, store, make_jpeg, ink_meta):
    headers, learner_id, session_id = await learner_with_session(client)
    r = await upload(client, headers, session_id, page_of(ink_meta), frame=make_jpeg(64, 48))
    frame_id = r.json()["id"]
    url = image_url(session_id, frame_id)

    assert (await client.get(url, params={"part": "crop"}, headers=headers)).status_code == 404
    unknown = image_url(session_id, str(uuid.uuid4()))
    assert (await client.get(unknown, params={"part": "full"}, headers=headers)).status_code == 404
    assert (await client.get(url, params={"part": "thumb"}, headers=headers)).status_code == 422
    # The row is there but its object is gone.
    await store.delete_prefix(f"learners/{learner_id}/sessions/{session_id}/")
    assert (await client.get(url, params={"part": "full"}, headers=headers)).status_code == 404


async def frame_rows(db, session_id: str) -> int:
    count = await db.scalar(
        select(func.count()).select_from(Frame).where(Frame.session_id == uuid.UUID(session_id))
    )
    await db.commit()  # end the read, so the next test's TRUNCATE never waits on it
    return count


@pytest.mark.asyncio
async def test_delete_session_deletes_objects_then_rows(
    client, store, db, make_jpeg, ink_meta, monkeypatch
):
    headers, learner_id, session_id = await learner_with_session(client)
    kept = await new_session(client, headers)
    full, crop = make_jpeg(64, 48), make_jpeg(16, 16)
    for target in (session_id, session_id, kept):
        r = await upload(client, headers, target, ink_meta, frame=full, crop=crop)
        assert r.status_code == 201
    rows_while_deleting: list[int] = []
    delete_prefix = store.delete_prefix

    async def spy(prefix: str) -> int:
        rows_while_deleting.append(await frame_rows(db, session_id))
        return await delete_prefix(prefix)

    monkeypatch.setattr(store, "delete_prefix", spy)
    r = await client.delete(f"/v1/sessions/{session_id}", headers=headers)

    assert r.status_code == 204
    assert rows_while_deleting == [2]  # the objects went first, while the rows were there
    gone = f"learners/{learner_id}/sessions/{session_id}/"
    assert [key for key in store.keys() if key.startswith(gone)] == []
    assert await frame_rows(db, session_id) == 0
    assert len(store.keys()) == 2 and await frame_rows(db, kept) == 1  # the other session's


@pytest.mark.asyncio
async def test_delete_session_keeps_its_rows_when_objects_survive(
    client, store, db, make_jpeg, ink_meta, monkeypatch
):
    headers, _, session_id = await learner_with_session(client)
    r = await upload(client, headers, session_id, page_of(ink_meta), frame=make_jpeg(64, 48))
    assert r.status_code == 201

    async def fails(prefix: str) -> int:
        raise ObjectStoreError("1 of 1 objects weren't deleted")

    monkeypatch.setattr(store, "delete_prefix", fails)
    r = await client.delete(f"/v1/sessions/{session_id}", headers={**headers, **FROM_APP})

    assert r.status_code == 503
    assert r.headers["access-control-allow-origin"] == "app://tassel"
    # Nothing was deleted, so deleting again can finish the job.
    assert (await client.get(f"/v1/sessions/{session_id}", headers=headers)).status_code == 200
    assert await frame_rows(db, session_id) == 1
    assert len(store.keys()) == 1


@pytest.mark.asyncio
async def test_delete_session_without_frames_skips_the_store(client, store, monkeypatch):
    headers, _, session_id = await learner_with_session(client)

    async def unreachable(prefix: str) -> int:
        raise AssertionError("the store isn't needed for a session without frames")

    monkeypatch.setattr(store, "delete_prefix", unreachable)
    r = await client.delete(f"/v1/sessions/{session_id}", headers=headers)
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_failed_insert_deletes_the_objects_it_wrote(
    client, store, db, make_jpeg, ink_meta, monkeypatch
):
    headers, _, session_id = await learner_with_session(client)

    async def refused_insert(db, frame: Frame) -> Frame:
        await db.execute(text("SELECT 1 / 0"))  # the database refuses the statement
        raise AssertionError("unreachable")

    monkeypatch.setattr(frames_repo, "insert", refused_insert)
    with pytest.raises(DBAPIError):
        await upload(
            client, headers, session_id, ink_meta, frame=make_jpeg(64, 48), crop=make_jpeg(16, 16)
        )

    assert store.keys() == []
    assert await frame_rows(db, session_id) == 0


@pytest.mark.asyncio
async def test_failed_crop_write_deletes_the_full_frame(
    client, store, make_jpeg, ink_meta, monkeypatch
):
    headers, _, session_id = await learner_with_session(client)
    put = store.put

    async def crop_fails(key: str, data: bytes, content_type: str) -> None:
        if key.endswith("crop.jpg"):
            raise ObjectStoreError("the store refused the crop")
        await put(key, data, content_type)

    monkeypatch.setattr(store, "put", crop_fails)
    r = await upload(
        client, headers, session_id, ink_meta, frame=make_jpeg(64, 48), crop=make_jpeg(16, 16)
    )

    assert r.status_code == 503
    assert store.keys() == []


def store_down(kind: str) -> Exception:
    """What a failing store raises: its own error, or boto's for an outage or a refusal."""
    if kind == "object-store":
        return ObjectStoreError("1 of 2 objects weren't deleted")
    if kind == "unreachable":
        return EndpointConnectionError(endpoint_url="http://127.0.0.1:7070")
    return ClientError({"Error": {"Code": "AccessDenied"}}, "PutObject")


STORE_FAILURES = ["object-store", "unreachable", "refused"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", STORE_FAILURES)
async def test_store_failures_answer_503_inside_cors(
    client, store, db, make_jpeg, ink_meta, monkeypatch, kind
):
    # A 503 with CORS headers lets the app tell the server's trouble from being offline.
    headers, _, session_id = await learner_with_session(client)

    async def down(*args: Any) -> None:
        raise store_down(kind)

    monkeypatch.setattr(store, "put", down)
    r = await upload(
        client,
        {**headers, **FROM_APP},
        session_id,
        ink_meta,
        frame=make_jpeg(64, 48),
        crop=make_jpeg(16, 16),
    )

    assert r.status_code == 503
    assert r.headers["access-control-allow-origin"] == "app://tassel"
    assert "detail" in r.json()
    assert await frame_rows(db, session_id) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", STORE_FAILURES)
async def test_image_answers_503_when_the_store_fails(
    client, store, make_jpeg, ink_meta, monkeypatch, kind
):
    headers, _, session_id = await learner_with_session(client)
    r = await upload(client, headers, session_id, page_of(ink_meta), frame=make_jpeg(64, 48))

    async def down(key: str) -> bytes | None:
        raise store_down(kind)

    monkeypatch.setattr(store, "get", down)
    image = await client.get(
        image_url(session_id, r.json()["id"]),
        params={"part": "full"},
        headers={**headers, **FROM_APP},
    )

    assert image.status_code == 503
    assert image.headers["access-control-allow-origin"] == "app://tassel"


def test_frames_table_is_on_base_metadata():
    # conftest empties Base.metadata's tables; a table outside it with a foreign key into
    # sessions would make that TRUNCATE fail.
    assert Frame.__table__ is Base.metadata.tables["frames"]
    assert Frame.__table__ in Base.metadata.sorted_tables


@pytest.mark.asyncio
async def test_openapi_declares_the_frame_routes():
    schema = create_app(Settings(object_store="memory")).openapi()
    [scheme] = schema["components"]["securitySchemes"]
    frames = "/v1/sessions/{session_id}/frames"
    image = "/v1/sessions/{session_id}/frames/{frame_id}/image"
    for operation in (schema["paths"][frames]["post"], schema["paths"][frames]["get"]):
        assert operation["security"] == [{scheme: []}]
    image_get = schema["paths"][image]["get"]
    assert image_get["security"] == [{scheme: []}]
    assert list(image_get["responses"]["200"]["content"]) == ["image/jpeg"]
    upload_body = schema["paths"][frames]["post"]["requestBody"]["content"]
    assert list(upload_body) == ["multipart/form-data"]
    assert {"FrameOut", "FrameList", "FrameMeta"} <= set(schema["components"]["schemas"])


def test_openapi_declares_503_where_the_store_is_used():
    paths = create_app(Settings(object_store="memory")).openapi()["paths"]
    store_routes = [
        paths["/v1/sessions/{session_id}/frames"]["post"],
        paths["/v1/sessions/{session_id}/frames/{frame_id}/image"]["get"],
        paths["/v1/sessions/{session_id}"]["delete"],
    ]
    for operation in store_routes:
        assert "503" in operation["responses"]
    assert "503" not in paths["/v1/sessions/{session_id}/frames"]["get"]["responses"]


def test_memory_store_is_the_test_default(store):
    assert isinstance(store, MemoryObjectStore)


@pytest.mark.asyncio
async def test_a_frame_taken_for_a_turn_passes_the_rate_guard_and_says_so(
    db_url, make_jpeg, ink_meta
):
    """The server asks for it at most once a turn, and the turn shouldn't wait out the guard."""
    async with serve(db_url, frame_min_interval_s=60) as (client, store):
        headers, _, session_id = await learner_with_session(client)
        page, full = page_of(ink_meta), make_jpeg(64, 48)
        assert (await upload(client, headers, session_id, page, frame=full)).status_code == 201
        turn = {**page, "trigger": "turn"}
        response = await upload(client, headers, session_id, turn, frame=full)
        assert response.status_code == 201
        listed = await client.get(f"/v1/sessions/{session_id}/frames", headers=headers)
        assert listed.json()["items"][0]["trigger"] == "turn"
        assert listed.json()["items"][1]["trigger"] == "detector"
