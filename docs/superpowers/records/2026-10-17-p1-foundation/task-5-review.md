# Task 5 review: device registration and auth

**Checker:** fable · **Commits reviewed:** `5e5feca..70310c3` (1 commit, `70310c3`) · **Worktree:** `/Users/dang/Projects/tassel-proto/.claude/worktrees/p1-server`
**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 1 Minor.

## Re-run

The worktree already carried the builder's uncommitted Task 6 work (`app.py` modified to include `sessions.router`; untracked `models.py`, `api/sessions.py`, `storage/sessions_repo.py`, `tests/test_sessions.py`), so the task was verified two ways, both on the default `tassel_test`:

1. In the worktree, ignoring the untracked Task 6 test file: `uv run pytest -v --ignore=tests/test_sessions.py` → **29 passed** in 0.50s; `ruff check` and `ruff format --check` over the tracked files → clean (19 files).
2. On the exact commit: `git archive 70310c3 services/server` exported to the checker's scratchpad and run with `PYTHONPATH=<export>/src` (verified `tassel.app`/`tassel.auth` imported from the export, not the worktree) → **29 passed** in 0.50s. The export was deleted afterwards.

Extra checks:

- **OpenAPI** (Task 7's contract): `POST /v1/devices` → 201 `DeviceRegistration {device_id: uuid, token: string}`, no parameters; `GET /v1/me` → 200 `MeOut {learner_id: uuid, ui_language: string}`, one optional header parameter `authorization`, plus the standard 422. No `securitySchemes` (the brief fixed the `Header(None)` signature, so there is none to declare).
- **No token leakage paths**: no logging or printing in `auth.py` / `api/devices.py`; only `hash_token(token)` is persisted (`devices.py:33`); the plaintext exists only in the 201 body.
- **Files**: all four changed files LF with a final newline; nothing platform-specific.
- **Commit**: message `feat(server): device registration and bearer auth`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` present.

## Verdicts per angle

1. **Spec: pass.** `POST /v1/devices` returns 201 with `device_id` and `token`, creating a `Learner` then a `Device` (`api/devices.py:26-36`); the token is `secrets.token_urlsafe(32)` (43 chars, `auth.py:17-18`) and only its SHA-256 hex is stored (`auth.py:21-22`). `current_learner(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)) -> Learner` matches the brief's signature (`auth.py:39-42`), raises 401 with `WWW-Authenticate: Bearer` on missing, malformed or unknown tokens (`auth.py:31-36, 45-53`) and updates `devices.last_seen_at` (`auth.py:47-52`). `GET /v1/me` returns `learner_id` and `ui_language` through `current_learner` (`api/devices.py:39-41`). `app.py` includes the router under `/v1` (R1). The brief's three tests are verbatim apart from import grouping. Nothing missing or extra beyond four additional tests.
2. **Correctness: pass.** Parsing uses `partition(" ")` with a case-insensitive scheme and stripped token, so `""`, `"Bearer"`, `"Bearer "`, `"Token abc"` and `"Basic abc"` fail at the parser and `"Bearer nope"` / `"Bearer a b"` fail at the lookup; every path yields the same 401. The lookup is a single `UPDATE ... RETURNING learner_id`, so "find device" and "record as seen" cannot drift apart; `get_one(Learner)` then loads the owner and the commit persists `last_seen_at` even on read-only routes. FastAPI caches `get_db` per request, so `current_learner` and the route share one session; with `expire_on_commit=False` the returned `Learner` stays usable after the commit. `test_authenticated_request_updates_last_seen_at` relies on `now()` advancing between two transactions, which holds (microsecond precision, separate requests). `test_me_rejects_malformed_bearer_headers` registers a device first, so rejections are not an artefact of an empty table.
3. **Cross-platform: pass.** Pure Python; no paths, shells or platform branches.
4. **Security and data: pass.** Hash-only storage with 256 bits of token entropy; a lookup keyed on the hash makes string-comparison timing irrelevant to recovering a token. Constant error detail, correct challenge header, no token logging. `POST /v1/devices` is unauthenticated and unlimited by design (the device's bootstrap, server on loopback, single local learner); the report records the condition under which a rate limit or registration secret becomes necessary. Ownership: `/v1/me` only ever returns the caller's own learner.
5. **Maintainability: pass, 1 Minor.** `auth.py` owns tokens and the dependency; `api/devices.py` owns the two routes; `_bearer_token` and `_unauthorized` keep the dependency readable; the router loop in `app.py` keeps the `/v1` prefix in one place. Typed response models give Task 7 real schema names.

## Findings

**Critical:** none.
**Important:** none.

**Minor** (logged, non-blocking):

- **M1** `services/server/src/tassel/api/devices.py:23`: `MeOut.ui_language` is `str`. Once Task 6's `models.py` defines `Lang = Literal["en", "es", "ko"]`, type it as `Lang` so the OpenAPI schema is an enum and Task 7's generated `MeOut.ui_language` lines up with the desktop's `Lang`. Pair it with Task 4's M1 (a CHECK on `learners.ui_language`) so the database can never hold a value that fails serialization. Fold into Task 6 or leave for Task 7's pass; either is fine.

## Notes for later tasks (not findings)

- Task 7: `authorization` appears as an optional header parameter on every authenticated operation, and there is no `securitySchemes` entry. The generated client types will carry `header?: { authorization?: string }`; the client's fetch middleware sets the header, so nothing needs to change, but the generator output will look like that.
- Task 6: every route takes `current_learner`; `get_db` never commits, so repo functions must commit, and ownership must be enforced in the query (`learner_id = :me`), returning 404 rather than 403 for another learner's session.
- Test count is now 29 (brief counts are +22 from this track's extras).

## Round history

- Round 1 (2026-10-17): APPROVED. 0 Critical, 0 Important, 1 Minor.
