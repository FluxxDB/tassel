"""Migration 0007 goes up and down cleanly, on a database of its own (the shared test database
stays at head), and leaves a single head."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from conftest import TEST_DATABASE_URL
from sqlalchemy import create_engine, inspect, make_url, text

SERVER_DIR = Path(__file__).resolve().parents[2]
TABLES = {"session_messages", "session_attachments"}


def _config() -> Config:
    return Config(str(SERVER_DIR / "alembic.ini"))


def test_there_is_one_head_and_it_is_the_chat_migration():
    assert ScriptDirectory.from_config(_config()).get_heads() == ["0007"]


@pytest.fixture
def scratch_url():
    url = make_url(TEST_DATABASE_URL)
    name = f"{url.database}_migration"
    admin = create_engine(url.set(database="tassel"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _tables(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return set(inspect(conn).get_table_names())
    finally:
        engine.dispose()


def test_the_chat_tables_go_up_and_down(scratch_url, monkeypatch):
    monkeypatch.setenv("TASSEL_DATABASE_URL", scratch_url)
    command.upgrade(_config(), "head")
    assert TABLES <= _tables(scratch_url)
    command.downgrade(_config(), "0006")
    assert not TABLES & _tables(scratch_url)
    assert "sessions" in _tables(scratch_url)
    command.upgrade(_config(), "head")
    assert TABLES <= _tables(scratch_url)
