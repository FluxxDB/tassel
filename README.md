# Tassel

A live AI tutor for the desktop. Tassel watches the student's paper (macOS Desk View) or screen, talks with her in real time, and explains by drawing on a shared board and over her own work, in English, Spanish and Korean. See `PRODUCT.md` for the product and `docs/superpowers/specs/2026-10-17-tassel-design.md` for the design.

This is the P1 foundation: the session library, the new session sheet, the session screen ("one stage") and a scripted fake tutor. The live voice loop arrives in P2.

## What you need

macOS (the primary target) or Windows, with:

- **Node 22.18 or later.** `.node-version` names 22.
- **pnpm 12.** The `packageManager` field pins 12.6.0; `corepack enable` gives you that version.
- **[uv](https://docs.astral.sh/uv/)**, which installs Python 3.12 for the server on first use.
- **Docker Desktop**, for Postgres 17 with pgvector. On Windows, use the WSL 2 backend.

## Set up

```sh
pnpm install
```

`pnpm install` also downloads Electron 44.9.0 into `apps/desktop/node_modules/electron/dist` and copies the fonts into `packages/shared`. Electron stays pinned to exactly 44.9.0: macOS ties its camera and microphone grants to that build.

## Run it

```sh
pnpm dev
```

`pnpm dev` (`scripts/dev.mjs`) runs, in order:
1. it starts Postgres (`docker compose up -d --wait db`, on 127.0.0.1:54329);
2. it migrates the dev database;
3. it starts the server on http://127.0.0.1:8787;
4. once the server answers, it opens the app with the fake tutor.

Logs from both carry `[server]` and `[app]` prefixes. Ctrl+C stops both, and so does either one exiting.

## Test and check

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests for every package, then the server's tests (pytest, on the `tassel_test` database) |
| `pnpm e2e` | Builds the desktop app, then runs its Playwright E2E specs against a server on port 8799 and the `tassel_e2e` database. Screenshots land in `apps/desktop/test-results/screens/` |
| `pnpm check` | Biome, every typecheck, `check:i18n` (en, es and ko catalogs complete and consistent), `check:api` (the generated API client matches the server) and ruff |
| `pnpm gen:api` | Regenerates `packages/shared/src/api/openapi.json` and `schema.d.ts` from the server |

`pnpm test` and `pnpm e2e` need Postgres up: `docker compose up -d db`, or a running `pnpm dev`. To run E2E next to another checkout's run, give each its own `TASSEL_E2E_PORT` and `TASSEL_E2E_DATABASE_URL`.

## Layout

| Path | What's there |
|---|---|
| `apps/desktop` | The Electron app: `src/main` (window, the `app://tassel` protocol, IPC, the device token store), `src/preload` (the `window.tassel` bridge) and `src/renderer` (React: the library, the new session sheet, the session screen, the fake tutor) |
| `services/server` | The FastAPI server: device auth, the sessions API, Postgres via SQLAlchemy and Alembic |
| `packages/shared` | Shared by both: design tokens and fonts, the en/es/ko catalogs, and the typed API client |
| `docs` | The design system, research, specs, plans and records |
| `scripts` | `dev.mjs` and `check-api.mjs` |

## Settings

The desktop app reads these environment variables:

| Variable | Default | Use |
|---|---|---|
| `TASSEL_SERVER_URL` | `http://127.0.0.1:8787` | The server |
| `TASSEL_UI_LANG` | the system language, else `en` | `en`, `es` or `ko` |
| `TASSEL_TUTOR` | `fake` | `fake`, or `live` (P2) |
| `TASSEL_FAKE_SCRIPT` | `dfa-opening` | The fake tutor's script |
| `TASSEL_FAKE_SPEED` | `1` | How many times faster the script plays |
| `TASSEL_TOKEN_STORE` | `safe` (`file` under `pnpm dev` and E2E) | `file` keeps the device token as plaintext JSON, so unattended runs never prompt for the keychain |
| `TASSEL_USER_DATA` | Electron's default | Where the app keeps its data, such as the device token |

The server reads `TASSEL_DATABASE_URL`, `TASSEL_HOST` and `TASSEL_PORT`.

## Windows

Desk View is macOS only. On Windows the new session sheet disables "Paper · Desk View", says why, and starts from screen share instead.
