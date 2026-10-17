# P1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clickable Tassel desktop app on fakes:
- a library of sessions, a new-session sheet, and the chosen "One stage" session screen;
- a scripted fake tutor driving captions, tutor state and the stage mode;
- a sessions server with a typed API;
- an end-to-end harness that drives the real app and captures screenshots.

**Architecture:**
- **Workspace:** a pnpm monorepo (`apps/desktop`, `packages/shared`) plus a uv-managed Python service (`services/server`).
- **Desktop app:** Electron 44 + React 19 + TypeScript, built with electron-vite, with Tailwind v4 consuming the shared design tokens.
- **Server:** FastAPI + SQLAlchemy 2 (psycopg 3) on Postgres 17 with pgvector (Docker Compose locally).
- **API contract:** the server's OpenAPI schema generates TypeScript types for an `openapi-fetch` client.
- **Tutor:** the renderer talks to a `TutorClient` interface. P1 ships `FakeTutorClient`, and P2 adds the live one.

**Tech Stack:**
- **Desktop:** Electron 44.x, electron-vite, React 19, TypeScript 5 (strict), Tailwind CSS v4, Radix UI primitives, Zustand 5, i18next + react-i18next + i18next-icu.
- **Tooling:** Vitest + Testing Library, Playwright (`_electron`), Biome.
- **Server:** Python 3.12, uv, FastAPI, Pydantic v2, pydantic-settings, SQLAlchemy 2 (async, psycopg 3), Alembic, pytest + pytest-asyncio + httpx, Ruff.
- **Database:** Docker `pgvector/pgvector:pg17`.

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md` (with `PRODUCT.md` and the chosen layout mockup `.impeccable/mocks/decision/stage.html`).

## Global Constraints

**Platform and tooling**
- Node ≥ 22 for tooling, pnpm 12 (`packageManager` field), Python 3.12 (`requires-python = ">=3.12,<3.13"`).
- Every script runs on macOS **and Windows**: no bash-only steps; Node scripts use `cross-spawn`.
- pnpm must be allowed to run dependency build scripts for `electron` and `esbuild`; otherwise Electron's binary never downloads. Verify that `apps/desktop/node_modules/electron/dist` exists after install.

**Electron**
- Electron pinned to **exactly `44.9.0`**. The npm build is ad-hoc signed, so macOS ties camera, microphone and screen grants to its exact binary hash. The owner granted them to 44.9.0, and changing the version re-prompts.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The typed preload bridge (`window.tassel`) is the only IPC surface.
- The production renderer origin is `app://tassel` (a custom protocol). The dev origin is `http://localhost:5173`. The server's CORS allows exactly these two by default.

**Security and storage**
- No provider API keys anywhere in the desktop app. The app holds only a device token.
- The token lives in Electron `safeStorage`. When `TASSEL_TOKEN_STORE=file` (dev scripts and E2E), it is stored as plaintext JSON in userData, so unattended runs never trigger macOS keychain prompts.

**Design tokens** (in `packages/shared/src/styles/tokens.css`, consumed by Tailwind v4 `@theme`)

| Group | Tokens |
|---|---|
| Base | ink `#222222`, paper `#ffffff`, bone `#fff9f3`, slate-plum `#574853` |
| Smoke | smoke `#7a7876` (large text and non-text only), smoke-text `#6b6966` |
| Iris | iris `#c094e4`, iris-ink `#7d4fc4` |
| Pastels | blush `#fce0ee`, rose-mist `#fdebf7`, meringue `#ffe9cf`, mint `#daf7ee`, seafoam `#cef1e1`, sky `#ccdff1` |
| State | live `#e5484d` |
| Radii | pill `9999px`, card `16px`, card-sm `12px`, input `8px`, hero `24px` |

**Styling rules**
- No drop shadows (hairline `box-shadow: 0 0 0 1px` borders only).
- Geist / Geist Mono and Pretendard Variable. Pretendard is limited to `unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7FF, U+3000-303F`.
- Sans tracking is `-0.025em`. Mono labels are uppercase, `+0.025em`, with `font-feature-settings: "calt" 0, "liga" 0`.
- `:lang(ko) { letter-spacing: 0; line-height: 1.6 }`.
- Functional text is never below 11px.

**Text**
- Every UI string goes through i18next keys present in `en`, `es` and `ko`. `pnpm check:i18n` fails on any missing key or mismatched ICU placeholder.
- Fixed copy (exact):

| Key | en | es | ko |
|---|---|---|---|
| `session.untitled` | "Untitled Session" | "Sesión sin título" | "제목 없는 세션" |
| `platform.windowsNoDeskView` | "Desk View isn't available on Windows. Share your screen instead." | "Desk View no está disponible en Windows. Comparte tu pantalla en su lugar." | "Windows에서는 Desk View를 사용할 수 없어요. 대신 화면을 공유해 주세요." |

**Session model**
- type ∈ `homework|studying|research|other`; language ∈ `en|es|ko`; source ∈ `paper|screen|talk`.
- `title` is `null` until set; the UI shows `session.untitled`. `title_source` ∈ `ai|student|null`.
- Library sorts:
  - `recent`: `last_activity_at` desc.
  - `created`: `created_at` desc.
  - `topic`: subject A→Z with nulls last, then `last_activity_at` desc.

**Ports and environment**
- Server port: 8787 for dev, 8799 for E2E. The E2E database is `tassel_test`.
- Environment variables: `TASSEL_SERVER_URL`, `TASSEL_UI_LANG`, `TASSEL_TUTOR` (`fake|live`), `TASSEL_FAKE_SCRIPT`, `TASSEL_FAKE_SPEED`, `TASSEL_TOKEN_STORE`, `TASSEL_USER_DATA`.

**Git**
- Commits go on branch `claude/p1-foundation` and end with the attribution trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Long Spanish and Korean strings:** session titles, chips and card text must truncate or clamp, never overflow or overlap. Tested in Task 11 (card clamp) and Task 13 (title strip ellipsis, in `es` and `ko`).
2. **Server down at launch:** the library shows a recoverable error with Retry, not a blank window, and recovers when the server comes up. Tested in Task 11 (component and E2E).
3. **Stale device token** (DB reset in dev): the client re-registers once on a 401 and carries on, without looping. Tested in Task 7 (client) and Task 9 (store refresh).
4. **Small windows** (1024×680): the dock, captions and Ada tile never overlap, and the split stage stays usable. Tested in Task 13 (E2E bounding boxes).
5. **Windows platform:** "Paper · Desk View" is disabled with the localized notice, and the source defaults to screen share. Tested in Task 12.

---

### Task 1: Workspace and shared design tokens

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, `.editorconfig`, `.node-version` (`22`)
- Create: `packages/shared/package.json` (name `@tassel/shared`; exports `./tokens.css`, `./fonts.css`, `./base.css`, `./fonts/*`, `./i18n`, `./api`)
- Create: `packages/shared/src/styles/tokens.css` (a Tailwind v4 `@theme { … }` block with every token from Global Constraints, plus `--font-sans: "Geist", "Pretendard Variable", ui-sans-serif, system-ui, sans-serif` and `--font-mono: "Geist Mono", "Pretendard Variable", ui-monospace, monospace`)
- Create: `packages/shared/src/styles/fonts.css` (`@font-face` for Geist, Geist Mono and Pretendard Variable, from `./fonts/*.woff2`, `font-display: swap`, `font-weight: 100 900` and `45 920`)
- Create: `packages/shared/src/styles/base.css` (body defaults, `.mono` lab-label class, `:lang(ko)` rules)
- Create: `packages/shared/scripts/copy-fonts.mjs` (postinstall: copies `geist/dist/fonts/geist-sans/Geist-Variable.woff2`, `geist/dist/fonts/geist-mono/GeistMono-Variable.woff2` and `pretendard/dist/web/variable/woff2/PretendardVariable.woff2` into `packages/shared/src/fonts/`). Verify the exact source paths in the installed packages and adjust; the destination names are fixed.
- Test: `packages/shared/tests/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--color-ink`, `--color-paper`, `--color-bone`, `--color-smoke`, `--color-smoke-text`, `--color-iris`, `--color-iris-ink`, `--color-blush`, `--color-rose-mist`, `--color-meringue`, `--color-mint`, `--color-seafoam`, `--color-sky`, `--color-slate-plum`, `--color-live`, `--radius-pill`, `--radius-card`, `--radius-card-sm`, `--radius-input`, `--radius-hero`, `--font-sans` and `--font-mono`. In Tailwind these become utilities: `bg-ink`, `text-smoke-text`, `rounded-pill`, `font-mono`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/tokens.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', 'src');
const tokens = readFileSync(join(root, 'styles/tokens.css'), 'utf8');
const fonts = readFileSync(join(root, 'styles/fonts.css'), 'utf8');
const base = readFileSync(join(root, 'styles/base.css'), 'utf8');

describe('design tokens', () => {
  it.each([
    ['--color-ink', '#222222'], ['--color-bone', '#fff9f3'], ['--color-iris', '#c094e4'],
    ['--color-iris-ink', '#7d4fc4'], ['--color-smoke-text', '#6b6966'], ['--color-live', '#e5484d'],
    ['--color-sky', '#ccdff1'], ['--radius-pill', '9999px'], ['--radius-card', '16px'],
  ])('defines %s as %s', (name, value) => {
    expect(tokens).toContain(`${name}: ${value};`);
  });
  it('puts Geist first and Pretendard second in the sans stack', () => {
    expect(tokens).toMatch(/--font-sans:\s*"Geist",\s*"Pretendard Variable"/);
  });
  it('limits Pretendard to Hangul ranges', () => {
    expect(fonts).toContain('unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7FF, U+3000-303F;');
  });
  it('resets tracking for Korean', () => {
    expect(base).toMatch(/:lang\(ko\)\s*\{[^}]*letter-spacing:\s*0;[^}]*line-height:\s*1\.6;/);
  });
  it.each(['Geist-Variable.woff2', 'GeistMono-Variable.woff2', 'PretendardVariable.woff2'])('ships %s', (f) => {
    expect(existsSync(join(root, 'fonts', f))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `pnpm install && pnpm --filter @tassel/shared test`. Expected: FAIL (files missing).
- [ ] **Step 3: Implement the files above.**
  - In the root `package.json`, set `"packageManager": "pnpm@12.6.0"`, `"engines": {"node": ">=22"}` and scripts `test`, `check`, `e2e`, `dev`, `gen:api`, `check:api` and `check:i18n` (filled in by later tasks; start with `test` = `pnpm -r test`).
  - `pnpm-workspace.yaml` lists `apps/*` and `packages/*`, and allows build scripts for `electron` and `esbuild`.
  - `@tassel/shared` depends on `geist` and `pretendard`; its `postinstall` runs `copy-fonts.mjs`. Commit the copied fonts: they are OFL, and committing them avoids postinstall surprises on Windows.
- [ ] **Step 4: Run it and confirm it passes.** Run: `pnpm --filter @tassel/shared test`. Expected: PASS (13 tests).
- [ ] **Step 5: Commit.** `git add -A package.json pnpm-workspace.yaml pnpm-lock.yaml biome.json tsconfig.base.json .editorconfig .node-version packages/shared && git commit -m "feat(shared): workspace and design tokens"`

### Task 2: i18n catalogs and completeness check

**Files:**
- Create: `packages/shared/src/i18n/en.json`, `es.json`, `ko.json`, `index.ts`
- Create: `packages/shared/scripts/check-i18n.ts` (CLI; exits 1 with a list when problems exist; root script `check:i18n`)
- Test: `packages/shared/tests/i18n.test.ts`

**Interfaces:**
- Produces:
  - `export const SUPPORTED_LANGS = ['en', 'es', 'ko'] as const;`
  - `export type Lang = (typeof SUPPORTED_LANGS)[number];`
  - `export const resources: Record<Lang, { translation: Record<string, unknown> }>;`
  - `export function checkCatalogs(catalogs: Record<Lang, object>): string[]`, which returns problems such as `"es: missing library.empty.title"` and `"ko: placeholder mismatch session.timer ({elapsed})"`.
- Key namespaces: `app.*`, `common.*` (`retry`, `cancel`, `start`, `back`), `library.*` (`title`, `newSession`, `search`, `sort.recent|created|topic`, `noTopic`, `empty.title|body`, `error.title|body`), `newSession.*` (`title`, `type.homework|studying|research|other`, `language.*`, `source.paper|screen|talk`, `start`), `session.*` (`untitled`, `timer`, `liveSource.paper|screen|talk`, `tutorState.connecting|listening|thinking|speaking|watching`, `stage.paper|board|split`, `dock.mic|micOff|camera|share|board|captions|end`, `end.confirm|cancel|title`), `platform.windowsNoDeskView`, `errors.*`. The fixed copy is in Global Constraints. Write the rest naturally in all three languages; Korean uses polite 해요체.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/i18n.test.ts
import { describe, expect, it } from 'vitest';
import { checkCatalogs, resources } from '../src/i18n';

describe('i18n catalogs', () => {
  it('are complete and consistent', () => {
    expect(checkCatalogs({ en: resources.en.translation, es: resources.es.translation, ko: resources.ko.translation })).toEqual([]);
  });
  it('reports a missing key in one language', () => {
    const en = { library: { empty: { title: 'Nothing yet' } } };
    expect(checkCatalogs({ en, es: { library: { empty: {} } }, ko: en })).toEqual(['es: missing library.empty.title']);
  });
  it('reports mismatched ICU placeholders', () => {
    const en = { session: { timer: 'Elapsed {elapsed}' } };
    expect(checkCatalogs({ en, es: { session: { timer: 'Tiempo {tiempo}' } }, ko: en }))
      .toEqual(['es: placeholder mismatch session.timer ({elapsed})']);
  });
  it('has the fixed copy', () => {
    expect(resources.ko.translation).toMatchObject({ session: { untitled: '제목 없는 세션' } });
    expect(resources.es.translation).toMatchObject({ platform: { windowsNoDeskView: 'Desk View no está disponible en Windows. Comparte tu pantalla en su lugar.' } });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `pnpm --filter @tassel/shared test i18n`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `checkCatalogs`.** Walk the nested keys of `en` as the reference, report keys missing in each other language, and compare the sets of `{placeholder}` names per key. Add the catalogs.
- [ ] **Step 4: Run it and confirm it passes.** Run: `pnpm --filter @tassel/shared test && pnpm check:i18n`. Expected: PASS, then exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat(shared): en/es/ko catalogs with completeness check"`

### Task 3: Server skeleton

**Files:**
- Create: `services/server/pyproject.toml`:
  - project `tassel-server`, `requires-python = ">=3.12,<3.13"`;
  - dependencies `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `pydantic-settings`, `sqlalchemy>=2`, `psycopg[binary]>=3`, `alembic`;
  - dev group `pytest`, `pytest-asyncio`, `httpx`, `ruff`;
  - script `tassel-server = "tassel.__main__:main"`;
  - ruff line length 100.
- Create: `services/server/src/tassel/__init__.py` (`__version__ = "0.1.0"`), `config.py`, `app.py`, `api/__init__.py`, `api/health.py`, `__main__.py`
- Test: `services/server/tests/test_health.py`

**Interfaces:**
- Produces: `class Settings(BaseSettings)` with:
  - env prefix `TASSEL_`;
  - `database_url: str = "postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel"`;
  - `host: str = "127.0.0.1"`, `port: int = 8787`;
  - `cors_origins: list[str] = ["http://localhost:5173", "app://tassel"]`;
  - `providers: Literal["fake", "live"] = "fake"`.

  Also `def create_app(settings: Settings | None = None) -> FastAPI`, and `GET /v1/health` → `{"status": "ok", "version": "0.1.0"}` (no auth).

- [ ] **Step 1: Write the failing test**

```python
# services/server/tests/test_health.py
import httpx
import pytest
from tassel.app import create_app

@pytest.mark.asyncio
async def test_health_returns_ok_and_version():
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": "0.1.0"}

@pytest.mark.asyncio
async def test_cors_allows_app_origin():
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.options("/v1/health", headers={"Origin": "app://tassel", "Access-Control-Request-Method": "GET"})
    assert r.headers["access-control-allow-origin"] == "app://tassel"
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `cd services/server && uv sync && uv run pytest tests/test_health.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement.** `create_app` adds `CORSMiddleware(allow_origins=settings.cors_origins, allow_headers=["Authorization", "Content-Type"], allow_methods=["*"])`. `__main__.main()` runs `uvicorn.run(create_app(), host, port)`.
- [ ] **Step 4: Run it and confirm it passes.** Run: `uv run pytest -v && uv run ruff check`. Expected: PASS, then clean.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(server): FastAPI skeleton with health endpoint"`

### Task 4: Database, tables and migrations

**Files:**
- Create: `docker-compose.yml` (service `db`: image `pgvector/pgvector:pg17`, port `54329:5432`, user, password and db all `tassel`, named volume)
- Create: `services/server/src/tassel/storage/__init__.py`, `storage/db.py`, `storage/tables.py`
- Create: `services/server/alembic.ini`, `services/server/alembic/env.py`, `services/server/alembic/versions/0001_initial.py`
- Create: `services/server/tests/conftest.py`
- Test: `services/server/tests/test_tables.py`

**Interfaces:**
- Produces:
  - `def make_engine(url: str) -> AsyncEngine`
  - `def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]`
  - FastAPI dependency `async def get_db(request: Request) -> AsyncIterator[AsyncSession]` (the engine lives on `app.state`)
- Tables (SQLAlchemy 2 declarative, UUID primary keys from `uuid4`, timestamps `timestamptz` defaulting to `now()`):

| Table | Columns |
|---|---|
| `learners` | `id`, `created_at`, `ui_language` (`varchar(2)`, default `'en'`) |
| `devices` | `id`, `learner_id` FK → learners (ON DELETE CASCADE), `token_hash char(64) unique`, `created_at`, `last_seen_at` |
| `sessions` | `id`, `learner_id` FK, `title text null`, `title_source text null` (check `in ('ai','student')`), `subject text null`, `type text` (check), `language text` (check), `source text` (check), `created_at`, `last_activity_at` (default = `created_at`) |

- Indexes on `sessions(learner_id, last_activity_at desc)`, `(learner_id, created_at desc)` and `(learner_id, subject)`.
- Migration `0001` also runs `CREATE EXTENSION IF NOT EXISTS vector`.
- Test fixtures (`conftest.py`):
  - `db_url`: creates database `tassel_test` if missing (connecting to `tassel`), runs `alembic upgrade head` once per test session, and truncates all tables before each test.
  - `client`: an `httpx.AsyncClient` over `create_app(Settings(database_url=<test url>))`.
  - Both honor `TASSEL_TEST_DATABASE_URL`.

- [ ] **Step 1: Write the failing test**

```python
# services/server/tests/test_tables.py
import pytest
from sqlalchemy import select, text
from tassel.storage.tables import Device, Learner, TutoringSession

@pytest.mark.asyncio
async def test_roundtrip_learner_device_session(db):
    learner = Learner()
    db.add(learner); await db.flush()
    db.add(Device(learner_id=learner.id, token_hash="a" * 64))
    s = TutoringSession(learner_id=learner.id, type="homework", language="en", source="paper")
    db.add(s); await db.commit(); await db.refresh(s)
    assert s.title is None and s.title_source is None and s.subject is None
    assert s.last_activity_at == s.created_at

@pytest.mark.asyncio
async def test_rejects_unknown_language(db):
    learner = Learner(); db.add(learner); await db.flush()
    db.add(TutoringSession(learner_id=learner.id, type="homework", language="fr", source="paper"))
    with pytest.raises(Exception):
        await db.commit()

@pytest.mark.asyncio
async def test_vector_extension_installed(db):
    assert (await db.execute(text("select extname from pg_extension where extname='vector'"))).scalar() == "vector"
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `docker compose up -d db && cd services/server && uv run pytest tests/test_tables.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement tables, the migration and fixtures.** Provide a `db` fixture that yields an `AsyncSession` bound to the test database.
- [ ] **Step 4: Run it and confirm it passes.** Run: `uv run pytest -v`. Expected: PASS (5 tests).
- [ ] **Step 5: Commit.** `git add docker-compose.yml services/server && git commit -m "feat(server): postgres schema with sessions, devices, learners"`

### Task 5: Device registration and auth

**Files:**
- Create: `services/server/src/tassel/auth.py`, `services/server/src/tassel/api/devices.py`
- Test: `services/server/tests/test_devices.py`

**Interfaces:**
- Produces:
  - `POST /v1/devices` → `201 {"device_id": UUID, "token": str}`. It creates a `Learner` and a `Device`. The token is `secrets.token_urlsafe(32)`; only the SHA-256 hex is stored.
  - Dependency `async def current_learner(authorization: str | None = Header(None), db = Depends(get_db)) -> Learner`. It raises 401 with `WWW-Authenticate: Bearer` on a missing, malformed or unknown token, and updates `devices.last_seen_at`.
  - `GET /v1/me` → `{"learner_id": UUID, "ui_language": "en"}` (uses `current_learner`; it exists so tests and the app can verify a token).

- [ ] **Step 1: Write the failing test**

```python
# services/server/tests/test_devices.py
import hashlib
import pytest
from sqlalchemy import select
from tassel.storage.tables import Device

@pytest.mark.asyncio
async def test_register_returns_token_and_stores_only_hash(client, db):
    r = await client.post("/v1/devices")
    assert r.status_code == 201
    token = r.json()["token"]
    assert len(token) >= 40
    stored = (await db.execute(select(Device.token_hash))).scalar_one()
    assert stored == hashlib.sha256(token.encode()).hexdigest() and token not in stored

@pytest.mark.asyncio
@pytest.mark.parametrize("header", [None, "Bearer nope", "Basic abc"])
async def test_me_rejects_bad_auth(client, header):
    r = await client.get("/v1/me", headers={"Authorization": header} if header else {})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"

@pytest.mark.asyncio
async def test_me_resolves_learner(client):
    token = (await client.post("/v1/devices")).json()["token"]
    r = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["ui_language"] == "en"
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `uv run pytest tests/test_devices.py -v`. Expected: FAIL (404).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and confirm it passes.** Run: `uv run pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(server): device registration and bearer auth"`

### Task 6: Sessions API

**Files:**
- Create: `services/server/src/tassel/models.py`, `services/server/src/tassel/storage/sessions_repo.py`, `services/server/src/tassel/api/sessions.py`
- Test: `services/server/tests/test_sessions.py`

**Interfaces:**
- Produces (Pydantic):
  - `SessionType = Literal["homework","studying","research","other"]`
  - `Lang = Literal["en","es","ko"]`
  - `Source = Literal["paper","screen","talk"]`
  - `SessionCreate(type, language, source)`
  - `SessionPatch(title: str | None = Field(None, min_length=1, max_length=80), subject: str | None = Field(None, max_length=40), type, language)` (all optional; strings stripped)
  - `SessionOut(id: UUID, title: str | None, title_source: Literal["ai","student"] | None, subject: str | None, type, language, source, created_at: datetime, last_activity_at: datetime)`
  - `SessionList(items: list[SessionOut])`
- Routes (all require `current_learner`):

| Route | Behavior |
|---|---|
| `POST /v1/sessions` | 201 `SessionOut` |
| `GET /v1/sessions?sort=recent\|created\|topic&q=` | `SessionList`; `q` matches title or subject case-insensitively |
| `GET /v1/sessions/{id}` | 200, or 404 if missing or another learner's |
| `PATCH /v1/sessions/{id}` | Setting `title` sets `title_source="student"`; any patch bumps `last_activity_at` |
| `DELETE /v1/sessions/{id}` | 204 |

- Repo functions: `create`, `list_for`, `get_for`, `patch_for`, `delete_for`. Each takes `(db, learner_id, …)`.

- [ ] **Step 1: Write the failing tests** (in `test_sessions.py`, using a helper `auth(client) -> dict` that registers a device and returns headers):
  - `test_create_session_starts_untitled`: title, title_source and subject are None; created_at equals last_activity_at.
  - `test_list_recent_orders_by_last_activity`: create A, B, C; patch A's subject; then `sort=recent` gives `[A, C, B]`.
  - `test_list_created_orders_by_creation`: gives `[C, B, A]`.
  - `test_list_topic_groups_subjects_nulls_last`: subjects `"Automata"`, `"Automata"`, `"Cell biology"`, `None`, in that order, and within "Automata" newest activity first.
  - `test_search_matches_title_and_subject`: `q="dfa"` matches a title "DFA practice" and a subject "Automata · DFA", but not "Mitosis".
  - `test_patch_title_marks_student_source_and_bumps_activity`
  - `test_other_learner_gets_404` (GET, PATCH and DELETE)
  - `test_delete_then_404`
  - `test_rejects_invalid_language_422` (`"fr"`)
- [ ] **Step 2: Run it and confirm it fails.** Run: `uv run pytest tests/test_sessions.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement the repo and routes.** For topic sort, use `ORDER BY subject IS NULL, lower(subject), last_activity_at DESC`.
- [ ] **Step 4: Run it and confirm it passes.** Run: `uv run pytest -v && uv run ruff check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(server): sessions API with sorts, search, ownership"`

### Task 7: API contract and typed client

**Files:**
- Create: `services/server/src/tassel/scripts/export_openapi.py` (writes `packages/shared/src/api/openapi.json` with `sort_keys=True`, `indent=2`)
- Create: `packages/shared/src/api/schema.d.ts` (generated by `openapi-typescript`), `packages/shared/src/api/client.ts`, `packages/shared/src/api/index.ts`
- Modify: root `package.json` scripts:
  - `gen:api` = `uv run --directory services/server python -m tassel.scripts.export_openapi && pnpm --filter @tassel/shared exec openapi-typescript src/api/openapi.json -o src/api/schema.d.ts`
  - `check:api` = regenerate into a temp dir and fail on any diff (a Node script, `scripts/check-api.mjs`)
- Test: `packages/shared/tests/api-client.test.ts`

**Interfaces:**
- Produces:
  - `export type Session = components['schemas']['SessionOut']`
  - `export type SessionType = Session['type']`, `export type Source = Session['source']`
  - `export type SessionSort = 'recent' | 'created' | 'topic'`
  - `export class UnauthorizedError extends Error {}`
  - `export function createApiClient(opts: { baseUrl: string; getToken: () => Promise<string>; refreshToken: () => Promise<string>; fetch?: typeof fetch }): ApiClient`, where `ApiClient` is an `openapi-fetch` client whose middleware adds `Authorization: Bearer <token>` and, on a 401, calls `refreshToken()` once and retries. A second 401 throws `UnauthorizedError`.
  - `export async function listSessions(api: ApiClient, sort: SessionSort, q?: string): Promise<Session[]>`, plus `createSession`, `getSession`, `patchSession`, `deleteSession` with the matching types. Each throws `ApiError(status, body)` on non-2xx.

- [ ] **Step 1: Write the failing tests:**
  - `sends bearer token`: a fake fetch records headers → `Authorization === 'Bearer t1'`.
  - `refreshes once after 401 then succeeds`: responses 401 then 200; `refreshToken` is called once and the second request carries `Bearer t2`.
  - `throws UnauthorizedError when the retry is also 401`: `refreshToken` is called exactly once.
  - `listSessions passes sort and q`: the URL ends `/v1/sessions?sort=topic&q=dfa`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm --filter @tassel/shared test api-client`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm gen:api` and commit the generated `openapi.json` and `schema.d.ts`.
- [ ] **Step 4: Run them and confirm they pass.** Run: `pnpm --filter @tassel/shared test && pnpm check:api`. Expected: PASS, and exit 0 with no diff.
- [ ] **Step 5: Commit.** `git commit -am "feat(shared): generated API types and typed client with token refresh"`

### Task 8: Electron shell and E2E harness

**Files:**
- Create: `apps/desktop/package.json` (name `@tassel/desktop`; depends on `@tassel/shared`), `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `apps/desktop/src/main/index.ts` (lifecycle, single-instance lock, `app://` protocol registration and handler), `src/main/windows.ts`, `src/main/config.ts`, `src/main/ipc.ts`
- Create: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/shared/bridge.ts`
- Create: `apps/desktop/src/renderer/index.html` (CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https: wss:`), `src/renderer/src/main.tsx`
- Create: `apps/desktop/playwright.config.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/fixtures.ts`
- Test: `apps/desktop/tests/e2e/shell.spec.ts`

**Interfaces:**
- Produces:

```ts
// src/shared/bridge.ts
export type Platform = 'darwin' | 'win32' | 'linux';
export interface AppConfig { serverUrl: string; uiLanguage: Lang; tutorMode: 'fake' | 'live'; fakeScript: string; fakeSpeed: number }
export interface TasselBridge {
  platform: Platform;
  getConfig(): Promise<AppConfig>;
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
}
declare global { interface Window { tassel: TasselBridge } }
```

- `createMainWindow(): BrowserWindow`:
  - 1440×900, minimum 1024×680, `backgroundColor: '#fff9f3'`, `show: false` until ready-to-show.
  - macOS: `titleBarStyle: 'hiddenInset'`, traffic lights at `{ x: 20, y: 18 }`. Windows: `titleBarStyle: 'hidden'` with `titleBarOverlay { color: '#fff9f3', symbolColor: '#222222', height: 52 }`.
  - The security flags from Global Constraints.
- `readConfig(env = process.env): AppConfig`:
  - `serverUrl` defaults to `http://127.0.0.1:8787`;
  - `uiLanguage` comes from `TASSEL_UI_LANG`, else the first supported language in `app.getPreferredSystemLanguages()`, else `'en'`;
  - `tutorMode` defaults to `'fake'`, `fakeScript` to `'dfa-opening'`, `fakeSpeed` to `1`;
  - `TASSEL_USER_DATA` overrides `app.setPath('userData')`.
- E2E fixtures:
  - `launchApp(env?: Record<string,string>) → {app, page}` launches `out/main/index.js` with `TASSEL_SERVER_URL=http://127.0.0.1:8799`, `TASSEL_TOKEN_STORE=file`, a temp `TASSEL_USER_DATA`, and `TASSEL_FAKE_SPEED=20`.
  - `snap(page, name)` writes `test-results/screens/<name>.png`.
- E2E global setup: starts the server (`uv run --directory ../../services/server tassel-server`, with `TASSEL_PORT=8799` and `TASSEL_DATABASE_URL` pointing at `tassel_test`, migrated), polls `/v1/health` for up to 30 s, and kills the server in teardown. Cross-platform via `cross-spawn`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/tests/e2e/shell.spec.ts
import { expect, test } from '@playwright/test';
import { launchApp, snap } from './fixtures';

test('launches securely with the bridge', async () => {
  const { app, page } = await launchApp();
  await expect(page).toHaveTitle('Tassel');
  expect(await page.evaluate(() => typeof (globalThis as any).require)).toBe('undefined');
  expect(await page.evaluate(() => window.tassel.platform)).toBe(process.platform);
  expect(await page.evaluate(() => location.protocol)).toBe('app:');
  await snap(page, 'p1-shell');
  await app.close();
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e shell`. Expected: FAIL.
- [ ] **Step 3: Implement.** The renderer can show a placeholder `<h1>` for now; later tasks replace it.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS, and `test-results/screens/p1-shell.png` exists.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): secure Electron shell with app:// origin and e2e harness"`

### Task 9: Device token store in the main process

**Files:**
- Create: `apps/desktop/src/main/token-store.ts`
- Modify: `apps/desktop/src/main/ipc.ts` (`auth:getToken`, `auth:refreshToken`)
- Test: `apps/desktop/tests/unit/token-store.test.ts` (Vitest, node environment)

**Interfaces:**
- Produces:

```ts
export interface Crypto { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }
export function createTokenStore(deps: { dir: string; mode: 'safe' | 'file'; crypto: Crypto; fetch: typeof fetch; serverUrl: string }): { getToken(): Promise<string>; refreshToken(): Promise<string> }
```

- Behavior:
  - `getToken` returns the cached token, else reads `device.bin` (in `safe` mode) or `device.json` (in `file` mode), else registers via `POST {serverUrl}/v1/devices` and persists.
  - `refreshToken` always re-registers and overwrites.
  - In `safe` mode, when encryption is unavailable, it falls back to `file` and logs a warning once.

- [ ] **Step 1: Write the failing tests:**
  - `registers once and caches`: two `getToken` calls make one fetch.
  - `persists across instances`: a new store on the same dir makes no fetch.
  - `refreshToken re-registers and overwrites`: the file holds the new token.
  - `safe mode never writes the raw token`: the file bytes don't contain the token string.
  - `file mode writes JSON {token}`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm --filter @tassel/desktop test token-store`. Expected: FAIL.
- [ ] **Step 3: Implement and wire the IPC** (main passes `safeStorage`, `net.fetch` and `readConfig().serverUrl`).
- [ ] **Step 4: Run them and confirm they pass.** Run: `pnpm --filter @tassel/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): device token store with safeStorage and file modes"`

### Task 10: Renderer foundation and base components

**Files:**
- Create: `apps/desktop/src/renderer/src/styles/global.css` (`@import "tailwindcss"; @import "@tassel/shared/tokens.css"; @import "@tassel/shared/fonts.css"; @import "@tassel/shared/base.css";`)
- Create: `src/renderer/src/i18n.ts`, `src/renderer/src/app/App.tsx`, `src/renderer/src/app/AppFrame.tsx`, `src/renderer/src/app/route-store.ts`, `src/renderer/src/lib/api.tsx`
- Create: `src/renderer/src/components/Button.tsx`, `Chip.tsx`, `SegmentedControl.tsx`, `Sheet.tsx`, `IconButton.tsx`, `icons.tsx`
- Test: `apps/desktop/tests/unit/components.test.tsx`, `apps/desktop/tests/unit/i18n.test.ts` (Vitest with jsdom)

**Interfaces:**
- Produces:
  - `initI18n(lang: Lang): Promise<i18n>`: sets `document.documentElement.lang`.
  - `useRoute`: a Zustand store holding `{ route: { name: 'library' } | { name: 'session'; sessionId: string }; goLibrary(): void; openSession(id: string): void }`.
  - `ApiProvider` / `useApi(): ApiClient`, built from `window.tassel` and `createApiClient`.
  - `<AppFrame>`: a 52px draggable top strip (`-webkit-app-region: drag`; children marked `no-drag`) with left inset 84px on macOS for the traffic lights.
  - `<Button variant="primary"|"ghost">`: an ink pill or a text button.
  - `<Chip>`: a mono uppercase label on paper.
  - `<SegmentedControl options value onChange label>`: Radix ToggleGroup with arrow-key navigation; the active item is an ink pill.
  - `<Sheet open onOpenChange title>`: a Radix Dialog with a card radius of 24px.
  - `<IconButton label pressed>`: a 48px circle; pressed means ink fill with a white icon; `aria-label` comes from props.
  - `icons.tsx`: Mic, MicOff, Camera, Screen, Board, Captions, Globe, Plus, Search, Retry, as 24px stroke icons with 1.6 stroke weight.

- [ ] **Step 1: Write the failing tests:**
  - `Button primary is an ink pill`: has the classes `bg-ink`, `text-paper` and `rounded-pill`.
  - `Chip renders mono uppercase`: has the class `mono`.
  - `SegmentedControl moves selection with ArrowRight` (with `onChange` called).
  - `IconButton exposes aria-pressed and aria-label`.
  - `initI18n('ko') sets html lang and translates session.untitled to 제목 없는 세션`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm --filter @tassel/desktop test components i18n`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before writing UI code, read `.impeccable/mocks/decision/stage.html` and `docs/design-system/DESIGN.md` for the visual vocabulary. Also read the impeccable craft floor (`/Users/dang/.claude/plugins/cache/impeccable/impeccable/4.6.0/skills/impeccable/reference/craft-floor.md`).
- [ ] **Step 4: Run them and confirm they pass.** Run: `pnpm --filter @tassel/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): renderer foundation, i18n, base components"`

### Task 11: Library screen

**Files:**
- Create: `src/renderer/src/features/library/LibraryScreen.tsx`, `SessionCard.tsx`, `useSessions.ts`, `group-by-topic.ts`, `relative-time.ts`
- Test: `apps/desktop/tests/unit/library.test.tsx`, `apps/desktop/tests/unit/group-by-topic.test.ts`, `apps/desktop/tests/unit/relative-time.test.ts`, `apps/desktop/tests/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `listSessions` (Task 7), `useApi` (Task 10), `useRoute.openSession`.
- Produces:
  - `groupByTopic(items: Session[], noTopicLabel: string): Array<{ topic: string; items: Session[] }>`
  - `formatRelative(date: Date, now: Date, lang: Lang): string` (`Intl.RelativeTimeFormat` with `numeric: 'auto'`)
  - `useSessions(sort: SessionSort, q: string)`, returning `{ status: 'loading' | 'error' | 'ready'; items: Session[]; error?: unknown; refetch(): void }`. `q` is debounced 250 ms.
- Layout:
  - Top strip: wordmark at left, centered search, "New session" primary pill at right.
  - Below it: the heading plus the sort SegmentedControl (Recent activity · Date created · Topic), then a responsive card grid (`minmax(280px, 1fr)`).
  - Cards (white on bone, radius 16): title (the untitled placeholder in smoke-text), clamped to 2 lines; subject chip; type chip; language badge; relative time.
- States: empty (illustrated, with a "New session" CTA), loading (skeleton cards) and error ("Couldn't reach Tassel's server", Retry).

- [ ] **Step 1: Write the failing tests:**
  - `groupByTopic puts null subjects last under the label`
  - `formatRelative`: en "2 hours ago", es "hace 2 horas", ko "2시간 전".
  - `LibraryScreen shows empty state with New session`
  - `shows error state and retries`: the mock rejects, then resolves on the second call.
  - `switching sort to topic renders group headers`
  - `long Spanish title clamps to two lines` (the element has `line-clamp-2`).
  - **E2E `library.spec.ts`:**
    - Seed 3 sessions through the API using the app's token (`page.evaluate(() => window.tassel.getToken())`), then assert 3 cards and `snap('p1-library')`.
    - A second test launches with `TASSEL_SERVER_URL=http://127.0.0.1:1` and asserts the error state and Retry.
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run: `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e library`. Expected: PASS, and `p1-library.png` exists.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): session library with sorts, search, states"`

### Task 12: New session sheet

**Files:**
- Create: `src/renderer/src/features/new-session/NewSessionSheet.tsx`, `defaults.ts`
- Test: `apps/desktop/tests/unit/new-session.test.tsx`, `apps/desktop/tests/e2e/new-session.spec.ts`

**Interfaces:**
- Consumes: `createSession` (Task 7), `useRoute.openSession`, `window.tassel.platform`, `i18n.language`.
- Produces:
  - `defaultSource(platform: Platform): Source`: `'screen'` on win32, else `'paper'`.
  - `<NewSessionSheet open onOpenChange />`, with three SegmentedControls (type, language, source) and a "Start" pill. Language defaults to the UI language. On win32 the "Paper · Desk View" option is disabled and `platform.windowsNoDeskView` is shown under the control. "Start" creates the session and opens it.

- [ ] **Step 1: Write the failing tests:**
  - `submits chosen values`: homework/en/paper → `createSession` called with exactly those values, then `openSession(id)`.
  - `defaults language to UI language` (`ko`).
  - `win32 disables paper and shows the notice` (exact en copy).
  - **E2E:** New session → Homework/English/Paper → Start → the session screen shows "Untitled Session" → Back → the library shows the card; `snap('p1-new-session')`.
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): new session sheet with platform-aware source"`

### Task 13: Session screen layout ("One stage")

**Files:**
- Create: `src/renderer/src/features/session/SessionScreen.tsx`, `TitleStrip.tsx`, `Stage.tsx`, `TutorTile.tsx`, `AvatarPlaceholder.tsx`, `Captions.tsx`, `Dock.tsx`, `stage-store.ts`, `use-elapsed.ts`, `shortcuts.ts`
- Test: `apps/desktop/tests/unit/stage-store.test.ts`, `apps/desktop/tests/unit/session-screen.test.tsx`, `apps/desktop/tests/e2e/session-layout.spec.ts`

**Interfaces:**
- Consumes: `getSession` and `patchSession` (Task 7), `useRoute`, the base components.
- Produces:

```ts
export type StageMode = 'paper' | 'board' | 'split';
export type TutorState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'watching';
interface StageStore {
  mode: StageMode; pinned: StageMode | null; requested: StageMode;
  tutorState: TutorState; captionsOn: boolean; micOn: boolean; cameraOn: boolean;
  caption: { previous?: { speaker: 'student' | 'tutor'; text: string }; current?: { speaker: 'student' | 'tutor'; text: string } };
  requestMode(m: StageMode): void;   // tutor's request; ignored while pinned, remembered in `requested`
  pin(m: StageMode): void; unpin(): void;  // unpin restores `requested`
  setTutorState(s: TutorState): void; pushCaption(speaker: 'student' | 'tutor', text: string): void;
  toggleCaptions(): void; toggleMic(): void; toggleCamera(): void; reset(): void;
}
export const useStageStore: UseBoundStore<StoreApi<StageStore>>;
export function useElapsed(start: Date, now?: () => number): string; // "mm:ss", or "h:mm:ss" past an hour
```

- Layout (match `.impeccable/mocks/decision/stage.html`):
  - **Title strip:** session title (single line, ellipsis), subject and type chips, a live dot with the source label, the timer, and the language pill. Board and paper panels are 16px-radius cards on bone, with a 12px gap.
  - **Split** is a 1fr/1fr grid.
  - **Paper placeholder:** "Waiting for Desk View". P3 replaces it.
  - **Board placeholder:** dotted canvas with the label "Ada's board".
  - **TutorTile:** 212×176, blush, an iris ring while speaking, and the label with `tutorState`. It floats top-right of the stage.
  - **Captions:** an ink panel, max width 880, at the bottom center above the dock, showing the previous and current lines with speaker labels.
  - **Dock:** a white pill with a hairline border, holding Mic (with level bars), Camera, Share, Board (cycles paper → split → board and pins), Captions, a separator, and "End session". End confirms through the Sheet, then returns to the library.
- Shortcuts: M toggles mic, B cycles the board view, C toggles captions. Ignored while typing in inputs.

- [ ] **Step 1: Write the failing tests:**
  - **stage-store:**
    - `requestMode is ignored while pinned but remembered`;
    - `unpin restores the latest requested mode`;
    - `pushCaption shifts current to previous`.
  - **session-screen:**
    - `untitled session shows localized placeholder (es)`;
    - `timer formats 14:32` (fake clock);
    - `split renders both panes`;
    - `dock buttons have accessible names in ko`;
    - `M toggles mic, B cycles board, C toggles captions`;
    - `End session asks to confirm then routes to library`.
  - **E2E session-layout.spec:**
    - At 1440×900, `snap('p1-session-1440')`.
    - At 1024×680, assert that the dock, captions and tutor tile bounding boxes don't intersect, then `snap('p1-session-1024')`.
    - With `TASSEL_UI_LANG=ko` and a Spanish 70-character title in an `es` UI: the title element has `scrollWidth > clientWidth` and `text-overflow: ellipsis`; `snap('p1-session-ko')`.
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS; three screenshots.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): session stage layout with dock, captions, tutor tile"`

### Task 14: TutorClient contract and the fake tutor

**Files:**
- Create: `src/renderer/src/tutor/types.ts`, `tutor/clock.ts`, `tutor/fake-client.ts`, `tutor/create-client.ts`, `tutor/use-tutor-session.ts`, `tutor/scripts/dfa-opening.json`
- Modify: `features/session/SessionScreen.tsx` (connect on mount, disconnect on unmount)
- Test: `apps/desktop/tests/unit/fake-client.test.ts`, `apps/desktop/tests/unit/use-tutor-session.test.tsx`, `apps/desktop/tests/e2e/fake-tutor.spec.ts`

**Interfaces:**
- Produces:

```ts
export type TutorEvent =
  | { type: 'state'; state: TutorState }
  | { type: 'caption'; speaker: 'student' | 'tutor'; text: string; lang: Lang; final: boolean }
  | { type: 'stage'; mode: StageMode }
  | { type: 'title'; title: string; subject: string | null };
export interface TutorClient {
  connect(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;
  on(listener: (e: TutorEvent) => void): () => void;
  sendText(text: string): void; // the dev/fake path: a typed student line
}
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void }
export interface FakeScript { steps: Array<{ at: number; event: TutorEvent }> } // at = ms from connect
export class FakeTutorClient implements TutorClient { constructor(script: FakeScript, opts?: { clock?: Clock; speed?: number }) }
export function createTutorClient(cfg: AppConfig): TutorClient; // 'live' throws Error('live tutor arrives in P2')
export function useTutorSession(sessionId: string, client: TutorClient): void; // routes events into useStageStore; title events update the session query cache
```

- `dfa-opening.json`, in this order (times in ms at speed 1):

| Time | Event |
|---|---|
| 0 | state `connecting` |
| 800 | state `listening` |
| 1500 | student caption "Hi Ada, I'm working on a DFA for binary strings that start with 010." |
| 4500 | title "Strings that start with 010" / "Automata · DFA" |
| 5000 | state `speaking` |
| 5200 | tutor caption "Great, draw it on paper and talk me through it. I'll watch." |
| 8500 | state `watching` |
| 14000 | state `speaking` |
| 14200 | tutor caption "What should happen once you've already read 010?" |
| 17000 | state `watching` |
| 24000 | student caption "I think that's it. If it starts with a 1, I just wait on q0 until I see a 0." |
| 26000 | state `thinking` |
| 27500 | state `speaking` |
| 27600 | stage `split` |
| 27700 | tutor caption "Before you move on, try running 1010 through your DFA. Where does it end up?" |
| 33000 | state `listening` |

- [ ] **Step 1: Write the failing tests:**
  - **fake-client** (manual clock):
    - `emits events in script order at their times`;
    - `speed 20 compresses time`;
    - `disconnect stops further events`;
    - `sendText emits a final student caption immediately`.
  - **use-tutor-session:**
    - `stage event calls requestMode` (pinned is respected);
    - `captions flow into the store`;
    - `title event shows the new title in the title strip`.
  - **E2E fake-tutor.spec:** start a session with `TASSEL_FAKE_SPEED=20`. Wait for the caption containing "1010", assert the stage is split and the tutor label reads "Speaking" or "Listening", then `snap('p1-fake-tutor')`.
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS; a screenshot.
- [ ] **Step 5: Commit.** `git commit -am "feat(desktop): TutorClient contract with scripted fake tutor"`

### Task 15: Developer workflow and docs

**Files:**
- Create: `scripts/dev.mjs`. With `cross-spawn`, it:
  1. ensures `docker compose up -d db`;
  2. runs `uv run alembic upgrade head` in `services/server`;
  3. starts `uv run tassel-server` and `pnpm --filter @tassel/desktop dev` with prefixed logs;
  4. exits both on Ctrl+C.
- Create: `scripts/check-api.mjs` (Task 7 references it), `README.md` (macOS and Windows setup: Node 22+, pnpm 12, uv, Docker Desktop; `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm e2e`, `pnpm check`), `CLAUDE.md` (agent guide: commands, layout, conventions, the Global Constraints in brief, "exercise every feature in the running app", where screenshots land)
- Create: `.github/workflows/ci.yml`:
  - `check` and unit tests on `macos-latest` and `windows-latest`;
  - server tests on `ubuntu-latest` with a `pgvector/pgvector:pg17` service;
  - E2E on `macos-latest`.
- Modify: root `package.json` scripts:
  - `dev` = `node scripts/dev.mjs`
  - `test` = `pnpm -r test && uv run --directory services/server pytest`
  - `check` = `biome check . && pnpm -r typecheck && pnpm check:i18n && pnpm check:api && uv run --directory services/server ruff check`
  - `e2e` = `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e`

- [ ] **Step 1: Verify `pnpm check`.** Expected: exit 0.
- [ ] **Step 2: Verify `pnpm test`.** Expected: all unit and server tests pass.
- [ ] **Step 3: Verify `pnpm e2e`.** Expected: all E2E specs pass, and screenshots exist in `apps/desktop/test-results/screens/`.
- [ ] **Step 4: Run `pnpm dev`.** Expected: the app window opens on the library. Create a session and watch the fake tutor play through to the split stage. Stop with Ctrl+C.
- [ ] **Step 5: Commit, then push the branch.** `git add -A && git commit -m "chore: dev workflow, README, agent guide, CI"`, then `git push -u origin claude/p1-foundation`.
