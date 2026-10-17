"""Application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tassel import __version__
from tassel.api import devices, health, sessions
from tassel.config import Settings
from tassel.frames import api as frames
from tassel.frames.objects import make_object_store
from tassel.storage.db import make_engine, session_factory


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    engine = make_engine(app.state.settings.database_url)
    app.state.engine = engine
    app.state.session_factory = session_factory(engine)
    try:
        yield
    finally:
        await engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = Settings()
    app = FastAPI(title="Tassel", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    # Here, not in the lifespan, so tests can swap it. The S3 store connects on first use.
    app.state.object_store = make_object_store(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_headers=["Authorization", "Content-Type"],
        allow_methods=["*"],
        # So the app can read how long a 429 asks it to wait.
        expose_headers=["Retry-After"],
    )
    for router in (health.router, devices.router, sessions.router, frames.router):
        app.include_router(router, prefix="/v1")
    return app
