# Task 2 review: i18n catalogs and completeness check

**Verdict:** APPROVED (round 1). 0 Critical, 0 Important, 4 Minor.
**Range:** `1dfa537..9bb9ff3` on `claude/p1-desktop` (one commit, conventional message, `Co-Authored-By` trailer present).
**Builder report:** `task-2-report.md`.

## Re-run in the worktree

| Command | Result |
|---|---|
| `pnpm --filter @tassel/shared test` | 2 files, 25 passed (15 tokens + 10 i18n), exit 0 |
| `pnpm check:i18n` | "complete and consistent", exit 0 |
| `pnpm check` (`biome check . && pnpm -r typecheck`) | 16 files clean; `tsc --noEmit` exit 0 |

Mechanical catalog check (read-only script, outside the repo): 55 leaf keys in `en`, `es` and `ko`, in the same order; every key the brief lists is present (`app.name`, `newSession.language.en|es|ko`, `errors.network|server|unknown` fill the `*` namespaces) and nothing beyond them; all six fixed strings match Global Constraints byte for byte (including the ASCII apostrophe in "isn't"); `session.timer` is the only ICU message and uses `{elapsed}` in all three; LF line endings, no BOM, trailing newline.

## Verdicts per angle

1. **Spec: pass.** `SUPPORTED_LANGS`, `Lang`, `resources` and `checkCatalogs(catalogs: Record<Lang, object>): string[]` have the brief's exact signatures (`index.ts:18-40`). The two problem formats from the brief are produced verbatim; the brief's four tests are present unchanged apart from Biome formatting (`tests/i18n.test.ts:6-39`). Root `check:i18n` replaces the Task 1 placeholder (`package.json:15`). The three additional problem kinds (`extra`, `invalid ICU`, `not a string`) are justified: without `extra`, a key present only in es/ko would pass while the en UI showed a raw key, which breaks the "fails on any missing key" constraint. Deviations weighed: see Minor 2 and 3.
2. **Correctness: pass.** `en` is the reference; missing keys, extra keys and argument-name mismatches are reported per language; nested plural/select arguments are collected and branch text is not mistaken for a placeholder (`index.ts:102-118`). Broken or non-string messages are recorded as `null` so they are reported once and never compared (`index.ts:63-82`). The report's mutation evidence (regex swap fails two tests; tsconfig guards reject `enum` and bare type imports) shows the tests are not vacuous. Edge cases I traced by hand: a string in `es` where `en` has a subtree yields `missing` plus `extra`; arrays are leaves and reported as `not a string`; an invalid `en` message suppresses mismatch reports for that key in other languages.
3. **Cross-platform: pass.** The CLI is `node packages/shared/scripts/check-i18n.ts` (no shell, forward slashes, fine on Windows); the CLI test spawns `process.execPath` without a shell and builds the path with `join` (`tests/i18n.test.ts:74-75`). JSON imports use `with { type: 'json' }`, which Node, Vite and Vitest all accept. Requires Node ≥ 22.18 for native type stripping (see Minor 2).
4. **Security and data: n/a.** Static catalogs, one pure dependency (`@formatjs/icu-messageformat-parser@3.5.21`, transitive `icu-skeleton-parser@2.1.12` only, lockfile delta reviewed). No secrets, no I/O beyond reading the catalogs.
5. **Maintainability: pass.** `index.ts` carries both the resources and the checker. The builder's reason holds: a relative `./check.ts` import would force `allowImportingTsExtensions` onto every consumer's tsconfig, because consumers type-check the shared source directly. The file stays small and documented. The CLI is 17 lines and sets `process.exitCode` instead of calling `process.exit()`.

## Findings

### Minor (logged, not blocking)

1. `packages/shared/tests/i18n.test.ts:72-78`: the CLI test covers only the exit-0 path. The brief's "exits 1 with a list when problems exist" is evidenced manually in the report, not by an automated test. A catalog-directory argument or env override would make the failure path testable without touching the shipped catalogs.
2. `package.json:6`: `engines.node` tightened from `>=22` to `>=22.18` so Node runs the `.ts` CLI without a flag. This stays inside the "Node ≥ 22" constraint and `.node-version` (`22`) still resolves to a current 22.x, but it edits a Task 1 file and narrows the floor; the controller may want it in the ledger. On 22.x builds, Node may still print an `ExperimentalWarning` for type stripping to stderr; cosmetic, and the CLI test's stderr pattern would not match it. Worth a glance on the Windows machine.
3. `packages/shared/src/i18n/index.ts:4-16`: the ICU parser is imported at the top of the module every consumer loads via `@tassel/shared/i18n`, though only `checkCatalogs` needs it. Acceptable because Task 10's `i18next-icu` → `intl-messageformat` pins the same `3.5.21`, so the renderer bundle carries one copy either way. Task 10's reviewer should confirm the lockfile still shows a single version.
4. `packages/shared/src/i18n/ko.json:23` (copy): "세션은 여기에 모여요" is colloquial; "세션은 여기에 표시돼요" is the conventional UI phrasing. `ko.json:12` "내 세션" for "Your sessions" follows Korean UI convention and is fine. Spanish reads naturally throughout. The literal tutor name "Ada" in `library.empty.body` (all three files) is already noted by the builder as a future `{tutorName}` argument.

## Carried forward

- Tasks 10–14 add their own keys to all three catalogs; `pnpm test` and `pnpm check:i18n` enforce completeness.
- Task 8's main-process build will be the first bundler (electron-vite) to compile `index.ts` with JSON import attributes, if it imports `SUPPORTED_LANGS` for `readConfig`. I will check it there.

## Round history

- Round 1 (checker, 09:0x): APPROVED, 4 Minor.
- Minor 4 fixed in `cd4eb0a` (`ko.json:23` now reads "세션은 여기에 표시돼요"). Verified 09:29: shared 25/25 and `check:i18n` exit 0. Minors 1, 2 and 3 stay as logged.
