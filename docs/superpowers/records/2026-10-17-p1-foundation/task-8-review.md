# Task 8 review: Electron shell and E2E harness

**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 5 Minor.
**Range:** `9bb9ff3..27e19af` on `claude/p1-desktop` (one commit, conventional message, `Co-Authored-By` trailer present).
**Builder report:** `task-8-report.md`.

## Re-run in the worktree (09:23, on the committed tree)

| Command | Result |
|---|---|
| `pnpm install` | already up to date; `apps/desktop/node_modules/electron/dist` exists, `dist/version` = `44.9.0` |
| `pnpm --filter @tassel/desktop build` | `out/main/index.js`, `out/preload/index.js` (0.60 kB), `out/renderer/{index.html, assets/index-*.js}` |
| `pnpm --filter @tassel/desktop e2e shell` | skip notice for the absent `services/server` (R8), then 2 passed (2.5 s); `test-results/screens/p1-shell.png` written |
| `pnpm test` | shared 25/25, desktop 4 files / 34 tests |
| `pnpm check` | Biome 40 files clean; `tsc --noEmit` for shared, and desktop node/web/test, exit 0 |

The builder's Task 9 edits in the shared worktree are all timestamped 09:25 or later and `out/` was rebuilt at 09:27, so the run above exercised exactly `27e19af`. The screenshot is 2880×1800 (1440×900 at 2x): bone canvas with the placeholder `Tassel` heading.

Install facts behind rulings R9 and R10, checked in `apps/desktop/node_modules/electron`: `package.json` has no `scripts` and exposes `bin.install-electron → install.js`; `install.js` returns early when `dist/version` already matches (lines 14, 58–60) and verifies the download against the bundled `checksums.json` unless `electron_use_remote_checksums` is set (lines 45–48). The lockfile pins `electron@44.9.0` exactly.

## Verdicts per angle

1. **Spec: pass.** Every file in the brief exists; `bridge.ts` has the brief's types verbatim plus the `IPC` channel constants; `createMainWindow` matches the size, minimum, bone background, `show: false` until `ready-to-show`, macOS `hiddenInset` at {20, 18}, and the `hidden` + overlay chrome elsewhere (`windows.ts:334-384`); `readConfig` has the brief's defaults and language fallback chain (`config.ts:181-206`); the CSP is the brief's string exactly, and survives the Vite build with no inline script (`out/renderer/index.html`); `launchApp` sets the four env values and `snap` writes `test-results/screens/<name>.png` (`fixtures.ts:511-548`); global setup polls `/v1/health` for 30 s, tears the server down, and uses `cross-spawn` (`global-setup.ts`). R5 `typecheck`, R8's conditional server start and R11's `tassel_e2e` are in place. Accepted deviations: `app-protocol.ts` split out of `index.ts` (makes the traversal guard unit-testable; `index.ts` still registers it), `applyUserDataOverride` split from `readConfig` (keeps `readConfig` pure), `tsconfig.test.json`, every dependency a devDependency so electron-vite bundles them all, `productName: "Tassel"`, and the brief's `any` cast replaced by a typed cast with identical behavior.
2. **Correctness: pass.** 34 unit tests cover the config matrix (defaults, each `TASSEL_*` variable, system-language fallback, invalid speed and tutor values, trailing slashes), the traversal guard (`%2e%2e%2f`, `..%2f`, `..%5c`, `%00`, other host, malformed escape), `isTrustedUrl` (evil host, https, file, dev server only when unpackaged) and IPC sender validation (foreign origin, `app://evil`, null frame). The second E2E test checks the IPC round-trip, that the CSP blocks an inline script, `window.open` → null, and that a navigation attempt leaves `app://tassel/index.html` as the only window. The report's four mutations each break the expected tests. Extra cases I traced by hand in `resolveAppFile`: uppercase `%2F` decodes the same way, an overlong or truncated escape throws `URIError` → null, a Windows drive-letter path after `resolve` is caught by `isAbsolute(relative(...))`, and `app://tassel` with an empty path maps to `index.html`.
3. **Cross-platform: pass.** `postinstall: install-electron` runs through pnpm's bin shim on Windows; `&&` in `typecheck` works in cmd; `cross-spawn` for `uv`, `spawn.sync` with a finite timeout; `mkdtemp` under `tmpdir()` and `rmSync` with `maxRetries` for Windows file locks; the traversal check uses `sep`/`isAbsolute` and rejects `\`; unit tests build paths with `resolve`/`join`. Open: Windows teardown of the `uv` child (Minor 5).
4. **Security and data (Electron angle): pass.**
   - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (`windows.ts:343-348`) plus `app.enableSandbox()` before ready (`index.ts:234`); the E2E asserts `typeof require === 'undefined'`.
   - The preload exposes exactly `{ platform, getConfig, getToken, refreshToken }` through `contextBridge` and never `ipcRenderer` (`preload/index.ts:396-403`); the built preload requires only `electron`; the built main requires only `electron`, `node:path`, `node:url`.
   - Every `ipcMain.handle` goes through a wrapper that refuses senders whose `senderFrame.url` isn't the renderer origin, including a destroyed (null) frame (`ipc.ts:283-293`). No handler takes arguments yet; Task 9's `auth:*` take none either. The first handler with a payload must validate it in the wrapper; I'll check that in Task 9.
   - `isTrustedUrl` compares protocol and host, not `origin`, because Node reports `origin: "null"` for `app://` URLs (`windows.ts:322-332`); the dev URL is trusted only when `!app.isPackaged`.
   - `app://` is registered `standard` + `secure` + `supportFetchAPI` (no `bypassCSP`), and `resolveAppFile` confines every request to `out/renderer` (`app-protocol.ts:147-163`).
   - `setWindowOpenHandler` denies, `will-attach-webview` is prevented, `will-navigate` is limited to the renderer origin, and permission request/check handlers are scoped to that origin (`windows.ts:358-374`).
   - No provider secrets: `config:get` returns only `serverUrl`, `uiLanguage`, `tutorMode`, `fakeScript`, `fakeSpeed`. E2E runs set `TASSEL_TOKEN_STORE=file`.
   - Supply chain: the exact `44.9.0` pin, the checksum-verified installer and the one-day `minimumReleaseAgeExclude` are per R9/R10.
5. **Maintainability: pass.** One responsibility per module; IPC channel names live in one place shared by preload and main; the `BONE`/`INK` duplication from `tokens.css` is commented (main can't import CSS). No dead code found; `E2E_SERVER_URL` and `APP_ENTRY_URL` are both consumed.

## Findings

### Minor (logged, not blocking)

1. `apps/desktop/src/main/windows.ts:367-374`: the permission handlers grant every permission type to the trusted origin. An explicit allowlist (`media`, `display-capture`, clipboard) would be tighter defense in depth. Safe today because the renderer runs only first-party code under the strict CSP, and macOS TCC still prompts.
2. `apps/desktop/src/main/windows.ts:358-364`: `will-navigate` covers main-frame navigations only; `will-redirect` and `will-frame-navigate` aren't guarded. No exposure now (the app protocol never redirects, and `default-src 'self'` limits frames to the app origin); worth adding when remote content ever enters a frame.
3. `apps/desktop/src/main/app-protocol.ts:159-162`: a directory path such as `app://tassel/assets` reaches `net.fetch(file://…)` unchecked. Whatever Chromium's file loader returns for a directory stays inside the renderer root, so it's only tidiness: a `stat` check returning 404 for non-files.
4. `apps/desktop/tests/e2e/fixtures.ts:554-563`: `inheritedEnv` strips `TASSEL_*` and `ELECTRON_RUN_AS_NODE` but not `ELECTRON_RENDERER_URL`. A stray value in a developer's shell would make the unpackaged E2E app load and trust that URL; the shell spec's `location.protocol` assertion would fail loudly, so this is robustness only.
5. `apps/desktop/tests/e2e/global-setup.ts:623-637` and `689-696`: the spawned server has no `'error'` listener (an async spawn failure would surface as an unhandled error rather than an `[e2e]` message; unlikely, since `uvSync` has already run `uv` by then), and Windows teardown relies on `uv.exe` taking its Python child down, which can't be verified here. The builder flagged the second point. Carry both to Task 15 (CI).

## Carried forward

- Once `services/server` is merged, the E2E needs Postgres already running on 54329; global setup doesn't run `docker compose`. Task 15's CI plan (E2E on `macos-latest`, no Docker) must account for this.
- Electron fuses and packaging are out of scope; `ELECTRON_RUN_AS_NODE` is only stripped in the E2E fixture.
- The renderer bundle is unminified (565 kB) by electron-vite's default; loaded from disk, fine for now.
- `<h1>Tassel</h1>` is a literal; Task 10 replaces it with i18n keys.
- `@types/node` is 24 in desktop (Electron 44 bundles Node 24.22) and 22 in shared (the tooling floor): intentional, two lockfile entries.
- Remove `minimumReleaseAgeExclude` in Task 15 once `44.9.0` ages past the window (R10).

## Round history

- Round 1 (checker, 09:3x): APPROVED, 5 Minor.
- Addendum: `6dd632d` later changed `tests/e2e/fixtures.ts` so `launchApp` keeps a caller-provided `TASSEL_USER_DATA` (the default temp directory and its cleanup are unchanged). Reviewed under Task 9 (`task-9-review.md`); the shell spec still passes.
- Minor 4 fixed in `b4c01b5` (`fixtures.ts:68-80`: `inheritedEnv` now strips `ELECTRON_RENDERER_URL` as well). Verified 09:3x: shell spec 2/2 at head, and 2/2 with `ELECTRON_RENDERER_URL=http://127.0.0.1:9` in the runner's environment; Biome and typecheck clean. Minors 1, 2, 3 and 5 stay as logged.
