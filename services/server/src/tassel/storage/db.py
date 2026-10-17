"""The async engine, its session factory and the per-request ``get_db`` dependency."""

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(url: str) -> AsyncEngine:
    # pre_ping replaces pooled connections that died, for example after a dev DB restart.
    return create_async_engine(url, pool_pre_ping=True)


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # Rows stay readable after commit, so routes can serialize what they just wrote.
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request, on the engine that the app's lifespan put on ``app.state``."""
    async with request.app.state.session_factory() as session:
        yield session
