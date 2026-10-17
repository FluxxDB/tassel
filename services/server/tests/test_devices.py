import hashlib
import uuid

import pytest
from sqlalchemy import select

from tassel.storage.tables import Device


@pytest.mark.asyncio
async def test_register_returns_token_and_stores_only_hash(client, db):
    r = await client.post("/v1/devices")
    assert r.status_code == 201
    token = r.json()["token"]
    assert len(token) >= 40
    stored = (await db.execute(select(Device.token_hash))).scalar_one()
    assert stored == hashlib.sha256(token.encode()).hexdigest() and token not in stored


@pytest.mark.asyncio
@pytest.mark.parametrize("header", [None, "Bearer nope", "Basic abc"])
async def test_me_rejects_bad_auth(client, header):
    r = await client.get("/v1/me", headers={"Authorization": header} if header else {})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


@pytest.mark.asyncio
async def test_me_resolves_learner(client):
    token = (await client.post("/v1/devices")).json()["token"]
    r = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["ui_language"] == "en"


@pytest.mark.asyncio
@pytest.mark.parametrize("header", ["", "Bearer", "Bearer ", "Token abc", "Bearer a b"])
async def test_me_rejects_malformed_bearer_headers(client, header):
    await client.post("/v1/devices")
    r = await client.get("/v1/me", headers={"Authorization": header})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


@pytest.mark.asyncio
async def test_me_accepts_the_scheme_in_any_case(client):
    token = (await client.post("/v1/devices")).json()["token"]
    r = await client.get("/v1/me", headers={"Authorization": f"bearer {token}"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_each_token_resolves_its_own_learner(client, db):
    first = (await client.post("/v1/devices")).json()
    second = (await client.post("/v1/devices")).json()
    owners = dict((await db.execute(select(Device.id, Device.learner_id))).all())
    assert len(set(owners.values())) == 2
    for device in (first, second):
        r = await client.get("/v1/me", headers={"Authorization": f"Bearer {device['token']}"})
        assert r.json()["learner_id"] == str(owners[uuid.UUID(device["device_id"])])


@pytest.mark.asyncio
async def test_authenticated_request_updates_last_seen_at(client, db):
    token = (await client.post("/v1/devices")).json()["token"]
    registered_at = (await db.execute(select(Device.last_seen_at))).scalar_one()
    await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert (await db.execute(select(Device.last_seen_at))).scalar_one() > registered_at
