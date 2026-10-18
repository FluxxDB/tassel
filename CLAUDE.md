# Tassel

## Shared app startup contract

- **One app launcher:** `Start-Tassel.cmd` on Windows, or `pnpm start` on any platform. Both use tracked `scripts/start.mjs` and launch the current checkout. Do not add feature-specific CMD files, check out another branch, or launch the ignored `.local/live-test` clone.
- Paper/webcam, screen overlay, voice, board, avatar, memory and personality belong in the same app and are selected through its UI. New features must not require a different launcher, profile, database, or fake-provider preset.
- Shared local paths live in the primary Git checkout's ignored `.local/start.json`, resolved through Git's common directory so worktrees share the saved profile and backend. Existing avatar profile and primary development data are preserved by default. Do not reset/copy device tokens or databases to solve startup issues.
- `Start-Tassel.cmd --check` / `pnpm start --check` are read-only preflight checks and do not open devices or call providers. Agent-run app tests still use the existing fake-device harness; never run normal live startup unattended.
- To share startup/features with another branch, merge the integration commits through Git. Never copy ignored local scripts or silently switch branches. Keep the launcher and this contract in shared commits. The launcher cannot supply code that a branch has not merged.


Tassel is a live AI tutor for the desktop: an Electron + React app (`apps/desktop`), a FastAPI server with Postgres (`services/server`), and a shared package (`packages/shared`). `PRODUCT.md` says what it is and who it serves; the design is `docs/superpowers/specs/2026-10-17-tassel-design.md`; the plans are in `docs/superpowers/plans/`.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Installs everything, downloads Electron 44.9.0, copies the fonts |
| `pnpm start` | Shared owner startup: current checkout, saved profile/backend, all features |
| `pnpm dev` | Postgres, migrations, the server on 8787, then the app (`scripts/dev.mjs`); Ctrl+C stops both |
| `pnpm test` | Every package's unit tests (Vitest), then the server's tests (pytest, database `tassel_test`) |
| `pnpm test:changed` | Only the tests the change needs: everything since the merge-base with the nearest origin branch, committed or not (`scripts/test-changed.mjs`). `--dry-run` prints the plan, `--no-e2e` or `--only unit,pytest` narrows it, `--base <ref>` and `--files a,b` pick the changes |
| `pnpm test:area <name...>` | Every unit, E2E and server test of the named areas; `--list` names them (`scripts/test-areas.mjs`) |
| `pnpm e2e` | Builds the desktop app and runs its Playwright E2E specs (server on 8799, database `tassel_e2e`, frames in local S3), on the fake clip |
| `node scripts/camera.mjs` | Tassel on the real Desk View camera through LaunchServices (owner at the Mac only) |
| `pnpm check` | Biome, typechecks, `check:i18n`, `check:api` and ruff |
| `pnpm gen:api` | Regenerates the API schema and client types after a server API change |
| `pnpm --filter @tassel/desktop test <pattern>` | Desktop unit tests matching a pattern |
| `pnpm --filter @tassel/desktop e2e <pattern>` | E2E specs matching a pattern (build the app first) |

`pnpm test` and `pnpm e2e` need Postgres, and E2E local S3: `docker compose up -d db s3`. Checkouts that run tests side by side each set their own `TASSEL_E2E_PORT`, `TASSEL_E2E_DATABASE_URL` and `TASSEL_TEST_DATABASE_URL`; the test setups create and migrate those databases. Run every command to completion: no watch modes, and no dev server or app window left running when you're done.

## Which tests to run

The full suites are slow (E2E alone takes 4–7 minutes), so don't run all of them after every change:

- **While iterating:** `pnpm check` and `pnpm test:changed`. It maps each changed file to its areas (shell, library, session, board, paper, vision, voice, avatar, api, domains, tooling) and runs the unit tests that import the file (`vitest related`), the E2E specs of those screens (building the app first only when E2E runs) and the server tests of the touched server areas. Shared files widen it: i18n catalogs and design tokens add the shell, library and session specs; migrations, server settings and `conftest.py` run the whole server suite; E2E fixtures run every spec; dependency changes run everything. `--dry-run` first if unsure.
- **After merging someone else's branch:** `pnpm test` (unit and server) and `pnpm check`.
- **Once per batch, right before pushing:** the full `pnpm e2e`, in the background.

A new test or source file goes in an area in `scripts/test-areas.mjs`; `scripts/test-select.test.mjs` (part of `pnpm test`) fails and names the file until it has one.

## Layout

- `apps/desktop/src/main`: the main process (window, the `app://tassel` protocol, IPC, the device token store).
- `apps/desktop/src/preload`: the `window.tassel` bridge, the renderer's only way in.
- `apps/desktop/src/renderer/src`: React. `features/library`, `features/new-session`, `features/session` (the session screen and its stage store), `tutor` (the `TutorClient` contract and the scripted fake tutor), `components`.
- `apps/desktop/tests/unit` (Vitest, jsdom) and `apps/desktop/tests/e2e` (Playwright `_electron`; `fixtures.ts` has `launchApp`, `snap`, `settle`, `setWindowSize`).
- `services/server`: `src/tassel` (the FastAPI app: `api/` routes, `storage/` tables and repository), `alembic/` migrations, `tests/`.
- `packages/shared/src`: `styles` (tokens, fonts, base CSS), `i18n` (en, es, ko catalogs), `api` (the typed client).

## Conventions

- **Test first.** Write the failing test and watch it fail, then make it pass. A bug gets a regression test that fails before the fix.
- **Exercise every feature in the running app**, not only in unit tests: drive it with a Playwright `_electron` spec and look at the screenshots. `snap(page, name)` writes `apps/desktop/test-results/screens/<name>.png`; Playwright clears `test-results/` at the start of each run.
- **Every UI string** goes through the catalogs in `packages/shared/src/i18n`, in en, es and ko. `pnpm check:i18n` fails on a missing key or mismatched ICU placeholders.
- **Design:** the Hume tokens (`docs/design-system/DESIGN.md`) live in `packages/shared/src/styles/tokens.css` as Tailwind v4 `@theme`, with the deviations in the spec's §6. Hairline borders only, no drop shadows. Geist and Geist Mono; Pretendard renders Hangul only. Sans tracking −0.025em; mono lab labels uppercase at +0.025em; Korean untracked at 1.6 leading. Functional text never below 11 px.
- **Commits:** conventional messages, ending with the co-author trailer the session gives you.

## Paper and the camera (P3)

- No agent-run test or tool opens the real camera, microphone or screen. E2E goes through `launchApp`, which pins the fake clip, sets `TASSEL_REQUIRE_FAKE_CAPTURE=1` (fake camera and microphone devices for every source) and runs the capture guard.
- Plain `pnpm dev` uses the real Desk View camera (R39). Agents run it only as `TASSEL_PAPER_SOURCE=fake-clip pnpm dev` (the demo clip, real capture refused), and never set `TASSEL_PAPER_SOURCE` to `auto`, `deskview-helper`, `window-capture` or `screen` without a clip or `TASSEL_FAKE_DISPLAY=self`.
- `TASSEL_HELPER_CLIP` tests the Desk View helper without the camera.
- Camera checks run only through `node scripts/camera.mjs` or `e2e:camera`, with the owner at the Mac.
- Never commit, post or screenshot a real camera frame; `pnpm check` enforces the file part. Agents never answer TCC prompts.

## Constraints in brief

- **Platforms:** macOS first, Windows too. Scripts are Node with `cross-spawn`, never bash-only.
- **Electron** stays at exactly 44.9.0 (macOS ties camera and microphone grants to that build), with `contextIsolation` and `sandbox` on and no `nodeIntegration`; the preload bridge is the only IPC surface.
- **Secrets:** the desktop app holds no provider API keys, only a device token (Electron `safeStorage`, or plaintext JSON when `TASSEL_TOKEN_STORE=file` in dev and E2E). Never read or print `.env` files or tokens.
- **Origins:** the renderer is `app://tassel` in builds and `http://localhost:5173` in dev; the server's CORS allows exactly those two.
- **Sessions:** type `homework|studying|research|other`, language `en|es|ko`, source `paper|screen|talk`; a null title shows "Untitled Session"; library sorts `recent|created|topic`.
- **Windows** has no Desk View: shared startup exposes ordinary webcam Paper and defaults new sessions to screen share.
