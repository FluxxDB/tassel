"""The OpenAPI contract that the desktop app's TypeScript client is generated from."""

import httpx
import pytest
import pytest_asyncio

from tassel.app import create_app


@pytest_asyncio.fixture
async def openapi() -> dict:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/openapi.json")
    assert r.status_code == 200
    return r.json()


@pytest.mark.asyncio
async def test_declares_an_http_bearer_security_scheme(openapi):
    [scheme] = openapi["components"]["securitySchemes"].values()
    assert scheme["type"] == "http" and scheme["scheme"].lower() == "bearer"


@pytest.mark.asyncio
async def test_token_routes_declare_the_bearer_scheme_instead_of_a_header(openapi):
    [name] = openapi["components"]["securitySchemes"]
    for path in ("/v1/sessions", "/v1/sessions/{session_id}", "/v1/me"):
        for operation in openapi["paths"][path].values():
            assert operation["security"] == [{name: []}]
            params = [p["name"].lower() for p in operation.get("parameters", [])]
            assert "authorization" not in params


@pytest.mark.asyncio
async def test_registration_and_health_need_no_token(openapi):
    assert "security" not in openapi["paths"]["/v1/devices"]["post"]
    assert "security" not in openapi["paths"]["/v1/health"]["get"]


@pytest.mark.asyncio
async def test_patch_offers_null_only_where_it_clears_a_field(openapi):
    fields = openapi["components"]["schemas"]["SessionPatch"]["properties"]
    for clearable in ("title", "subject"):
        assert {"type": "null"} in fields[clearable]["anyOf"]
    for required_when_sent in ("type", "language"):
        assert "anyOf" not in fields[required_when_sent]
        assert fields[required_when_sent]["type"] == "string"


@pytest.mark.asyncio
async def test_me_types_ui_language_as_a_session_language(openapi):
    ui_language = openapi["components"]["schemas"]["MeOut"]["properties"]["ui_language"]
    assert ui_language["enum"] == ["en", "es", "ko"]
