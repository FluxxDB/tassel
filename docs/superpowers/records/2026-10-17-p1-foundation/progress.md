# SDD ledger — plan: docs/superpowers/plans/2026-10-17-p1-foundation.md

Spec: docs/superpowers/specs/2026-10-17-tassel-design.md (reachable). Branch: claude/p1-foundation (base 66f52b3, docs-only commit).
Models: implementers fable (mechanical/standard) or opus (UI/integration-heavy); reviewers fable for small diffs, opus for large; final review opus. The user named Opus 5.5 / Fable 5.1 for sub-teams.

## Pre-flight scan

### Cross-task pairs (shared file or interface)

| Pair | Produces → consumes | Finding |
|---|---|---|
| T1 ↔ T2 | T1 `packages/shared/package.json` exports `./i18n` → T2 creates `src/i18n/index.ts` | consistent (export points at a later file; fine) |
| T1 ↔ T10 | tokens.css / fonts.css / base.css → global.css imports `@tassel/shared/*.css` | consistent |
| T2 ↔ T8, T10 | `Lang` type → bridge `AppConfig.uiLanguage`, `initI18n(lang)` | consistent |
| T3 ↔ T4 | `create_app(settings)` → T4 needs an engine on `app.state` for `get_db` | **conflict:** T4's file list omits `app.py` → Ruling R1 |
| T3 ↔ T5, T6 | `create_app` → routers must be registered | **conflict:** T5/T6 file lists omit `app.py` → Ruling R1 |
| T4 ↔ T8 | test DB `tassel_test` + migrations → E2E global setup starts the server on `tassel_test` | gap: E2E must create and migrate the DB itself → Ruling R2 |
| T5 ↔ T6 | `current_learner` → sessions routes | consistent |
| T6 ↔ T7 | Pydantic `SessionOut` etc. → `components['schemas']['SessionOut']` | consistent (model names are the contract) |
| T7 ↔ T15 | `check:api` runs `scripts/check-api.mjs` → T15 says it creates that file | **conflict:** T7 Step 4 runs `pnpm check:api` before T15 → Ruling R3 |
| T7 ↔ T9 | client `refreshToken` → token store `refreshToken` via bridge | consistent |
| T7 ↔ T11–T14 | `listSessions/createSession/getSession/patchSession`, `Session`, `Source` | consistent (Source/SessionType exports added to T7 before dispatch) |
| T8 ↔ T9 | `ipc.ts` (T8 creates, T9 modifies) | consistent |
| T8 ↔ T11–T14 | `launchApp`, `snap` fixtures | consistent; T11 E2E needs `getToken` from T9 (T9 precedes T11) |
| T10 ↔ T11–T14 | `useRoute`, base components, `useApi` | consistent |
| T13 ↔ T14 | `useStageStore`, `StageMode`, `TutorState` → `TutorEvent` | consistent |
| T13 ↔ T14 | T14 "title events update the session query cache" → T13 has no query cache | **gap** → Ruling R4 |
| T1/T8 ↔ T15 | `check` runs `pnpm -r typecheck` → packages need a `typecheck` script | gap → Ruling R5 |

### Per-task self-consistency

| Task | Tests vs code / files | Finding |
|---|---|---|
| T1 | Step 4 says "PASS (13 tests)"; the test code as written yields 15 (9 + 1 + 1 + 1 + 3) | count typo → Ruling R6 |
| T2 | expected error strings match the `checkCatalogs` contract | consistent |
| T3 | CORS preflight test with `Origin: app://tassel` vs `CORSMiddleware` exact-match origins | consistent |
| T4 | needs a `db` fixture (stated in Step 3) | consistent |
| T5 | uses `client` / `db` fixtures from T4 | consistent |
| T6 | `auth(client)` helper defined in the step | consistent |
| T7 | "middleware retries on 401": openapi-fetch middleware can't re-issue requests | implementer's choice (wrap fetch); not a conflict |
| T8 | `toHaveTitle('Tassel')`, `location.protocol === 'app:'` → built app must load via `app://` | consistent |
| T9 | consistent | — |
| T10 | tests use `bg-ink`, `text-paper`, `rounded-pill` → Tailwind utilities from T1 tokens | consistent |
| T11 | the server-down E2E launches with an unreachable server, so device registration fails too | must render the error state, not crash → carried in dispatch |
| T12 | consistent | — |
| T13 | `useElapsed(start)`: the plan doesn't say what `start` is | gap → Ruling R7 |
| T14 | consistent apart from R4 | — |
| T15 | pushes the branch: user-approved for `claude/*` branches | consistent |
| Global | Electron pinned exactly 44.9.0 (macOS grants tied to this ad-hoc binary) | carried in the T8 dispatch |

### Rulings

- R1: Ruling: T4, T5 and T6 may modify `services/server/src/tassel/app.py`. T4 adds a lifespan that creates the engine on `app.state`; T5/T6 include their routers. — Why: the plan's file lists omitted the wiring point every server task needs. — Cost if wrong: none; it's a single-file wiring change.
- R2: Ruling: T8's E2E global setup creates `tassel_test` if missing and runs `alembic upgrade head` before starting the server; alembic `env.py` (T4) reads the URL from `Settings` (env `TASSEL_DATABASE_URL`). — Why: the E2E server needs a migrated DB, and T4's pytest fixtures don't run under Playwright. — Cost if wrong: E2E setup duplication, easy to refactor.
- R3: Ruling: T7 creates `scripts/check-api.mjs`; T15 only references it. — Why: T7 runs `pnpm check:api` in its own verification. — Cost if wrong: none.
- R4: Ruling: T13 adds a small Zustand store `features/session/current-session.ts` (`useCurrentSession`: `{ session: Session | null; load(id); patchLocal(p: Partial<Session>) }`). T14's `useTutorSession` applies title events via `patchLocal`. There is no React Query. — Why: the plan names a "query cache" that no task creates. — Cost if wrong: a later swap to a data-fetching library touches 2 files.
- R5: Ruling: T1 adds `"typecheck": "tsc --noEmit -p ."` to `@tassel/shared`; T8 adds `typecheck` to `@tassel/desktop`. — Why: T15's `check` script calls `pnpm -r typecheck`. — Cost if wrong: none.
- R6: Ruling: T1's expected count is 15 tests; the test code governs. — Why: the "13" is an arithmetic slip. — Cost if wrong: none.
- R7: Ruling: the session timer counts from when the session screen mounts (the live session start), not from `created_at`. — Why: reopening an old session would otherwise show hours, and the spec's timer is the live session's. — Cost if wrong: one-line change.

## Progress
Task 1: dispatched (implementer fable, BASE 66f52b3)
Task 1: attempt 1 stalled (fable; no repo changes, last seen doing a scratch install outside the repo); stopped 09:02. Ruling: re-dispatch on opus with time-box and non-interactive command rules — Why: no output for that long means the agent was waiting on a hung/background command — Cost if wrong: one extra dispatch.
Task 1: retry dispatched 09:04 (implementer opus). Controller docs commit d9f4ea4 landed before any Task 1 work, so Task 1 review BASE = d9f4ea4.
Controller docs commit f183ea6 (research 05) landed before any Task 1 work, so Task 1 review BASE = f183ea6.
Pending: move .superpowers/pending-docs/05a-chemistry-verification-tooling.md into docs/research/ after Task 1 review (kept out of Task 1's diff).
Task 1: implementer DONE_WITH_CONCERNS (009f2fe; 15/15). Concerns: geist's next peer marked optional; esbuild not installed so allowBuilds untested until Task 8; extras .gitattributes (LF) + OFL license files + biome excludes. Review dispatched (fable) on f183ea6..009f2fe.
Task 1: review Approved (spec ✅; 0 Critical/Important). ⚠️ trailer verified present on 009f2fe; ⚠️ allowBuilds unexercised → carried to Task 8 (verify electron/dist exists); ⚠️ node -e placeholder scripts → replaced in Task 15.
Task 1: minor (deferred): .mono beats :lang(ko) letter-spacing in ko docs — Ruling: Hangul lab labels must be untracked; add '.mono:lang(ko){letter-spacing:0}' in Task 10 — Why: tracking hurts Hangul (research 04) — Cost if wrong: one CSS line.
Task 1: minor (deferred): font tests check existence only (could check wOF2 magic).
Task 1: minor (deferred): copy-fonts.mjs resolves via hard-coded packages/shared/node_modules (hoisting-sensitive).
Task 1: minor (deferred): leftover path comment line 1 of tokens.test.ts.
Task 1: complete (commits f183ea6..009f2fe, review clean)
Orchestration change (user direction 09:0x): parallel peer teams in worktrees — builder (opus) + checker (fable) message each other directly, report only to controller. Team Server: Tasks 3–6 in .claude/worktrees/p1-server (branch claude/p1-server from 9df0f00). Team Desktop: Tasks 2, 8, 9 in .claude/worktrees/p1-desktop. Merge into claude/p1-foundation, then Task 7 and the UI tasks.
Team Server launched: checker fable, builder opus (worktree p1-server @ 9df0f00).
Team Desktop worktree p1-desktop @ 1dfa537 (branch claude/p1-desktop): Tasks 2, 8, 9.
Ruling R8: Task 8 E2E global setup starts/migrates the server only if services/server exists (tracks run in parallel) — Why: keeps Desktop independent of Server until merge — Cost if wrong: one conditional in global-setup.
Team Desktop launched: checker fable, builder opus.
Codex/Astra unavailable: user's Codex usage limit exhausted until 2026-10-23 02:53; teams use Opus 5.5 + Fable 5.1.
Task 3: complete (commits 9df0f00..fb025cd, team-checker approved; branch claude/p1-server)
Task 3: minor (deferred): truthiness idiom app.py:12; duplicated client setup in test_health.py
Task 3: note: +6 extra tests (later test counts shift); Windows selector-event-loop override for psycopg verified from sources, not run on Windows (→ CI windows job in Task 15)
Task 2: complete (commits 1dfa537..9bb9ff3, team-checker approved; branch claude/p1-desktop; 25/25 shared tests, check:i18n + pnpm check clean)
Task 2: minor (deferred): 4 minors in task-2-review.md
Task 2: note: root engines.node tightened to >=22.18 (native TS type stripping runs check:i18n without tsx); @tassel/shared adds runtime dep @formatjs/icu-messageformat-parser@3.5.21 (same version i18next-icu pins) — accepted
Ruling R9: @tassel/desktop gets postinstall 'install-electron' (electron@44.9.0 ships no install script; allowBuilds alone can't fetch dist) — Why: dist must exist after pnpm install on Mac and Windows — Cost if wrong: one script line.
Ruling R10: keep pnpm 12's minimumReleaseAgeExclude [electron@44.9.0] (published 2026-10-17 05:50Z) — Why: macOS camera/mic grants are tied to that exact ad-hoc binary, and Electron's installer checksum-verifies the download — Cost if wrong: small supply-chain exposure for one day. Remove the exclusion in Task 15 once the version ages past the window.
Task 4: complete (commits fb025cd..5e5feca, team-checker approved; 16 tests + ruff; R2 alembic env path verified)
Task 4: minor (deferred): sessions.learner_id has no ON DELETE CASCADE (brief-literal) — revisit when 'delete all my data' (privacy) lands
Task 4: accepted deviations: sqlalchemy[asyncio] extra (SQLAlchemy 2.1 greenlet), pytest-asyncio>=1.4, compose port bound to 127.0.0.1
Ruling R11: the E2E database is tassel_e2e, not tassel_test (overrides the Global Constraint) — Why: pytest owns tassel_test; Playwright and pytest must run concurrently — Cost if wrong: one env var. Sent to the desktop builder for Task 8.
Task 5: complete (commits 5e5feca..70310c3, team-checker approved; 29 tests; hash-only tokens, constant 401)
Ruling R12: Task 6 also switches current_learner to HTTPBearer(auto_error=False), so OpenAPI declares a bearer securityScheme, and types MeOut.ui_language as Lang — Why: Task 7 generates the TS client from this schema; an optional header param on every operation pollutes the types — Cost if wrong: small; same auth behavior, covered by a test.
Task 6: complete (commits 70310c3..e34dac2, team-checker approved; 56 tests; HTTPBearer DeviceToken scheme, migration 0002)
Task 6: minor (deferred): 3 minors in task-6-review.md
Merged claude/p1-server (Tasks 3–6) and Task 2 (9bb9ff3) into claude/p1-foundation → 0237df2. Verified there: shared 25/25, check:i18n OK, server 56 passed, ruff clean.
Task 7: assigned to Team Server (worktree p1-server; first fast-forward to claude/p1-foundation 0237df2). Contract notes: path param {session_id}; SessionPatch type/language must not advertise null (SkipJsonSchema); timestamps Z with microseconds; DELETE returns an empty 204.
Tasks 8 + 9: built by desktop builder (27e19af, 6dd632d fixture fix, d36419b), awaiting checker review. E2E server path verified against a copy of the server code (tassel_e2e).
Ruling R13 (for Task 15): CI E2E runs on ubuntu-latest (xvfb + a pgvector service container) because macOS runners have no Docker; macOS and Windows CI run check + unit tests; Windows process-tree shutdown of the uv server gets a CI smoke test — Why: E2E needs Postgres — Cost if wrong: CI config only.
Task 8: complete (commits 9bb9ff3..27e19af, team-checker approved; electron/dist 44.9.0 present; e2e 2/2; Electron security clean; CSP enforced by an E2E test; app:// traversal guard unit-tested). Task 1's allowBuilds ⚠️ closed via R9.
Task 8: minor (deferred): 5 minors in task-8-review.md
Task 8: accepted deviations: app-protocol.ts split out, applyUserDataOverride split from readConfig, tsconfig.test.json, desktop deps all devDependencies (bundled), tassel_e2e per R11
Task 9: complete (commits 27e19af..d36419b, team-checker approved; 55/55 desktop, e2e 2/2). Includes 6dd632d (Task 8 fixture fix, addendum in task-8-review.md) and cd4eb0a (Task 2 minor: ko string).
Task 9: minor (deferred): 3 minors in task-9-review.md, incl. no UI signal yet for an orphaned learner after an unreadable token file (→ UI tasks)
Task 8: post-approval fix b4c01b5 (e2e ignores inherited ELECTRON_RENDERER_URL)
Merged claude/p1-desktop (Tasks 8, 9 + follow-ups) into claude/p1-foundation → 362fa27. Verified there: shared 25/25, desktop 55/55, pnpm check 0, build OK, e2e 2/2 with the real server on tassel_e2e. Pushed.
Session surface brief + direction contract recorded via impeccable (apps/desktop/.impeccable/surfaces/…sessionscreen…md), seed:73b7d851c29a5f41, committed 20322a1. Library screen and new-session sheet extend the established world (no concept round) — Ruling: the plan's layouts stand; the owner is away and these are conventional Operate surfaces — Cost if wrong: layout rework on two screens.
Task 9: round 2 fix 776a32c (token store settles its safe/file mode once per launch) verified by the checker; merged into foundation (desktop 56/56).
TRACK desktop DONE (776a32c), merged. Carried forward: (a) Task 15: E2E Postgres in CI (R13), Windows uv teardown smoke test, remove minimumReleaseAgeExclude (R10); (b) future IPC handlers with arguments validate payloads in handle(); (c) UI (Task 11): show a one-time notice when an unreadable token file forced a fresh learner (bridge needs a flag) — Ruling: add 'tokenReset: boolean' to AppConfig in Task 11 — Cost if wrong: small.
Task 7: complete (commits 0237df2..6ae285b, team-checker approved; 36 shared, 59 server; check:api drift guard; refresh once and shared across concurrent 401s; token only to baseUrl origin)
Task 7: minor (deferred): origin test covers only the per-request override case; lock carries typescript 5.9.3 next to 7.0.2 as openapi-typescript's peer
Task 7: note for UI tasks: a rejecting refreshToken surfaces its own error (not ApiError/UnauthorizedError), so the library's error state must catch any error
TRACK server DONE (Tasks 3–7). Merged into foundation → a0f1448.
Correction: the Task 7 merge needed lockfile resolution (pnpm auto-resolve); merge commit 0323eb6. Verified on foundation: shared 36, desktop 56, server 59, check/check:api/check:i18n 0, e2e 2/2. Pushed.
Ruling R14: Task 10 makes the E2E server port configurable (TASSEL_E2E_PORT, default 8799, read in tests/e2e/fixtures.ts) — Why: the app tester and design reviewer run E2E in their own checkouts while the builder does, and global-setup refuses an occupied port — Cost if wrong: one line.
Ruling R15: a UI task (10–14) is complete when three peers pass it at its final head: code checker APPROVED, app tester QA PASS, design reviewer DESIGN PASS; each reports its own verdict to main — Why: the user asked for checks from multiple angles, with peers and no hierarchy, and for testing each feature by using the app — Cost if wrong: slower approvals.
Team UI: worktrees p1-ui (builder, branch claude/p1-ui), p1-ui-qa and p1-ui-design (detached) all at 0323eb6, deps installed. Charter addendum teams/ui-team.md. Tasks 10–14 BASE 0323eb6.
Team UI launched 09:45: builder opus, code checker fable, app tester fable, design reviewer opus (ids in teams/ui-team.md roster).
Ruling R16: title events update the strip via patchLocal and persist via patchSession(id, {title, subject}) — Why: spec §5.1 makes titles session data the library shows; P1 has no server-side titler yet — Cost if wrong: one redundant PATCH, dropped in P2.
Ruling R17: the Board control cycles Paper pinned → Split pinned → Board pinned → Follow Ada (unpin) with a visible pin indicator and Unpin action — Why: the store has unpin() but no task gave it a control, and the contract says requests wait until she unpins — Cost if wrong: small UI rework.
Ruling R18: End session is the only exit from the session screen after Task 13; P1 binds M/B/C only (Space → P2, S → P7) and shows Share disabled — Why: the contract's title strip has no back control; spec §6 shortcuts belong to later features — Cost if wrong: one control.
PAUSED 09:59 at the owner's request: every agent told to pause (builder mid-Task 10 with uncommitted work in p1-ui; P2/P3 plan drafts in progress); watchdog cron 84cba224 deleted so nothing restarts. Resume needs an explicit owner go-ahead.
During the pause: builder's TASK 10 READY (0323eb6..80fc749) reached the peers just before the pause took effect; no review started. Design checklist and mock captures were finished (design/checklist.md, design/mock/).
Builder stopped 10:01 with a clean tree at 80fc749 (it hadn't acknowledged the pause message).
All agents stopped by 10:01: builder, tester, P3 planner and one research helper via TaskStop after not acknowledging the pause; the rest paused themselves. No app windows or test servers left running. Tester's checkout had moved to 80fc749 (it may have a partial install). P2 planner wrote no file yet; P3 planner's draft, if any, is uncommitted.
Pushed 10:04 at the owner's request: claude/p1-foundation 0323eb6 (already current), claude/p1-server 6ae285b, claude/p1-desktop 776a32c, claude/p1-ui 80fc749 (Task 10, unreviewed). SDD workspace stays local (git-ignored).
