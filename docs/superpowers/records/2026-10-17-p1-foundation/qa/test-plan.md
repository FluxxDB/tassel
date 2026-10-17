# QA test plan: UI track (Tasks 10–14)

App tester. Checkout `.claude/worktrees/p1-ui-qa` (detached, never commits). Written at base `0323eb6`, before `TASK 10 READY`; E2E starts once Task 10 lands `TASSEL_E2E_PORT` (R14). The builder may read this: charters are what I will try, not claims about what the app does.

## Method, per task

1. **Sync and build:** `git checkout --detach <head7>`; `pnpm install --frozen-lockfile` if `pnpm-lock.yaml` changed; `pnpm --filter @tassel/desktop build`. Once per task, `pnpm --filter @tassel/desktop test` for the baseline.
2. **Run** the task's own specs, then mine, always with `TASSEL_E2E_PORT=8899 TASSEL_E2E_DATABASE_URL=postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_qa pnpm --filter @tassel/desktop e2e <name>`. Before a run: nothing answers 127.0.0.1:8899 (global-setup refuses an occupied port) and the `tassel` Postgres container is up.
3. **My specs** are untracked `apps/desktop/tests/e2e/qa-<task>-<topic>.spec.ts`, sharing an untracked `qa-helpers.ts`:
   - `launchQa(env, { width, height, lang })` wraps `launchApp`, sets `TASSEL_UI_LANG`, sizes the window with `BrowserWindow.setContentSize` (`page.setViewportSize` isn't reliable for Electron) and attaches `console` and `pageerror` collectors;
   - `qaSnap(page, task, screen)` writes `$WS/qa/task-<N>/<screen>-<width>-<lang>.png`;
   - `seed(...)`: Node `fetch` against `http://127.0.0.1:8899/v1/sessions` with the token from `window.tassel.getToken()`; `PATCH` for titles and subjects, `DELETE` to make a card stale; `age(id, interval)`: SQL on `tassel_qa` through `docker compose exec db psql`, for the `last_activity_at` values the API can't set.
4. I open every PNG and look at it before writing the record.
5. **Record:** `$WS/qa/task-<N>-qa.md` (steps, expected, actual, screenshot, severity), a line in `teams/ui-log.md`, findings to the builder as `TASK <N> QA FINDINGS (round R)`, and `TASK <N> QA PASS: <head7>; screenshots <dir>; minors: <n>` to main and the builder.

Severity as in `ui-team.md`: Critical is a crash, a blank screen, data loss or a flow she can't finish; Important is not what the brief says, a broken state, visible breakage at a supported size or language, or a keyboard trap; Minor is polish.

## Charters on every task

- **C1 Clean console.** Zero `console.error`/`warn` and zero `pageerror` through boot and every flow below. React key/act warnings count.
- **C2 Sizes.** Every screen and state at 1440×900 and 1024×680: no horizontal scroll (`scrollWidth ≤ clientWidth`), nothing overlapping or clipped. `setContentSize(800, 500)` must leave the window at ≥ 1024×680.
- **C3 Languages.** `TASSEL_UI_LANG=en|es|ko`: `html[lang]` set; every visible string from the catalog (no English leaking into es/ko, no raw keys); Spanish's long strings (`No se pudo conectar con el servidor de Tassel`, `Papel · Desk View`, `Compartir pantalla`, `Terminar sesión`) fit; Hangul renders in Pretendard (`document.fonts.check`); mono labels have `letter-spacing: 0px` under ko and `0.025em` otherwise.
- **C4 Keyboard only.** Tab order follows reading order with a visible focus ring at every stop; no trap; Escape closes any sheet and returns focus to its opener; Enter and Space activate; arrows move inside a segmented control while Tab leaves it.
- **C5 Abuse.** Double and triple clicks on every action; clicks during transitions; 20× library ↔ session; DOM node count stable afterwards, no duplicated timers or captions.
- **C6 Restart.** Relaunch with the same `TASSEL_USER_DATA`: same learner, same cards, no re-registration. A corrupt `device.json` (`{"token":42}`, an empty file) recovers with a fresh learner.
- **C7 Server trouble.** Boot with `TASSEL_SERVER_URL=http://127.0.0.1:1` (device registration fails too, and a rejecting `refreshToken` throws its own error, so the error state must catch anything); 500 and malformed JSON on `/v1/sessions*` through `page.route`; a 2 s delay to catch loading states; a card whose session was deleted behind the app's back.
- **C8 No media in P1.** `getUserMedia` and `getDisplayMedia` wrapped with a counter from `page.evaluate`: 0 calls across every dock toggle, and no macOS permission prompt.

## Task 10: renderer foundation and base components

Adds: global CSS, `initI18n`, `useRoute`, `ApiProvider`, `AppFrame` (52px drag strip, 84px macOS inset), Button, Chip, SegmentedControl, Sheet, IconButton, icons, `.mono:lang(ko)`, `TASSEL_E2E_PORT`.

- R14: `e2e shell` passes on port 8899 against `tassel_qa`; the app's `getConfig().serverUrl` is `http://127.0.0.1:8899`.
- Whatever the shell renders: screenshots at both sizes in three languages; C1–C3.
- `html[lang]` for `en`, `es`, `ko`, `ES`, `es-MX`, `fr` and unset (falls back to a system language, else en).
- `AppFrame`: computed `-webkit-app-region: drag` on the strip and `no-drag` on each child; nothing interactive in the left 84px on macOS; 52px tall at both sizes; the window drags by the strip (checked by hand).
- Fonts: Geist, Geist Mono and Pretendard loaded; a Hangul `.mono` label has `letter-spacing: 0px`.
- Base components wherever a screen already shows them: the primary pill is ink on paper and `rounded-pill`; a segmented control answers arrows, Home and End; icon buttons expose `aria-pressed` and `aria-label`.
- `pnpm --filter @tassel/desktop test` and `pnpm check:i18n` green in my checkout.

## Task 11: library

Adds: top strip (wordmark, search, New session), heading with the sort control, the card grid, cards, empty/loading/error states, the `tokenReset` notice.

- A fresh learner sees the empty state with its CTA, in en/es/ko at both sizes.
- Seed 3, 7 and 25 sessions: grid columns at 1440 and 1024 (`minmax(280px, 1fr)`), no horizontal scroll.
- Cards: `session.untitled` in smoke-text when `title` is null; an 80-character accented Spanish title clamps to 2 lines; an 80-character title with no spaces and an 80-character Hangul title stay inside the card; a 40-character subject chip; type chip; language badge for en/es/ko; relative time "now"/"ahora"/"지금", then aged rows (SQL) at 2 hours, yesterday and 3 days, in each language.
- Sorts: create A, B, C, then `PATCH` A → Recent is A, C, B and Created is C, B, A. Topic: subjects `Automata · DFA`, `biology`, `Calculus` order case-insensitively, null subjects last under No topic / Sin tema / 주제 없음, recent-first inside each group. Switch sorts by mouse and by arrows; hammer the control.
- Search: `a`, `au`, `aut` typed inside 250 ms is one request; matches title or subject only; `%` and `_` are literal; whitespace-only shows all; accented vs plain (record); clearing restores all; a slow first response (`page.route` delay) must not overwrite a newer result; the no-results state.
- Error: server down at boot shows the error title and Retry, no blank screen, no unhandled rejection; Retry while still down stays sane; fail twice then pass through `page.route`, and Retry recovers; 500 and a malformed body show the error state.
- Loading: a delayed response shows skeleton cards (screenshot at about 500 ms).
- `tokenReset`: a corrupt `device.json` shows the notice once; relaunch shows none; `getConfig().tokenReset` matches.
- Keyboard: search → New session → sort → cards; Enter on a card routes; focus is visible on cards. Clicking a card before Task 13 exists: record what happens, a finding only if it errors.
- A second learner (fresh userData) sees an empty library, never the first learner's cards.
- `library.spec.ts` passes on 8899.

## Task 12: new session sheet

Adds: `NewSessionSheet` (type, language, source, Start), `defaultSource`, the win32 notice.

- Opens from the strip button and from the empty-state CTA; 24px radius; Escape and an overlay click close it without creating a session (the list count is unchanged); focus moves into the sheet and returns to the opener.
- Defaults: language equals the UI language in en/es/ko; source is Paper on macOS, enabled, with no notice (win32 is the builder's unit test).
- Every type × language × source combination creates exactly that session (`GET /v1/sessions`); the session screen opens with the localized untitled title; the interim Back shows the card (R18 removes Back in Task 13, when this E2E switches to End, then confirm).
- Double-click Start: one session, not two. Start with the server down: an error inside the sheet, the sheet stays open, nothing navigates. Start with a 500 (route).
- Keyboard: Tab through the three groups and Start; arrows, Home and End inside a group; Enter on Start; Escape at any stop.
- es and ko at 1024×680: `Papel · Desk View`, `Compartir pantalla`, `Solo hablar`, `Investigación` and `Empezar sesión` fit without wrapping or clipping. Screenshots of the sheet at both sizes in three languages.
- Open, resize the window, close, reopen, 10×.
- `new-session.spec.ts` passes.

## Task 13: session screen

Adds: title strip, Stage (paper/board/split), TutorTile, Captions, Dock, the stage store, `useElapsed`, shortcuts, `useCurrentSession`, the End-session Sheet (End is the only exit, R18).

- Title strip: 70- and 80-character Spanish titles ellipsize on one line (`scrollWidth > clientWidth`, `text-overflow: ellipsis`) in en/es/ko and at 1024; chips; the live dot with the right label for paper, screen and talk sessions; the language pill EN/ES/KO; the timer.
- Timer: `00:00` at mount (R7, so reopening an old session must not show hours); counts up; `page.clock.fastForward` across `59:59 → 1:00:00`; resets on opening another session; survives a restart mid-session as a fresh `00:00`.
- Stage (R17): the dock Board button and B both cycle Paper pinned → Split pinned → Board pinned → Follow Ada → Paper pinned, two full rounds each way; in the three pinned states a pin indicator with an Unpin action shows, in Follow Ada it doesn't; Unpin by mouse and by keyboard lands in the last requested mode; the Board button's accessible name states the current state in en/es/ko; the indicator fits at 1024×680 in es and ko without touching the tile or captions. Split is 1fr/1fr with a 12px gap and 16px cards; "Waiting for Desk View" and "Ada's board" placeholders; the 240 ms reflow (screenshot mid-tween; `emulateMedia({ reducedMotion: 'reduce' })` makes it instant); hammer B during the tween.
- TutorTile: 212×176 top-right, label per `tutorState` in each language, iris ring only while speaking; inside the stage at 1024×680.
- Captions: previous and current lines with speaker labels, at most 880 wide, centered; off hides and on restores; at 1024×680 the dock, captions and tile boxes don't intersect, in es and ko too.
- Dock: Mic (level bars, `aria-pressed`, name flips to "Microphone off"), Camera, Share, Board, Captions, separator, End session: accessible names in en/es/ko; every toggle by mouse and keyboard; C8. Share is visible but disabled (R18): exposed as disabled to assistive tech, a click and S do nothing, and it never traps focus.
- Shortcuts: M, B, C with the stage focused; ignored while typing in any input; Cmd+M and Ctrl+M must not toggle the mic; they must not fire in the library. S and Space do nothing in P1 (R18): no toggle, no state change, no console error.
- End (R18): the only exit. No Back control remains (Task 12's interim Back is gone and its E2E ends through the Sheet); Escape and Cmd+[ (history back) don't leave the session. The confirm Sheet ("End this session?", Keep going / End session); Escape and Keep going return with state intact; End routes to the library, where the card is; double-click End.
- Opening a session that was deleted: no blank screen, and End (or an error state) still gets her to the library.
- Screenshots: `session-paper|split|board-<w>-<lang>.png` and the end sheet, both sizes, three languages. `session-layout.spec.ts` passes.

## Task 14: TutorClient and the fake tutor

Adds: `FakeTutorClient`, `createTutorClient`, `useTutorSession`, `dfa-opening.json`, connect on mount and disconnect on unmount.

- At `TASSEL_FAKE_SPEED=1` (the real 33 s): states in order, connecting → listening → speaking → watching → speaking → watching → thinking → speaking → listening, with localized labels; captions in order, student lines labelled as the student and tutor lines as Ada; at 4.5 s the title strip shows "Strings that start with 010" and the subject chip "Automata · DFA"; at 27.6 s the stage goes split; the ring only during speaking. The same at speed 20, repeated 10× for flakiness.
- Pinned (R17): press B once (Paper pinned) before 27.6 s → the split request is ignored and the stage stays on paper; the indicator may say Ada asked for split (record the treatment); Unpin, and separately cycling round to Follow Ada, lands in split. Pin after 27.6 s, then Unpin: still split.
- Captions off during the script, then on: the latest two lines show.
- Disconnect: End mid-script stops every further caption and state update with no console errors (no `setState` after unmount); reopening the same session restarts from `connecting`; 20× open and end during the script.
- Title persistence (R16): the title event updates the strip at once and sends one `PATCH /v1/sessions/{id}` with `{ title, subject }` (count requests: exactly one, not one per render); `GET` then shows title "Strings that start with 010" and subject "Automata · DFA"; after End the library card shows both, and still after a restart with the same userData. `title_source` will read `student` (the server's rule for any client PATCH): record, don't block, R16 defers title writing to the server in P2. With the PATCH failing (route abort or 500): the strip keeps the title, nothing crashes, no unhandled rejection, and the card is untitled afterwards.
- `sendText`, if the UI exposes it: a typed line appears at once as a final student caption; typing `m`, `b`, `c` into it toggles nothing.
- Robustness: `TASSEL_TUTOR=live` (`createTutorClient` throws): the session screen must not blank and the library must still work; `TASSEL_FAKE_SCRIPT=missing`; `TASSEL_FAKE_SPEED=0` and `abc` (config falls back to 1).
- Server unreachable while the fake tutor runs (`page.route` aborts `/v1/sessions/*`): captions keep flowing and the title event doesn't break the screen.
- `fake-tutor.spec.ts` passes; screenshots `fake-tutor-<state>-<w>-<lang>.png`, including the "1010" moment at 1024 in ko.

## Rulings folded in, and what I still only observe

R16 (titles persist through `patchSession`), R17 (the four-state Board cycle with a pin indicator and Unpin) and R18 (End is the only exit; M, B and C only; Share visible but disabled) are charters above, in Tasks 12 to 14. Two things I record rather than block on: `title_source` reading `student` after the client PATCH (R16 moves title writing to the server in P2), and the pin indicator's wording when Ada requests a view during a pin (the builder and the design reviewer settle it within the direction contract).
