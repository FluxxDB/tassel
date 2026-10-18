"""The server container's start: the database it may create, then migrations, then uvicorn."""

import pytest

from tassel.scripts import container
from tassel.scripts.ensure_database import database_to_create


def test_creates_tassel_databases_on_loopback_and_on_the_compose_service():
    assert database_to_create("postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel") == (
        "tassel"
    )
    assert (
        database_to_create("postgresql+psycopg://tassel:tassel@db:5432/tassel_t2_avatar_dev")
        == "tassel_t2_avatar_dev"
    )


def test_leaves_remote_databases_alone_and_refuses_names_outside_tassel():
    assert database_to_create("postgresql+psycopg://u:p@db.example.com:5432/prod") is None
    with pytest.raises(ValueError):
        database_to_create("postgresql+psycopg://tassel:tassel@db:5432/postgres")


def test_container_start_creates_then_migrates_then_runs_the_command(monkeypatch):
    calls = []
    monkeypatch.setenv("TASSEL_DATABASE_URL", "postgresql+psycopg://tassel:tassel@db:5432/tassel")
    monkeypatch.setattr(container, "ensure_database", lambda url: calls.append(("ensure", url)))
    monkeypatch.setattr(
        container.command, "upgrade", lambda config, rev: calls.append(("migrate", rev))
    )
    monkeypatch.setattr(container.os, "execvp", lambda file, argv: calls.append(("exec", argv)))
    container.main(["uvicorn", "tassel.app:create_app", "--factory"])
    assert calls == [
        ("ensure", "postgresql+psycopg://tassel:tassel@db:5432/tassel"),
        ("migrate", "head"),
        ("exec", ["uvicorn", "tassel.app:create_app", "--factory"]),
    ]


def test_container_start_needs_a_command():
    with pytest.raises(SystemExit):
        container.main([])
