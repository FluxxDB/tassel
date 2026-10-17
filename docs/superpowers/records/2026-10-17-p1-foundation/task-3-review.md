# Task 3 review: server skeleton

**Checker:** fable · **Commits reviewed:** `9df0f00..fb025cd` (1 commit, `fb025cd`) · **Worktree:** `/Users/dang/Projects/tassel-proto/.claude/worktrees/p1-server`
**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 2 Minor.

## Re-run

Command (from `services/server`): `uv sync && uv run pytest -v && uv run ruff check && uv run ruff format --check`
Result: `Resolved 40 packages`, **8 passed** in 0.38s, `All checks passed!`, `8 files already formatted`. Python 3.12.15, pytest-asyncio 1.4.0 in strict mode, no warnings. Working tree clean.

Extra checks:

- **Entry points.** `.venv/bin/tassel-server` and `python -m tassel` (with `TASSEL_PORT`) both serve `GET /v1/health → 200 {"status":"ok","version":"0.1.0"}` and shut down cleanly on SIGTERM.
- **Windows loop plumbing, exercised on macOS.** `uvicorn.Config(..., loop="asyncio:SelectorEventLoop").get_loop_factory()` returns `asyncio.SelectorEventLoop` (uvicorn 0.54 `config.py:555-560` imports a non-builtin loop string and uses it directly as the loop factory), and a server started that way serves health. The premise holds too: psycopg 3.3.6 refuses the Proactor loop (`psycopg/connection_async.py:101-111`), and uvicorn's `"auto"` and `"asyncio"` loops both pick Proactor on win32 (`uvicorn/loops/asyncio.py`), so the override is needed from Task 4 onward. Not run on a real Windows machine; see Notes.
- **Lock.** `uv.lock` is universal (`requires-python = "==3.12.*"`); `uvloop` is excluded on `win32`, `colorama`/`tzdata` are included there, and cp312 or abi3 `win_amd64` wheels exist for `psycopg-binary`, `pydantic-core`, `httptools`, `watchfiles`, `websockets`, `sqlalchemy`. A Windows `uv sync` needs no compiler.
- **Line endings.** All 10 tracked files are LF with a final newline.
- **Commit.** Message `feat(server): FastAPI skeleton with health endpoint`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` present.

## Verdicts per angle

1. **Spec: pass.** Every file in the brief exists with the brief's content: project name, `requires-python`, dependencies and dev group verbatim, script entry, ruff line length 100 (`pyproject.toml`); `__version__ = "0.1.0"` single-sourced through hatch's dynamic version; `Settings` with env prefix `TASSEL_`, the five fields and exact defaults (`config.py:8-15`); `create_app(settings: Settings | None = None) -> FastAPI` with the brief's `CORSMiddleware` arguments (`app.py:11-19`); `GET /v1/health` with no auth (`api/health.py:18-20`); `main()` runs `uvicorn.run(create_app(settings), host, port)` (`__main__.py:16-18`). The brief's two tests are present with the same bodies and assertions, wrapped to 100 columns. Extras beyond the brief: `uv.lock`, `tests/test_main.py`, four more CORS tests, the `loop=` argument, a typed `HealthOut` response model, ruff rule selection `E, W, F, I, UP`. All additive and consistent with the global constraints ("CORS allows exactly these two"). Nothing missing or misunderstood.
2. **Correctness: pass.** Tests drive the ASGI app through httpx and check real responses. CORS coverage: allowed `app://tassel` preflight; allowed dev origin with `Authorization` + `Content-Type` on a PATCH preflight; three rejected origins get 400 with no allow-origin header, which pins the exact-two-origins constraint. `test_main` patches `uvicorn.run` on the module the code calls through, so host, port and loop are really exercised; `uvicorn_loop` is a pure function of the platform string, tested for win32, darwin and linux. Pydantic copies the mutable `cors_origins` default per instance, so there is no shared-list bug.
3. **Cross-platform: pass.** No scripts, no paths, LF endings, universal lock with Windows wheels. The Windows event-loop selection is correct by reading the sources (above). Residual risk: not executed on Windows.
4. **Security and data: pass.** Health is intentionally unauthenticated (brief). CORS is an exact allow-list, `allow_credentials` is left at its default `False`, headers are limited to `Authorization` and `Content-Type`. The server binds `127.0.0.1` by default. No secrets committed; the dev DB URL default is the brief's. No DB code yet.
5. **Maintainability: pass, 2 Minor.** One responsibility per file; version in one place; typed `HealthOut` gives Task 7 a real schema; docstrings say why (`api/__init__.py`, `__main__.py`, `uvicorn_loop`). No dead code, no duplication in product code.

## Findings

**Critical:** none.
**Important:** none.

**Minor** (logged, non-blocking):

- **M1** `services/server/src/tassel/app.py:12`: `settings = settings or Settings()` relies on a pydantic model always being truthy. It is (BaseModel defines neither `__bool__` nor `__len__`), so no bug, but `if settings is None` states the intent. Fold into the next touch of `app.py` (Task 4 edits it under R1).
- **M2** `services/server/tests/test_health.py:9-10, 18-19, 27-28`: the `ASGITransport`/`AsyncClient` setup is repeated three times. Task 4's `conftest.py` introduces a `client` fixture; these tests can share it then, or a local no-DB fixture, since health must keep working without a database.

## Notes for later tasks (not findings)

- Later briefs' test counts are +6 from Task 3's extras (8 tests instead of 2).
- The builder's Task 4 plan to give tests a selector loop via `pytest_asyncio_loop_factories` is viable: the hook exists in the locked pytest-asyncio 1.4.0 (`pytest_asyncio/plugin.py:92`).
- Carry to whoever runs the server on Windows: confirm `uv run tassel-server` logs `Uvicorn running` and that the first DB query after Task 4 succeeds; the loop override is what makes that work.
- `app.state` carries nothing yet; Task 4's lifespan attaches the engine (R1).
- Test DB split: the builder runs against `tassel_test_builder`; checker runs use the default `tassel_test`.

## Round history

- Round 1 (2026-10-17): APPROVED. 0 Critical, 0 Important, 2 Minor.
