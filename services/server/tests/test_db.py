import httpx
import pytest
from fastapi import Depends
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.app import create_app
from tassel.config import Settings
from tassel.storage.db import get_db


@pytest.mark.asyncio
async def test_get_db_yields_a_session_on_the_configured_database(db_url):
    app = create_app(Settings(database_url=db_url))

    @app.get("/probe")
    async def probe(db: AsyncSession = Depends(get_db)) -> str:
        return await db.scalar(text("select current_database()"))

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get("/probe")
    assert r.status_code == 200
    assert r.json() == make_url(db_url).database
