"""Shared fixtures: a migrated test database, a database session and an HTTP client.

Set ``TASSEL_TEST_DATABASE_URL`` to test against another database. The default is
``tassel_test`` on the Docker Compose Postgres (``docker compose up -d db``).

Every test runs without the developer's voice settings and keys (``scrub_voice_env``).
"""

import asyncio
import os
from collections.abc import AsyncIterator, Iterator
from fnmatch import fnmatchcase
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.app import create_app
from tassel.config import Settings
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import Base

SERVER_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get(
    "TASSEL_TEST_DATABASE_URL",
    "postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_test",
)


_VOICE_KEYS = ("DEEPGRAM_API_KEY", "OPENROUTER_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY")


def _is_voice_setting(name: str) -> bool:
    return (
        name in _VOICE_KEYS
        or fnmatchcase(name, "TASSEL_*PROVIDER*")
        or fnmatchcase(name, "TASSEL_VOICE_*")
    )


@pytest.fixture(autouse=True)
def scrub_voice_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """No test reaches a live provider or reads services/server/.env (P2-R16).

    Deletes every ``TASSEL_*PROVIDER*`` and ``TASSEL_VOICE_*`` variable and the four provider
    keys, and sets ``TASSEL_VOICE_ENV_FILE`` to empty, so ``VoiceSettings.load()`` reads no file
    and every provider is fake. A test that wants live settings constructs ``VoiceSettings(...)``.
    """
    for name in [name for name in os.environ if _is_voice_setting(name)]:
        monkeypatch.delenv(name)
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", "")


def pytest_asyncio_loop_factories(config, item):
    # psycopg's async mode can't use Windows' default Proactor loop. Elsewhere the
    # selector loop is already asyncio's default.
    return {"selector": asyncio.SelectorEventLoop}


def _create_database_if_missing(url: str) -> None:
    target = make_url(url)
    admin = create_engine(target.set(database="tassel"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            exists = conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target.database}
            )
            if not exists:
                name = conn.dialect.identifier_preparer.quote(target.database)
                conn.execute(text(f"CREATE DATABASE {name}"))
    finally:
        admin.dispose()


def _migrate(url: str) -> None:
    # alembic/env.py reads the URL from Settings, as the dev server and E2E setup do.
    with pytest.MonkeyPatch.context() as env:
        env.setenv("TASSEL_DATABASE_URL", url)
        command.upgrade(Config(str(SERVER_DIR / "alembic.ini")), "head")


@pytest.fixture(scope="session")
def migrated_engine() -> Iterator[Engine]:
    """Creates and migrates the test database once per test session."""
    name = make_url(TEST_DATABASE_URL).database or ""
    if "test" not in name:
        pytest.exit(f"Refusing to truncate {name!r}: a test database name must contain 'test'.")
    _create_database_if_missing(TEST_DATABASE_URL)
    _migrate(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def db_url(migrated_engine: Engine) -> str:
    """The test database's URL. Every table is emptied before each test."""
    with migrated_engine.begin() as conn:
        quote = conn.dialect.identifier_preparer.format_table
        tables = ", ".join(quote(table) for table in Base.metadata.sorted_tables)
        # Fail fast, rather than hang, if a leaked connection still holds a lock.
        conn.execute(text("SET LOCAL lock_timeout = '5s'"))
        conn.execute(text(f"TRUNCATE TABLE {tables}"))
    return TEST_DATABASE_URL


@pytest_asyncio.fixture
async def db(db_url: str) -> AsyncIterator[AsyncSession]:
    engine = make_engine(db_url)
    try:
        async with session_factory(engine)() as session:
            yield session
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(db_url: str) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(Settings(database_url=db_url))
    # ASGITransport doesn't send lifespan events, so run the lifespan (the engine) here.
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
