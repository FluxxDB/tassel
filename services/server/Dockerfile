# The Tassel server (FastAPI, Pipecat, OpenCV) as one Linux image for every collaborator. It
# builds natively on arm64 (Apple Silicon) and amd64 (Windows, Intel): the base images are
# multi-arch and every dependency installs from uv.lock as a wheel.
# docker-compose.yml runs it with src/ and alembic/ bind-mounted and uvicorn reloading on edits.
# Provider keys are never in the image: Compose mounts the settings file at run time, and
# .dockerignore keeps .env files out of the build context.
FROM python:3.12-slim-trixie

COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/tassel/services/server/.venv \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/tassel/services/server/.venv/bin:$PATH

# The repository's layout, so paths the server derives from its own location (the repository
# root, five levels above a module) resolve as they do on the host.
WORKDIR /tassel/services/server

# Dependencies first, in their own layer, so a source edit doesn't reinstall them.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

EXPOSE 8787
# Create the database if it's missing and migrate it, then serve.
ENTRYPOINT ["python", "-m", "tassel.scripts.container"]
CMD ["uvicorn", "tassel.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8787"]
