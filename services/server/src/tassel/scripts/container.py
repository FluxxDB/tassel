"""The server container's entrypoint (services/server/Dockerfile).

``python -m tassel.scripts.container <command...>`` creates the database if it's missing, migrates
it to head, then replaces itself with the command (uvicorn), so restarting the container is all
it takes to apply a new migration.
"""

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from tassel.config import Settings
from tassel.scripts.ensure_database import ensure_database

# src/tassel/scripts/container.py -> services/server is three levels up.
SERVER_DIR = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        raise SystemExit("usage: python -m tassel.scripts.container <command> [args...]")
    ensure_database(Settings().database_url)
    command.upgrade(Config(str(SERVER_DIR / "alembic.ini")), "head")
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    main()
