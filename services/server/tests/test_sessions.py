import uuid
from datetime import datetime

import pytest

NEW_SESSION = {"type": "homework", "language": "en", "source": "paper"}


def at(timestamp: str) -> datetime:
    # Compare instants, not strings: the JSON drops the fraction when microseconds are 0.
    return datetime.fromisoformat(timestamp)


async def auth(client) -> dict:
    token = (await client.post("/v1/devices")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def create(client, headers, **fields) -> dict:
    r = await client.post("/v1/sessions", json={**NEW_SESSION, **fields}, headers=headers)
    assert r.status_code == 201
    return r.json()


async def patch(client, headers, session_id, **changes) -> dict:
    r = await client.patch(f"/v1/sessions/{session_id}", json=changes, headers=headers)
    assert r.status_code == 200
    return r.json()


async def listed(client, headers, **params) -> list[str]:
    r = await client.get("/v1/sessions", params=params, headers=headers)
    assert r.status_code == 200
    return [s["id"] for s in r.json()["items"]]


@pytest.mark.asyncio
async def test_create_session_starts_untitled(client):
    h = await auth(client)
    s = await create(client, h)
    assert s["title"] is None and s["title_source"] is None and s["subject"] is None
    assert s["created_at"] == s["last_activity_at"]
    assert (s["type"], s["language"], s["source"]) == ("homework", "en", "paper")


@pytest.mark.asyncio
async def test_list_recent_orders_by_last_activity(client):
    h = await auth(client)
    a, b, c = [(await create(client, h))["id"] for _ in range(3)]
    await patch(client, h, a, subject="Automata")
    assert await listed(client, h, sort="recent") == [a, c, b]
    assert await listed(client, h) == [a, c, b]  # recent is the default


@pytest.mark.asyncio
async def test_list_created_orders_by_creation(client):
    h = await auth(client)
    a, b, c = [(await create(client, h))["id"] for _ in range(3)]
    await patch(client, h, a, subject="Automata")
    assert await listed(client, h, sort="created") == [c, b, a]


@pytest.mark.asyncio
async def test_list_topic_groups_subjects_nulls_last(client):
    h = await auth(client)
    first, second, cell, untitled = [(await create(client, h))["id"] for _ in range(4)]
    for session_id, subject in [(first, "Automata"), (second, "Automata"), (cell, "Cell biology")]:
        await patch(client, h, session_id, subject=subject)
    # Bump the older "Automata" session, so activity order differs from creation order.
    await patch(client, h, first, title="DFA practice")
    assert await listed(client, h, sort="topic") == [first, second, cell, untitled]


@pytest.mark.asyncio
async def test_search_matches_title_and_subject(client):
    h = await auth(client)
    by_title = (await create(client, h))["id"]
    by_subject = (await create(client, h))["id"]
    other = (await create(client, h))["id"]
    await patch(client, h, by_title, title="DFA practice")
    await patch(client, h, by_subject, subject="Automata · DFA")
    await patch(client, h, other, title="Mitosis")
    assert set(await listed(client, h, q="dfa")) == {by_title, by_subject}
    assert len(await listed(client, h, q="")) == 3


@pytest.mark.asyncio
async def test_patch_title_marks_student_source_and_bumps_activity(client):
    h = await auth(client)
    s = await create(client, h)
    patched = await patch(client, h, s["id"], title="Strings that start with 010")
    assert patched["title"] == "Strings that start with 010"
    assert patched["title_source"] == "student"
    assert at(patched["last_activity_at"]) > at(s["last_activity_at"])
    assert patched["created_at"] == s["created_at"]


@pytest.mark.asyncio
async def test_other_learner_gets_404(client):
    owner, intruder = await auth(client), await auth(client)
    s = await create(client, owner)
    url = f"/v1/sessions/{s['id']}"
    assert (await client.get(url, headers=intruder)).status_code == 404
    assert (await client.patch(url, json={"title": "Mine"}, headers=intruder)).status_code == 404
    assert (await client.delete(url, headers=intruder)).status_code == 404
    unchanged = await client.get(url, headers=owner)
    assert unchanged.status_code == 200 and unchanged.json() == s


@pytest.mark.asyncio
async def test_delete_then_404(client):
    h = await auth(client)
    url = f"/v1/sessions/{(await create(client, h))['id']}"
    r = await client.delete(url, headers=h)
    assert r.status_code == 204 and r.content == b""
    assert (await client.get(url, headers=h)).status_code == 404
    assert (await client.delete(url, headers=h)).status_code == 404
    assert await listed(client, h) == []


@pytest.mark.asyncio
async def test_rejects_invalid_language_422(client):
    h = await auth(client)
    r = await client.post("/v1/sessions", json={**NEW_SESSION, "language": "fr"}, headers=h)
    assert r.status_code == 422
    s = await create(client, h)
    r = await client.patch(f"/v1/sessions/{s['id']}", json={"language": "fr"}, headers=h)
    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/v1/sessions"),
        ("GET", "/v1/sessions"),
        ("GET", "/v1/sessions/00000000-0000-4000-8000-000000000000"),
        ("PATCH", "/v1/sessions/00000000-0000-4000-8000-000000000000"),
        ("DELETE", "/v1/sessions/00000000-0000-4000-8000-000000000000"),
    ],
    ids=["create", "list", "get", "patch", "delete"],
)
async def test_routes_require_a_device_token(client, method, path):
    r = await client.request(method, path, json=NEW_SESSION if method == "POST" else None)
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


@pytest.mark.asyncio
async def test_list_shows_only_own_sessions(client):
    mine, theirs = await auth(client), await auth(client)
    own = (await create(client, mine))["id"]
    await patch(client, theirs, (await create(client, theirs))["id"], title="DFA practice")
    for sort in ("recent", "created", "topic"):
        assert await listed(client, mine, sort=sort) == [own]
    assert await listed(client, mine, q="dfa") == []


@pytest.mark.asyncio
async def test_search_treats_like_wildcards_literally(client):
    h = await auth(client)
    percent = (await create(client, h))["id"]
    plain = (await create(client, h))["id"]
    await patch(client, h, percent, title="100% done")
    await patch(client, h, plain, title="Mitosis", subject="Cell biology")
    # Unescaped, "%" would match everything and "_" would match the space in "l b".
    assert await listed(client, h, q="%") == [percent]
    assert await listed(client, h, q="l_b") == []


@pytest.mark.asyncio
async def test_patch_null_title_clears_title_and_its_source(client):
    h = await auth(client)
    s = await create(client, h)
    await patch(client, h, s["id"], title="DFA practice", subject="Automata")
    cleared = await patch(client, h, s["id"], title=None)
    assert cleared["title"] is None and cleared["title_source"] is None
    assert cleared["subject"] == "Automata"
    assert (await patch(client, h, s["id"], subject=None))["subject"] is None


@pytest.mark.asyncio
async def test_patch_strips_strings_and_enforces_lengths(client):
    h = await auth(client)
    url = f"/v1/sessions/{(await create(client, h))['id']}"
    padded = {"title": "  DFA  ", "subject": " Automata "}
    stripped = (await client.patch(url, json=padded, headers=h)).json()
    assert stripped["title"] == "DFA" and stripped["subject"] == "Automata"
    assert (await client.patch(url, json={"subject": "   "}, headers=h)).json()["subject"] is None
    for bad in ({"title": "   "}, {"title": "x" * 81}, {"subject": "x" * 41}):
        assert (await client.patch(url, json=bad, headers=h)).status_code == 422
    assert (await client.patch(url, json={"title": "x" * 80}, headers=h)).status_code == 200


@pytest.mark.asyncio
async def test_patch_changes_type_and_language_but_never_nulls_them(client):
    h = await auth(client)
    s = await create(client, h)
    changed = await patch(client, h, s["id"], type="studying", language="ko")
    assert changed["type"] == "studying" and changed["language"] == "ko"
    assert changed["title_source"] is None
    for null in ({"type": None}, {"language": None}):
        r = await client.patch(f"/v1/sessions/{s['id']}", json=null, headers=h)
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_empty_patch_still_bumps_activity(client):
    h = await auth(client)
    s = await create(client, h)
    bumped = await patch(client, h, s["id"])
    assert at(bumped["last_activity_at"]) > at(s["last_activity_at"])
    assert {k: v for k, v in bumped.items() if k != "last_activity_at"} == {
        k: v for k, v in s.items() if k != "last_activity_at"
    }


@pytest.mark.asyncio
async def test_clients_cannot_set_server_owned_fields(client):
    h = await auth(client)
    forged = {"id": str(uuid.uuid4()), "learner_id": str(uuid.uuid4()), "title_source": "ai"}
    s = await create(client, h, **forged)
    assert s["id"] != forged["id"] and s["title_source"] is None
    patched = await patch(client, h, s["id"], **forged)
    assert patched["id"] == s["id"] and patched["title_source"] is None
    assert await listed(client, h) == [s["id"]]  # still owned by the caller


@pytest.mark.asyncio
async def test_list_rejects_unknown_sort_422(client):
    h = await auth(client)
    r = await client.get("/v1/sessions", params={"sort": "alphabetical"}, headers=h)
    assert r.status_code == 422
