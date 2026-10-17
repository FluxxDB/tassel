# Task 4 review: database, tables and migrations

**Checker:** fable · **Commits reviewed:** `fb025cd..5e5feca` (1 commit, `5e5feca`) · **Worktree:** `/Users/dang/Projects/tassel-proto/.claude/worktrees/p1-server`
**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 1 Minor.

## Re-run

Command (repo root, then `services/server`): `docker compose up -d --wait db && uv sync && uv run pytest -v && uv run ruff check && uv run ruff format --check`, on the default `tassel_test`.
Result: container `tassel-db-1` healthy on `127.0.0.1:54329`; **16 passed** in 0.31s; `All checks passed!`; `16 files already formatted`. Working tree clean at `5e5feca`.

Extra checks:

- **Alembic CLI on `tassel_test` through `TASSEL_DATABASE_URL` (Ruling R2 path).** `current` → `0001 (head)`; `downgrade base` leaves only `alembic_version` and the vector extension count is 0; `upgrade head` recreates everything; `current` → `0001 (head)`; `check` → `No new upgrade operations detected.`
- **Offline DDL** (`upgrade head --sql`) and the **live schema** (`psql \d`, `pg_constraint`, `pg_indexes`) match the brief column for column: `uuid` keys; `timestamp with time zone DEFAULT now() NOT NULL` on every timestamp; `ui_language varchar(2) DEFAULT 'en' NOT NULL`; `token_hash char(64) NOT NULL UNIQUE`; `fk_devices_learner_id_learners ... ON DELETE CASCADE`; `fk_sessions_learner_id_learners` without cascade (as the brief lists it); `ck_sessions_{title_source,type,language,source}`; indexes `(learner_id, last_activity_at DESC)`, `(learner_id, created_at DESC)`, `(learner_id, subject)`; `vector 0.8.7` installed.
- **pytest-asyncio loop hook, mechanism proven.** The builder's probe (`LOOP: _UnixSelectorEventLoop`) cannot distinguish the hook from the macOS default. I ran a throwaway scratch test with a `pytest_asyncio_loop_factories` hook returning a `SelectorEventLoop` subclass, and both the test body and an async fixture ran on that subclass. The hookspec is `firstresult`; with one factory pytest-asyncio adds a hidden parameter, which is why test ids carry no `[selector]` suffix.
- **Alembic 1.20.0** has the `module` post-write-hook type (`alembic/script/write_hooks.py:173`), so `python -m ruff` hooks are valid and Windows-safe.
- **Lock.** Adds `greenlet 3.5.6` (cp312 wheels for macOS, Linux, `win_amd64`, `win_arm64`) via `sqlalchemy[asyncio]`.
- **Files.** All 15 changed files are LF with a final newline; no shell or subprocess use anywhere in the new code.
- **Commit.** Message `feat(server): postgres schema with sessions, devices, learners`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` present.

## Verdicts per angle

1. **Spec: pass.** `docker-compose.yml` has `name: tassel`, image `pgvector/pgvector:pg17`, port `54329:5432` (published on `127.0.0.1`), user/password/db `tassel`, a named volume, plus a `pg_isready` healthcheck. `storage/db.py` exposes `make_engine(url) -> AsyncEngine`, `session_factory(engine) -> async_sessionmaker[AsyncSession]` and `get_db(request)` reading the factory from `app.state` (`db.py:14-27`). Tables, constraints and indexes are exactly the brief's (`tables.py:33-86`, `0001_initial.py:23-91`); migration `0001` runs `CREATE EXTENSION IF NOT EXISTS vector`. `alembic/env.py:17` reads the URL from `Settings` (R2). `app.py:15-23` adds the lifespan that puts the engine on `app.state` (R1). `conftest.py` provides `db_url` (create-if-missing connecting to `tassel`, `alembic upgrade head` once per session, truncate before each test), `db`, `client`, all honouring `TASSEL_TEST_DATABASE_URL`. The brief's three tests are present with the same behaviour; the semicolon statements are split and `pytest.raises(Exception)` became `IntegrityError` matched on the constraint name (stronger). Documented deviations are sound: `sqlalchemy[asyncio]` is required because SQLAlchemy 2.1 moved greenlet to that extra (the RED run shows the ImportError); `pytest-asyncio>=1.4` is needed for the loop hook; the sessions FK has no cascade because the brief puts cascade only on `devices`. Nothing missing or misunderstood.
2. **Correctness: pass.** `test_migrations_match_the_models` (autogenerate diff must be empty, with `compare_server_default`) pins the migration to the models; the builder's mutation table shows it catches type, FK, default and index changes. The parametrized `rejects_*` tests cover the four CHECK constraints that autogenerate does not compare. `test_db.py` proves `get_db` + lifespan wiring by reading `current_database()` through a probe route on the test DB. `last_activity_at == created_at` on insert holds because both defaults are `now()` in one statement. The `client` fixture runs the app's lifespan explicitly because `ASGITransport` sends no lifespan events. Truncation uses quoted identifiers over `Base.metadata.sorted_tables` and `SET LOCAL lock_timeout = '5s'`, so a leaked lock fails fast instead of hanging.
3. **Cross-platform: pass.** `alembic.ini` uses `%(here)s/alembic` and `path_separator = os`; the write hooks run `python -m ruff`; `env.py` migrates with a sync engine so the E2E migrate step never meets psycopg's Proactor refusal; tests pin `asyncio.SelectorEventLoop` through the hook (exists on Windows as `_WindowsSelectorEventLoop`). The compose loopback bind works under Docker Desktop. Residual: not executed on Windows.
4. **Security and data: pass.** DB published on loopback only. The create-database path quotes the identifier through the dialect preparer and takes the name from the operator's own env var. The truncate path refuses any database whose name lacks `test` (`conftest.py:61-63`), protecting the dev `tassel` DB. Dev credentials are the brief's and not secrets. `CREATE EXTENSION` relies on the image's superuser, fine for dev/test.
5. **Maintainability: pass, 1 Minor.** One responsibility per file; a `MetaData` naming convention gives every constraint a stable name that migrations and tests refer to; `op.f()` keeps the convention from double-prefixing; `_timestamp()` removes repetition in the migration; `TutoringSession` is documented against the obvious name clash. Task 3 minors M1 (`if settings is None`) and M2 (`no_db_client` fixture) are folded in cleanly.

## Findings

**Critical:** none.
**Important:** none.

**Minor** (logged, non-blocking):

- **M1** `services/server/src/tassel/storage/tables.py:38` and `alembic/versions/0001_initial.py:30`: `learners.ui_language` has no CHECK against the `en|es|ko` domain, unlike `sessions.language`. The brief did not ask for one, and nothing writes the column in P1, so this is a note for whichever later task first writes `ui_language` (add the constraint in that migration, or now while `0001` is unreleased if the builder prefers).

## Notes for later tasks (not findings)

- `get_db` never commits (by design). Task 6's repo functions must commit explicitly; the checker will look for that.
- The sessions FK has no `ON DELETE CASCADE` (brief-literal). If learner deletion ever lands, that needs a migration; raised for the controller as a design note, no action in this track.
- Shared test database: pytest's default `tassel_test` is also the E2E database (global constraints, R2). Running pytest and Playwright E2E at the same time would interfere (pytest truncates before every test). Run them sequentially in Task 15's `check`, or point one at its own `TASSEL_TEST_DATABASE_URL`. Builder's own runs already use `tassel_test_builder`; checker uses `tassel_test`.
- Later briefs' test counts are +11 from this track's extras (16 tests now).

## Round history

- Round 1 (2026-10-17): APPROVED. 0 Critical, 0 Important, 1 Minor.
