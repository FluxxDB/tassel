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
1. it starts Postgres and local S3 (`docker compose up -d --wait db s3`, on 127.0.0.1:54329 and 127.0.0.1:7070);
2. it migrates the dev database;
3. on macOS, it builds the Desk View helper (`node scripts/native.mjs build`), with a warning if Swift is missing;
4. it starts the server on http://127.0.0.1:8787;
5. once the server answers, it opens the app with the fake tutor.

Logs from both carry `[server]` and `[app]` prefixes. Ctrl+C stops both, and so does either one exiting.

## Paper view

A paper session shows her paper live on the session stage, and uploads a frame each time she finishes writing (a change detector in a worker, with OpenCV finding the page).

- **Where it comes from.** On macOS, the Desk View camera through a small helper (`native/deskview-helper`, which Electron starts). Plain `pnpm dev` and builds use the real source. If there's no Desk View camera, camera access is denied, or the helper is missing, the paper panel says so and offers what she can do; it never plays a demo instead.
- **The demo clip.** `TASSEL_PAPER_SOURCE=fake-clip pnpm dev` plays a generated clip of a DFA being drawn (`.cache/paper-clips`), with real capture refused. Add `TASSEL_PAPER_DEBUG=1` for the detector's numbers and its heatmap.
- **The real camera.** macOS ties the camera grant to the app that's responsible for the process. Started from a terminal, that's the terminal. `node scripts/camera.mjs` builds the app and the helper, starts the local stack if it isn't running, and launches Tassel through LaunchServices, so Electron's own camera grant applies. It passes only desktop settings (with `TASSEL_PAPER_SOURCE=auto` by default), excludes server credentials and the fake-capture guard, and exits when you quit Tassel. The app's output goes to `.cache/camera/app.log`.
- **Frames** are stored with their session in local S3 (bucket `tassel-frames`) until the session is deleted. A real camera frame is never committed: `pnpm check` refuses image and video files.

### Owner checklists (at the Mac)

**Camera spec.** With the camera free and Desk View set up: `TASSEL_E2E_CAMERA=1 pnpm --filter @tassel/desktop e2e:camera` (build first: `pnpm --filter @tassel/desktop build`). It launches through LaunchServices, starts a paper session, expects video at least 1280 wide with 30 frames in 3 s, deletes the session (and its frames), quits, and checks the helper is gone. It takes no screenshot. Afterwards, no new file under `apps/desktop/test-results/` should be an image.

**Live session.** `node scripts/camera.mjs`, then New session → Paper:
1. her paper shows live, and the title strip reads "Desk View · Live" beside a red dot;
2. writing, then pausing about 2 s, uploads a frame (with `TASSEL_PAPER_DEBUG=1`, the pill's "sent" count goes up);
3. the dock's Camera button shows "Camera is off" and the dot turns grey, and on again it's live;
4. minimize Tassel for 10 s, then restore it: still live;
5. End session: the camera light goes off within a couple of seconds.

**Unverified links.** With camera access turned off for Electron in System Settings, the denied card's "Open System Settings" should open Privacy & Security → Camera. On a Mac without a Desk View camera, "Open Desk View setup" should bring up the Desk View app. Note both results.

**Window capture.** `TASSEL_PAPER_SOURCE=window-capture node scripts/camera.mjs`: pick the Desk View window in the system picker; expect live video under "Your paper · Desk View window", an upload in the debug pill, and the dot grey after End.

## Test and check

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests for every package, then the server's tests (pytest, on the `tassel_test` database) |
| `pnpm e2e` | Builds the desktop app, then runs its Playwright E2E specs against a server on port 8799 and the `tassel_e2e` database. Screenshots land in `apps/desktop/test-results/screens/` |
| `pnpm check` | Biome, every typecheck, `check:i18n` (en, es and ko catalogs complete and consistent), `check:api` (the generated API client matches the server) and ruff |
| `pnpm gen:api` | Regenerates `packages/shared/src/api/openapi.json` and `schema.d.ts` from the server |

`pnpm test` and `pnpm e2e` need Postgres up, and `pnpm e2e` local S3 too: `docker compose up -d db s3`, or a running `pnpm dev`. E2E always plays the generated clip as a fake camera, and refuses any launch that could reach a real camera or screen (`tests/e2e/capture-guard.ts`). To run E2E next to another checkout's run, give each its own `TASSEL_E2E_PORT` and `TASSEL_E2E_DATABASE_URL`.

## Layout

| Path | What's there |
|---|---|
| `apps/desktop` | The Electron app: `src/main` (window, the `app://tassel` protocol, IPC, the device token store), `src/preload` (the `window.tassel` bridge) and `src/renderer` (React: the library, the new session sheet, the session screen, the fake tutor) |
| `services/server` | The FastAPI server: device auth, the sessions API, Postgres via SQLAlchemy and Alembic |
| `packages/shared` | Shared by both: design tokens and fonts, the en/es/ko catalogs, and the typed API client |
| `docs` | The design system, research, specs, plans and records |
| `native/deskview-helper` | The Desk View helper (Swift, macOS): the camera's frames over a local WebSocket |
| `packages/paper-synth` | Synthetic paper clips for tests and the demo |
| `scripts` | `dev.mjs`, `camera.mjs` (the real camera through LaunchServices), `native.mjs` (builds and tests the helper), `check-api.mjs` and `check-no-frames.mjs` |

## Settings

The desktop app reads these environment variables:

| Variable | Default | Use |
|---|---|---|
| `TASSEL_SERVER_URL` | `http://127.0.0.1:8787` | The server: https, or http on `127.0.0.1` or `localhost` (all the renderer's CSP allows) |
| `TASSEL_UI_LANG` | the system language, else `en` | `en`, `es` or `ko` |
| `TASSEL_TUTOR` | `fake` | `fake`, or `live` (P2) |
| `TASSEL_FAKE_SCRIPT` | `dfa-opening` | The fake tutor's script |
| `TASSEL_FAKE_SPEED` | `1` | How many times faster the script plays |
| `TASSEL_TOKEN_STORE` | `safe` (`file` under `pnpm dev` and E2E) | `file` keeps the device token as plaintext JSON, so unattended runs never prompt for the keychain |
| `TASSEL_USER_DATA` | Electron's default | Where the app keeps its data, such as the device token |
| `TASSEL_PAPER_SOURCE` | `auto` | `auto` (Desk View on macOS), `deskview-helper`, `window-capture`; in dev and E2E also `fake-clip` and `screen` |
| `TASSEL_PAPER_DEBUG` | off | `1` shows the detector's numbers and the heatmap toggle |
| `TASSEL_PAPER_PARAMS` | `{}` | JSON overrides of the change detector's values, for tuning |
| `TASSEL_FAKE_CLIP`, `TASSEL_HELPER_CLIP`, `TASSEL_DESKVIEW_HELPER`, `TASSEL_FAKE_DISPLAY`, `TASSEL_FAKE_CAMERA_ACCESS`, `TASSEL_REQUIRE_FAKE_CAPTURE`, `TASSEL_HELPER_TAG` | unset | Dev and test switches for paper; a packaged app ignores them |

The server reads `TASSEL_DATABASE_URL`, `TASSEL_HOST`, `TASSEL_PORT` and the object store's `TASSEL_OBJECT_STORE` and `TASSEL_S3_*`.

## Windows

Desk View is macOS only. On Windows the new session sheet disables "Paper · Desk View", says why, and starts from screen share instead. A dev run with `TASSEL_PAPER_SOURCE=fake-clip` enables Paper there, on the demo clip. Owner item, open until a Windows PC is available: `pnpm test`, then `pnpm e2e paper-fake-clip`, on Windows.
