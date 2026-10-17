# Tassel

Tassel is a live AI tutor for the desktop: an Electron + React app (`apps/desktop`), a FastAPI server with Postgres (`services/server`), and a shared package (`packages/shared`). `PRODUCT.md` says what it is and who it serves; the design is `docs/superpowers/specs/2026-10-17-tassel-design.md`; the plans are in `docs/superpowers/plans/`.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Installs everything, downloads Electron 44.9.0, copies the fonts |
| `pnpm dev` | Postgres, migrations, the server on 8787, then the app (`scripts/dev.mjs`); Ctrl+C stops both |
| `pnpm test` | Every package's unit tests (Vitest), then the server's tests (pytest, database `tassel_test`) |
| `pnpm e2e` | Builds the desktop app and runs its Playwright E2E specs (server on 8799, database `tassel_e2e`) |
| `pnpm check` | Biome, typechecks, `check:i18n`, `check:api` and ruff |
| `pnpm gen:api` | Regenerates the API schema and client types after a server API change |
| `pnpm --filter @tassel/desktop test <pattern>` | Desktop unit tests matching a pattern |
| `pnpm --filter @tassel/desktop e2e <pattern>` | E2E specs matching a pattern (build the app first) |

`pnpm test` and `pnpm e2e` need Postgres: `docker compose up -d db`. Checkouts that run tests side by side each set their own `TASSEL_E2E_PORT`, `TASSEL_E2E_DATABASE_URL` and `TASSEL_TEST_DATABASE_URL`; the test setups create and migrate those databases. Run every command to completion: no watch modes, and no dev server or app window left running when you're done.

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

## Constraints in brief

- **Platforms:** macOS first, Windows too. Scripts are Node with `cross-spawn`, never bash-only.
- **Electron** stays at exactly 44.9.0 (macOS ties camera and microphone grants to that build), with `contextIsolation` and `sandbox` on and no `nodeIntegration`; the preload bridge is the only IPC surface.
- **Secrets:** the desktop app holds no provider API keys, only a device token (Electron `safeStorage`, or plaintext JSON when `TASSEL_TOKEN_STORE=file` in dev and E2E). Never read or print `.env` files or tokens.
- **Origins:** the renderer is `app://tassel` in builds and `http://localhost:5173` in dev; the server's CORS allows exactly those two.
- **Sessions:** type `homework|studying|research|other`, language `en|es|ko`, source `paper|screen|talk`; a null title shows "Untitled Session"; library sorts `recent|created|topic`.
- **Windows** has no Desk View: the new session sheet disables paper there and starts from screen share.
