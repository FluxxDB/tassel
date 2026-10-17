"""Run the server: ``uv run tassel-server`` (or ``python -m tassel``)."""

import sys

import uvicorn

from tassel.app import create_app
from tassel.config import Settings


def uvicorn_loop(platform: str = sys.platform) -> str:
    """Pick uvicorn's event loop. psycopg's async mode can't run on Windows' Proactor loop."""
    return "asyncio:SelectorEventLoop" if platform == "win32" else "auto"


def main() -> None:
    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, loop=uvicorn_loop())


if __name__ == "__main__":
    main()
