# One shared Tassel startup

Use `Start-Tassel.cmd` on Windows, or `pnpm start` on any platform. The tracked Windows bootstrap finds Node in the current checkout, the primary checkout's local tools, or PATH, then calls the same tracked `scripts/start.mjs` used by pnpm.

The launcher runs **the current checkout**. It never launches a separate `.local/live-test` app, switches Git branches, chooses a feature demo, or creates a new account/profile per feature. Paper/webcam, Screen overlay, voice, board, avatar, memory and personality are available in the integrated app UI. Windows uses the ordinary webcam source for Paper; macOS uses its existing automatic camera path. No camera/screen capture starts until the corresponding session/action requests it.

The retired `Start-Tassel-Avatar.cmd`, `Start-Tassel-Live-Voice.cmd`, `Start-Tassel-Webcam.cmd` and `Start-Tassel-Screenshare.cmd` have been removed. Legacy feature app modes in `scripts/team2.mjs` now direct callers to the shared entry point; isolated developer test commands remain.

## Saved configuration

The first normal launch records local paths in the primary Git checkout's `.local/start.json`. Git's common directory determines that location, so worktrees use the same settings. The file is ignored and contains infrastructure paths/settings, never provider API key values.

Defaults:

- Profile: `<primary-checkout>/.local/avatar-app-data` (saved avatar and local settings).
- Backend: the canonical one (below), `http://127.0.0.1:8787`, database `tassel`, bucket `tassel-frames`. A `.local/start.json` saved by an earlier launch keeps its values, so a machine whose file says `8864`, `tassel_t2_avatar_dev` and `tassel-t2-avatar-dev` keeps reaching that existing data.
- Provider settings: current/primary `services/server/.env`, with the existing `.local/live-test/services/server/.env` as a migration fallback. Its contents are neither copied nor printed.
- Local tooling: `<primary-checkout>/.local/tools`, with normal PATH support.

To use another existing installation, configure `userData`, `port`, `databaseUrl`, `s3Bucket`, `voiceEnvFile` or `toolsDir` in `.local/start.json`. Relative paths resolve from the primary checkout. Do not delete profiles or reset databases. Changing the profile or database intentionally changes which saved learner/session data is visible.

Normal launch uses live voice/provider configuration rather than silently forcing fake TTS or a feature demo. Missing credentials are reported by the existing provider validation. Agent/CI checks continue to use explicit fake-device/provider fixtures; they do not run live startup.

`Start-Tassel.cmd --check` (or `pnpm start --check`) prints the checkout, shared settings/profile paths, server, backend (`docker` or `host`), database name and capture configuration. It does not initialize providers, read key contents, migrate databases or open devices. Close the running app/server before starting a different branch against the same shared profile/backend; an occupied backend port fails clearly instead of attaching to potentially stale code.

## Same setup for every collaborator

Every launcher (`pnpm start`/`Start-Tassel.cmd`, `pnpm dev`, `pnpm live`) starts the same backend, in Docker, through `scripts/backend.mjs`: `docker compose up -d --wait --build db s3 server`. **Docker Desktop is required** (Windows: the WSL 2 backend).

- **In Docker:** `db` (Postgres 17 + pgvector), `s3` (Versity) and `server` (FastAPI + Pipecat from `services/server/Dockerfile`, one Linux image for arm64 and amd64), each on 127.0.0.1 only. The server's container creates and migrates its database at start and reloads on `services/server/src` edits.
- **On the host:** Electron, the Desk View helper, the camera and the microphone, and the tests (pytest, and the E2E server on 8799, via uv).
- **Canonical names:** port 8787, database `tassel`, bucket `tassel-frames`. `.local/start.json` (`port`, `databaseUrl`, `s3Bucket`) or `TASSEL_PORT`, `TASSEL_DATABASE_URL`, `TASSEL_S3_BUCKET` override them; the launcher maps the host port and rewrites the database host to the `db` service, so saved databases keep their data. Nothing deletes profiles, databases or volumes.
- **Provider keys:** the provider settings file above is mounted read-only into the container and read by the server; it's never copied into the image or put in the container's environment.
- **Escape hatch:** `--host-server` (or `TASSEL_HOST_SERVER=1`) runs the server with uv on the host, as before, with Postgres and S3 still in Docker.

## Sharing with Claude and other branches

The consolidated implementation lives on `codex/screenshare-overlay`, integrating `claude/live`, `codex/tutor-personality`, and the latest reviewed `claude/floating-tiles` work. The active app branches are integrated; historical foundation/P5 tips were reviewed against their later merged work. The independent marketing website branch is separate.

Other branches get the complete feature set by merging this branch through Git. They get the launcher contract by merging/cherry-picking the shared startup commit. Do not copy `.local/` or create another CMD for a branch. A launcher cannot enable code absent from a branch: merging only startup files into an older branch does not add screen/personality features.

This change does not force-push or rewrite any `claude/*` branch. Shared startup and feature integration are published on the Codex integration branch for other branches to consume.

## Verification

Startup tests cover worktree/shared profile behavior, correct current-checkout selection, platform capture availability, inherited fake/demo overrides and safe reporting. The actual Windows CMD is tested with `--check`. Feature integration is checked with desktop/server regressions and the synthetic Electron overlay flow; no paid provider or real capture device is opened by those checks.
