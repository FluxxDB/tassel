"""Stored synthetic paper → model image, freeze context and authenticated app snapshot."""

import json
import uuid
from datetime import UTC, datetime

import numpy as np
import pytest

from tassel.beats.markup import BoardContext, parse_command
from tassel.vision.clips import frame_at
from tassel.vision.page import decode_jpeg, encode_jpeg, flatten_page


async def session(client):
    token = (await client.post("/v1/devices")).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post(
        "/v1/sessions",
        headers=headers,
        json={
            "type": "homework",
            "language": "en",
            "source": "paper",
        },
    )
    return headers, response.json()["id"]


async def upload(client, headers, sid, jpeg, *, quad=None, captured="2026-10-17T14:32:05Z"):
    meta = dict(
        reason="page",
        source="fake-clip",
        captured_at=captured,
        page_found=quad is not None,
        page_quad=quad,
        crop_rect=None,
        mask=None,
        detector={"changed_cells": 0, "ink_pixels": 0, "erase_pixels": 0, "version": "p3.1"},
    )
    result = await client.post(
        f"/v1/sessions/{sid}/frames",
        headers=headers,
        files={"frame": ("blob", jpeg, "image/jpeg")},
        data={"meta": json.dumps(meta)},
    )
    assert result.status_code == 201, result.text
    return result.json()


@pytest.mark.asyncio
async def test_newest_page_and_targets_match_synthetic_state_circles(client, db, store, clip, app):
    from tassel.vision.turn_image import latest_page_view, make_turn_image_for, turn_image_for

    headers, sid = await session(client)
    files = clip("dfa-demo")
    jpeg = frame_at(files.mjpeg, 47100)
    await upload(client, headers, sid, jpeg, captured="2026-10-17T15:00:00Z")
    newest = await upload(client, headers, sid, jpeg)  # seq, not device clock, wins
    view = await latest_page_view(uuid.UUID(sid), db=db, store=store)
    assert view is not None
    assert str(view.frame_id) == newest["id"]
    assert view.captured_at == datetime(2026, 10, 17, 14, 32, 5, tzinfo=UTC)
    flat = decode_jpeg(view.page_jpeg)
    marked = decode_jpeg(view.marked_jpeg)
    assert flat.shape == marked.shape
    assert np.any(flat != marked)
    truth = json.loads(files.truth.read_text())
    circles = [el for el in view.elements if el.kind == "circle"]
    assert len(circles) == 4
    for element, state in zip(circles, truth["dfa"]["states"], strict=True):
        box = element.box
        x, y = state["center"]["x"] * view.width, state["center"]["y"] * view.height
        assert box.x < x < box.x + box.w and box.y < y < box.y + box.h
    assert [el.id for el in view.elements] == [f"m{i + 1}" for i in range(len(view.elements))]
    ctx = BoardContext()
    result = await turn_image_for(uuid.UUID(sid), db=db, store=store, context=ctx)
    bound = make_turn_image_for(app.state.session_factory, store, context=ctx)
    assert await bound(uuid.UUID(sid)) == result
    assert result is not None and result[0] == view.marked_jpeg
    assert "[[circle m3]]" in result[1] and "[[freeze]]" in result[1]
    freeze = parse_command("freeze", ctx).model_dump(mode="json")
    assert freeze["frame"] == {
        "kind": "paper",
        "id": newest["id"],
        "capturedAt": view.captured_at.isoformat(),
    }
    assert freeze["elements"]["detected"]["items"] == [e.model_dump() for e in view.elements]
    assert parse_command("circle m3", ctx).model_dump()["mark"]["target"] == {"el": "m3"}
    # Explicitly naming another frame must never reuse this frame's geometry.
    assert parse_command("freeze frame=other", ctx).elements is None
    response = await client.get(f"/v1/sessions/{sid}/frames/{newest['id']}/page", headers=headers)
    assert response.status_code == 200
    assert response.content == view.page_jpeg
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_empty_or_pageless_newest_returns_none_and_clears_context(client, db, store):
    from tassel.vision.turn_image import latest_page_view, turn_image_for

    headers, sid = await session(client)
    assert await latest_page_view(uuid.UUID(sid), db=db, store=store) is None
    ctx = BoardContext()
    jpeg = encode_jpeg(np.full((300, 400, 3), 180, np.uint8))
    quad = [{"x": 40, "y": 30}, {"x": 360, "y": 30}, {"x": 360, "y": 270}, {"x": 40, "y": 270}]
    await upload(client, headers, sid, jpeg, quad=quad)
    assert await turn_image_for(uuid.UUID(sid), db=db, store=store, context=ctx) is not None
    assert ctx.paper_frame is not None
    row = await upload(client, headers, sid, jpeg)
    assert await turn_image_for(uuid.UUID(sid), db=db, store=store, context=ctx) is None
    assert ctx.paper_frame is None and ctx.paper_elements is None
    result = await client.get(f"/v1/sessions/{sid}/frames/{row['id']}/page", headers=headers)
    assert result.status_code == 404


@pytest.mark.asyncio
async def test_supplied_quad_wins_and_endpoint_requires_owner(client, db, store):
    from tassel.domains.dfa.contract import Pt
    from tassel.vision.turn_image import latest_page_view

    headers, sid = await session(client)
    jpeg = encode_jpeg(np.full((300, 400, 3), 180, np.uint8))
    quad = [{"x": 40, "y": 30}, {"x": 360, "y": 30}, {"x": 360, "y": 270}, {"x": 40, "y": 270}]
    row = await upload(client, headers, sid, jpeg, quad=quad)
    view = await latest_page_view(uuid.UUID(sid), db=db, store=store)
    assert view is not None
    assert view.page_jpeg == encode_jpeg(flatten_page(jpeg, [Pt(**p) for p in quad]).rgb)
    url = f"/v1/sessions/{sid}/frames/{row['id']}/page"
    other, other_sid = await session(client)
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=other)).status_code == 404
    assert (await client.get(url.replace(sid, other_sid), headers=other)).status_code == 404


@pytest.mark.asyncio
async def test_failed_lookup_clears_previous_turn_context(client, db, store):
    from tassel.frames.objects import ObjectStoreError
    from tassel.vision.turn_image import latest_page_view, turn_image_for

    headers, sid = await session(client)
    jpeg = encode_jpeg(np.full((300, 400, 3), 180, np.uint8))
    quad = [{"x": 40, "y": 30}, {"x": 360, "y": 30}, {"x": 360, "y": 270}, {"x": 40, "y": 270}]
    await upload(client, headers, sid, jpeg, quad=quad)
    view = await latest_page_view(uuid.UUID(sid), db=db, store=store)
    ctx = BoardContext()
    view.set_context(ctx)

    class FailedStore:
        async def get(self, key):
            raise ObjectStoreError("offline")

    with pytest.raises(ObjectStoreError):
        await turn_image_for(uuid.UUID(sid), db=db, store=FailedStore(), context=ctx)
    assert ctx.paper_frame is None and ctx.paper_elements is None and ctx.paper_spec is None
