# Task 7 review: API contract and typed client

**Checker:** fable · **Commits reviewed:** `0237df2..6ae285b` (4 commits: `450e990` Task 6 M3, `5cbec1e` exporter + Task 6 M2, `8132a90` the brief, `6ae285b` the baseUrl-origin fix) · **Worktree:** `/Users/dang/Projects/tassel-proto/.claude/worktrees/p1-server` (fast-forwarded to `claude/p1-foundation` `0237df2`)
**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 2 Minor.

## Re-run

Builder's command, from the worktree root: `pnpm install --frozen-lockfile && pnpm --filter @tassel/shared test && pnpm check:api && pnpm check && (cd services/server && uv run pytest -q && uv run ruff check)`, plus `ruff format --check`.
Result at `8132a90`: lockfile up to date; **35 shared tests passed**; `check:api: openapi.json and schema.d.ts match the server` (exit 0); `biome check .` → `Checked 20 files … No fixes applied.` and `tsc --noEmit -p .` clean; **59 server tests passed**; ruff check and format clean. Re-run at `6ae285b`: **36 shared tests passed**, `check:api` exit 0, `pnpm check` clean. Working tree clean.

Extra checks:

- **Token scope, demonstrated independently.** A throwaway Node script (Node 26 type stripping) drove the real `client.ts` with a fake fetch: a call on the configured `baseUrl` carried `Bearer <token>`; a call with a per-request `baseUrl` override to `https://evil.example` and a call whose URL an `onRequest` middleware rewrote to another origin both went out with **no** `Authorization` header. (The worktree already contained `6ae285b` when the script ran; without it, openapi-fetch 0.17's per-request `baseUrl` override and middleware would have carried the token elsewhere, which is the Important finding the fix pre-empted.)
- **Generated contract.** `schema.d.ts`: `SessionPatch.type?: "homework" | …` and `language?: "en" | "es" | "ko"` with no `null`, while `title`/`subject` keep `| null`; `MeOut.ui_language: "en" | "es" | "ko"`; path keys `/v1/sessions` and `/v1/sessions/{session_id}`. `openapi.json`: `securitySchemes.DeviceToken` (`http`/`bearer`), sorted keys, two-space indent, trailing newline.
- **Line endings.** `git ls-files --eol` shows `i/lf w/lf eol=lf` for all 16 changed files; every file ends with a newline.
- **Lock.** Adds `openapi-fetch 0.17.0`, `openapi-typescript 7.13.0`, `cross-spawn 7.0.6`, and a second `typescript@5.9.3` as openapi-typescript's auto-installed peer next to the workspace's `7.0.2` (see M2).
- **Commits.** Four conventional messages; every one carries `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The brief's commit message is verbatim.

## The controller's five checks

| Check | Result |
|---|---|
| `schema.d.ts` committed; `pnpm check:api` fails on drift | Committed (`8132a90`). `check:api` re-run exit 0. Failure path: the report's evidence table (comment appended to `schema.d.ts` → exit 1; edited `openapi.json` → exit 1; server route changed without regeneration → both stale, exit 1; `uv` missing → `spawnSync uv ENOENT`, exit 1; restored → exit 0). The script treats a missing file as stale and normalises CRLF before comparing (`scripts/check-api.mjs:22-23, 33`). The checker did not mutate files in the shared worktree. |
| 401 refresh happens exactly once | `withDeviceToken` calls `refreshOnce()` at most once per request and throws `UnauthorizedError` on the second 401 without refreshing again (`client.ts:70-82`); `refreshToken` is asserted `toHaveBeenCalledTimes(1)` in both brief tests; concurrent 401s share one in-flight refresh (`client.ts:57-62`, tested), and a token another request already refreshed is reused without a refresh (tested). |
| Helpers use the `{session_id}` path param | `byId(id)` → `params.path.session_id`; `getSession`/`patchSession`/`deleteSession` call `'/v1/sessions/{session_id}'` (`client.ts:95-119`); the URL test pins `/v1/sessions/<uuid>`. |
| `SessionPatch` no longer advertises `null` for `type`/`language` | `SkipJsonSchema[None]` in `models.py:31-32`; server test `test_patch_offers_null_only_where_it_clears_a_field`; confirmed in the generated `schema.d.ts`. Explicit `null` is still a 422 via the existing validator. |
| The client sends the token only to the configured `baseUrl` | `6ae285b`: `new URL(request.url).origin !== new URL(baseUrl).origin` → pass through untouched, no retry (`client.ts:53, 71`). Origin comparison is immune to the `http://host:port@evil/` prefix trick. Tested for the per-request override; the checker also verified a middleware rewrite. |

## Verdicts per angle

1. **Spec: pass.** Every file in the brief exists: the exporter (`sort_keys=True`, `indent=2`, LF, trailing newline), the generated pair, `client.ts`, `index.ts`, the root scripts (`gen:api` verbatim; `check:api` → `node scripts/check-api.mjs`, Ruling R3), and `tests/api-client.test.ts` with the brief's four tests plus seven extras. Exports match the interface list: `Session`, `SessionType`, `Source`, `SessionSort` (derived from the schema's query enum and type-locked to the three literals by `expectTypeOf`, enforced by `tsc`), `UnauthorizedError`, `createApiClient(opts)` returning an openapi-fetch `Client<paths>`, and the five helpers throwing `ApiError(status, body)`. The token logic is a fetch wrapper rather than an openapi-fetch middleware, which the controller's pre-flight already allowed; the report's reason (a middleware sees an already-consumed body, so a POST/PATCH retry cannot be replayed) is correct.
2. **Correctness: pass.** The retry is a `request.clone()` taken before the first send, so method and body replay (tested). 401 bodies are cancelled before retrying. `dataOf` throws `ApiError` whenever openapi-fetch yields no `data`; `deleteSession` checks `response.ok` because a 204 has no data. `listSessions` omits `q` when absent (tested). Exporter output is byte-stable (`sort_keys`), and `test_writes_the_schema_as_sorted_json_with_lf_endings` asserts no `\r` and a trailing newline. Task 6 M3 fixed by comparing instants via `datetime.fromisoformat`.
3. **Cross-platform: pass.** `check-api.mjs` uses `cross-spawn` without a shell (`pnpm.cmd` on Windows), `mkdtempSync(join(tmpdir(), …))`, `node:path` only, CRLF-tolerant comparison, temp dir removed in `finally`. The exporter writes with `newline="\n"`. `gen:api` chains with `&&`, which works in `sh` and `cmd.exe`. Biome excludes both generated files, so `pnpm check` passes on every platform. Not executed on Windows.
4. **Security and data: pass.** Device token only to the API origin (above), never in URLs or logs; refresh at most once per request and shared across concurrent failures, so a stale token re-registers one learner, not several. `ApiError` carries the server's `{ detail }` only.
5. **Maintainability: pass, 2 Minor.** `client.ts` separates types, errors, the wrapper and the helpers; `byId`/`dataOf` remove repetition; the fake server in the tests is a real `typeof fetch` that records `Request`s and bodies. Generated files are clearly marked and guarded by `check:api` rather than hand-formatted.

## Findings

**Critical:** none.
**Important:** none (the token-scope gap would have been one; `6ae285b` closed it before findings were sent).

**Minor** (logged, non-blocking):

- **M1** `packages/shared/tests/api-client.test.ts:107-113`: the origin test covers the per-request `baseUrl` override only. A second case where an `api.use({ onRequest })` middleware rewrites the URL to another origin would pin the other way a request can leave `baseUrl`; the checker verified it manually, but the suite should own it.
- **M2** `pnpm-lock.yaml:830, 835`: `openapi-typescript` at the root auto-installs its `typescript` peer as `5.9.3` next to the workspace's `7.0.2`. Harmless today (documented in the report's decisions), but two compilers in one lock are easy to forget; revisit when `openapi-typescript` supports TypeScript 7, or pin the peer explicitly so the duplication is visible in `package.json`.

## Notes for later tasks (not findings)

- `baseUrl` must be an absolute URL; `createApiClient` throws at construction otherwise (documented on `ApiClientOptions.baseUrl`).
- If `refreshToken()` rejects (for example the server is down during re-registration), the helper rejects with that error, not `ApiError`/`UnauthorizedError`; the desktop's server-down state (Task 11) should treat any rejection as "unreachable".
- `pnpm check` does not yet run `check:api` or `check:i18n`; Task 15 wires them in.
- `DEFAULT_OUTPUT` in `export_openapi.py` assumes the editable (source) layout; `test_writes_to_the_shared_package_by_default` guards it.

## Round history

- Round 1 (2026-10-17): APPROVED at `6ae285b`. 0 Critical, 0 Important, 2 Minor.
