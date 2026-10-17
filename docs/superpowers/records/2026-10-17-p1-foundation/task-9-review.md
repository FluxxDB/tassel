# Task 9 review: device token store in the main process

**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 3 Minor.
**Range:** `27e19af..d36419b` on `claude/p1-desktop`: `6dd632d` (harness fix in Task 8's `fixtures.ts`) and `d36419b` (the store). Both conventional, both with the `Co-Authored-By` trailer.
**Also reviewed:** `cd4eb0a fix(shared): conventional Korean phrasing for library.empty.body`, the builder's fix for Task 2 Minor 4 (one string in `ko.json:23`; it lands with this track's merge since Task 2 was merged at `9bb9ff3`).
**Builder report:** `task-9-report.md`.

## Re-run in the worktree (09:29, head `cd4eb0a`, clean tree)

| Command | Result |
|---|---|
| `pnpm --filter @tassel/desktop test` | 5 files, 55 passed (15 token-store) |
| `pnpm check` | Biome 42 files clean; `tsc --noEmit` shared + desktop node/web/test, exit 0 |
| `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e shell` | 2 passed with the changed fixture and the new IPC wiring |
| `pnpm --filter @tassel/shared test && pnpm check:i18n` | 25 passed; catalogs complete and consistent after `cd4eb0a` |

## Verdicts per angle

1. **Spec: pass.** `Crypto` and `createTokenStore(deps)` have the brief's exact shapes (`token-store.ts:9-31`; `TokenStore` is the named return type). `getToken` returns the cache, else reads `device.bin` (safe) or `device.json` (file), else `POST {serverUrl}/v1/devices` and persists (`token-store.ts:52-131`); `refreshToken` always re-registers and overwrites; safe mode without encryption falls back to file and warns once (`token-store.ts:38-48`). `ipc.ts` handles `auth:getToken` and `auth:refreshToken` through the existing trusted-sender wrapper; `index.ts` passes `safeStorage`, `net.fetch` (through a one-line adapter, since `net.fetch` won't take a `URL`) and `readConfig().serverUrl`, after `whenReady` and after the userData override. The brief's five tests are present with the stated assertions. Accepted additions: shared in-flight load and registration, no cached failures, atomic writes with mode `0o600`, unreadable files replaced with a warning, `tokenStoreMode()` in `config.ts` rather than in the bridge's `AppConfig`.
2. **Correctness: pass.** I traced the state machine by hand: concurrent `getToken` calls share `loading`; `getToken` and `refreshToken` share `registering`, so writes to the `.tmp` file are serialized; a refresh that completes while `load()` is reading wins over the stale file (`token-store.ts:113-114`); a failed registration resets both promises in `finally`, so the next call retries from the file; `register()` caches and writes only after a non-empty string token arrives. The 15 tests check all of this with a counting fake server and a reversible XOR `Crypto`, so "never writes the raw token" is a real byte check and "file mode never touches safeStorage" fails on any call. The report's three mutations each break the expected tests. `ipc.test.ts` proves `auth:*` refusals never reach the store.
3. **Cross-platform: pass.** `rename` over an existing file is fine on Windows (Node uses replace semantics); `0o600` is ignored there, as the report says; temp directories come from `mkdtemp` under `tmpdir()`; `AbortSignal.timeout` and `Response.json` exist in Node 22+ and Electron 44's Node 24.
4. **Security and data: pass.** The token is the app's only credential and stays in the main process until the trusted renderer asks for it over the validated IPC channel; the handlers take no payload (`ipc.ts:8-12`). Safe mode stores only `safeStorage` ciphertext, and the temp file is ciphertext too; file mode is used only when `TASSEL_TOKEN_STORE=file` and never calls `safeStorage` (`token-store.ts:39`), so E2E and dev runs can't trigger a keychain prompt. Warnings and error messages carry no token. `safeStorage` is first touched after `ready`. No provider secrets anywhere.
5. **Maintainability: pass.** One 131-line module with a documented design; small named helpers (`mode`, `read`, `write`, `register`, `reregister`, `load`); the fixture change is minimal and keeps the default behavior (`fixtures.ts:33-45`).

## Harness change `6dd632d` (Task 8's `tests/e2e/fixtures.ts`)

`launchApp` now creates and deletes a temp userData only when the caller passes no `TASSEL_USER_DATA`; a caller-owned directory survives, so persistence specs can relaunch on it. Reviewed here rather than reopening Task 8: the default still matches the Task 8 brief, the shell spec passes unchanged, and the doc comment explains the two cases. No findings.

## Findings

### Minor (logged, not blocking)

1. `apps/desktop/src/main/token-store.ts:38-48`: `mode()` is re-evaluated on every read and write. If `isEncryptionAvailable()` flips during a session (a Linux keyring initializing late), the store would look for the other file and register a new device. Not reachable on macOS or Windows; latching the mode on first use would remove the case.
2. `apps/desktop/src/main/token-store.ts:62-70` (report decision 2): an unreadable token file is replaced with a warning that only the main-process console sees. The user gets no signal that their previous learner and library are orphaned. The server has no recovery endpoint, so this is the only sane recovery today; once the UI exists, surface it (an IPC event or a flag on `getToken`'s result).
3. `apps/desktop/src/main/token-store.ts:78-83`: every writer uses the same `${target}.tmp`. Safe today because `reregister()` serializes writes; a future second writer (a sign-out or "clear data" path) must go through the same gate or use a unique temp name. Worth a comment at the write site.

## Carried forward

- `refreshToken()` never revokes the old device (no server endpoint); after a refresh the old token stays valid server-side until a reset. Builder's concern, matches the brief.
- Safe mode is covered only with the fake `Crypto`; the real keychain path is exercised manually, by design.
- Task 11's server-down E2E depends on `getToken()` rejecting rather than hanging: the 10 s `AbortSignal.timeout` plus `net.fetch`'s connection refusal cover it.

## Round history

- Round 1 (checker, 09:3x): APPROVED, 3 Minor.
- Round 2 (builder `776a32c`, verified 09:33): Minor 1 fixed, `mode()` settles `resolvedMode` on first use (`token-store.ts:35-51`), so a keyring flip can no longer split reads and writes; the warn-once flag is subsumed. The new test `keeps the mode it started with when encryption availability changes` flips availability after the first call and asserts `device.bin` holds the refreshed token with no `device.json`; it failed RED with `ENOENT device.bin` before the fix. Minor 3 addressed with the invariant comment on `write()` (`token-store.ts:75-79`). Minor 2 stays open for the UI tasks. At head: desktop 56/56, `pnpm check` 0, build + shell E2E 2/2, shared 25/25, `check:i18n` 0, clean tree. Verdict unchanged: APPROVED.
