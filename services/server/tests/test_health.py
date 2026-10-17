from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio

from tassel.app import create_app


@pytest_asyncio.fixture
async def no_db_client() -> AsyncIterator[httpx.AsyncClient]:
    """A client without the app's lifespan: health and CORS must work with no database."""
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def preflight(origin: str, method: str = "GET", headers: str | None = None) -> dict[str, str]:
    request = {"Origin": origin, "Access-Control-Request-Method": method}
    if headers is not None:
        request["Access-Control-Request-Headers"] = headers
    return request


@pytest.mark.asyncio
async def test_health_returns_ok_and_version(no_db_client):
    r = await no_db_client.get("/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": "0.1.0"}


@pytest.mark.asyncio
async def test_cors_allows_app_origin(no_db_client):
    r = await no_db_client.options("/v1/health", headers=preflight("app://tassel"))
    assert r.headers["access-control-allow-origin"] == "app://tassel"


@pytest.mark.asyncio
async def test_cors_allows_dev_origin_with_auth_headers(no_db_client):
    request = preflight("http://localhost:5173", "PATCH", "Authorization, Content-Type")
    r = await no_db_client.options("/v1/health", headers=request)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    allowed = {h.strip().lower() for h in r.headers["access-control-allow-headers"].split(",")}
    assert {"authorization", "content-type"} <= allowed


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", ["http://localhost:3000", "app://other", "null"])
async def test_cors_rejects_other_origins(no_db_client, origin):
    r = await no_db_client.options("/v1/health", headers=preflight(origin))
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers
