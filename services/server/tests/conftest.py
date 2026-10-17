"""Shared fixtures: a migrated test database, a database session, the app, its object store
and an HTTP client.

Set ``TASSEL_TEST_DATABASE_URL`` to test against another database. The default is
``tassel_test`` on the Docker Compose Postgres (``docker compose up -d db``).

Every test runs without the developer's vision settings and keys (``scrub_vision_env``), and
without the network: the real ``httpx`` and ``httpx2`` transports refuse every host but loopback
(``no_provider_network``). Both also hold for the whole run, from ``pytest_configure`` on, so
session-scoped fixtures and import-time code are covered too. ``tests/test_isolation.py`` checks
them.
"""

import asyncio
import os
from collections.abc import AsyncIterator, Iterator
from fnmatch import fnmatchcase
from pathlib import Path

import httpx
import httpx2
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.app import create_app
from tassel.config import Settings
from tassel.frames.objects import MemoryObjectStore
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import Base

SERVER_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get(
    "TASSEL_TEST_DATABASE_URL",
    "postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_test",
)


# The provider keys and SDK variables (a developer's shell often exports ANTHROPIC_API_KEY), and
# every vision setting that picks a mode or a fake. Names compare upper-cased, because
# pydantic-settings reads variable names in any case.
_VISION_SETTINGS = (
    "OPENAI_*",
    "ANTHROPIC_*",
    "VULTR_*",
    "TASSEL_*PROVIDER*",
    "TASSEL_GATE_*",
    "TASSEL_DEEPCHECK_*",
    "TASSEL_VISION_*",
    "TASSEL_FAKE_TRUTH",
    "TASSEL_FAKE_READING",
)


def _is_vision_setting(name: str) -> bool:
    return any(fnmatchcase(name.upper(), pattern) for pattern in _VISION_SETTINGS)


def _scrub_vision_env(patch: pytest.MonkeyPatch) -> None:
    for name in [name for name in os.environ if _is_vision_setting(name)]:
        patch.delenv(name)
    patch.setenv("TASSEL_VOICE_ENV_FILE", "")


@pytest.fixture(autouse=True)
def scrub_vision_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """No test sees a provider key or reads services/server/.env (P4 Task 1, C1).

    Deletes every ``OPENAI_*``, ``ANTHROPIC_*``, ``VULTR_*``, ``TASSEL_*PROVIDER*``,
    ``TASSEL_GATE_*``, ``TASSEL_DEEPCHECK_*`` and ``TASSEL_VISION_*`` variable, and
    ``TASSEL_FAKE_TRUTH`` and ``TASSEL_FAKE_READING``, and sets ``TASSEL_VOICE_ENV_FILE`` to empty,
    so ``VisionSettings.load()`` reads no file and the gate and the deep check are fake. A test
    that wants live settings constructs ``VisionSettings(...)`` with test values.
    """
    _scrub_vision_env(monkeypatch)


_LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})


def _refuse_unless_loopback(request: httpx.Request | httpx2.Request) -> None:
    host = request.url.host
    if host not in _LOOPBACK:
        raise RuntimeError(f"tests never reach the network: {host}")


def _guarded(original):
    def handle_request(self, request):
        _refuse_unless_loopback(request)
        return original(self, request)

    return handle_request


def _guarded_async(original):
    async def handle_async_request(self, request):
        _refuse_unless_loopback(request)
        return await original(self, request)

    return handle_async_request


def _refuse_the_network(patch: pytest.MonkeyPatch) -> None:
    for module in (httpx, httpx2):
        sync, asynchronous = module.HTTPTransport, module.AsyncHTTPTransport
        patch.setattr(sync, "handle_request", _guarded(sync.handle_request))
        patch.setattr(
            asynchronous,
            "handle_async_request",
            _guarded_async(asynchronous.handle_async_request),
        )


@pytest.fixture(autouse=True)
def no_provider_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real HTTP transports reach only loopback hosts, whatever a test or a setting asks.

    Both provider SDKs (on ``httpx2``) and the Clef adapter go through ``HTTPTransport`` or
    ``AsyncHTTPTransport``, so a request to OpenAI, Anthropic or Vultr fails before any name
    lookup or socket. ``MockTransport`` and ``ASGITransport`` are other classes, so fakes and the
    app under test still work, and so do local servers on ``localhost``, ``127.0.0.1`` and ``::1``.
    """
    _refuse_the_network(monkeypatch)


# The same, once for the whole run: session- and module-scoped fixtures, and the code test modules
# run as they are imported, all run before any function-scoped fixture does.
_RUN_PATCH = pytest.MonkeyPatch()


def pytest_configure(config: pytest.Config) -> None:
    _scrub_vision_env(_RUN_PATCH)
    _refuse_the_network(_RUN_PATCH)


def pytest_unconfigure(config: pytest.Config) -> None:
    _RUN_PATCH.undo()


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


@pytest.fixture
def app(db_url: str) -> FastAPI:
    """The app on the test database, with frames in memory and no upload rate limit.

    A test that needs other settings builds its own app the same way.
    """
    return create_app(Settings(database_url=db_url, object_store="memory", frame_min_interval_s=0))


@pytest.fixture
def store(app: FastAPI) -> MemoryObjectStore:
    return app.state.object_store


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    # ASGITransport doesn't send lifespan events, so run the lifespan (the engine) here.
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
