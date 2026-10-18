"""Application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tassel import __version__
from tassel.api import devices, health, memory, sessions
from tassel.config import Settings
from tassel.frames import api as frames
from tassel.frames.objects import make_object_store
from tassel.storage.db import make_engine, session_factory
from tassel.voice import api as voice_api
from tassel.voice.settings import VoiceConfigError, VoiceSettings, check_voice_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from tassel.vision.turn_image import make_turn_image_for
    from tassel.voice.registry import VoiceRegistry

    voice_settings = app.state.voice_settings or VoiceSettings.load()
    problems = check_voice_settings(voice_settings)
    if problems:
        raise VoiceConfigError("\n".join(problems))
    app.state.voice_settings = voice_settings
    engine = make_engine(app.state.settings.database_url)
    app.state.engine = engine
    app.state.session_factory = session_factory(engine)
    try:
        app.state.voice = VoiceRegistry(
            settings=voice_settings,
            sessions=app.state.session_factory,
            # Each student turn sees her latest stored page (vision-lite), on the bot's board.
            turn_images=lambda board: make_turn_image_for(
                app.state.session_factory, app.state.object_store, context=board
            ),
        )
        try:
            yield
        finally:
            await app.state.voice.shutdown()
    finally:
        await engine.dispose()


def create_app(
    settings: Settings | None = None, voice_settings: VoiceSettings | None = None
) -> FastAPI:
    if settings is None:
        settings = Settings()
    app = FastAPI(title="Tassel", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    # Here, not in the lifespan, so tests can swap it. The S3 store connects on first use.
    app.state.object_store = make_object_store(settings)
    app.state.voice_settings = voice_settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_headers=["Authorization", "Content-Type"],
        allow_methods=["*"],
        # So the app can read how long a 429 asks it to wait.
        expose_headers=["Retry-After"],
    )
    for router in (
        health.router,
        devices.router,
        sessions.router,
        memory.router,
        frames.router,
        voice_api.router,
    ):
        app.include_router(router, prefix="/v1")
    for error in frames.STORE_ERRORS:
        app.add_exception_handler(error, frames.store_unavailable)
    return app
