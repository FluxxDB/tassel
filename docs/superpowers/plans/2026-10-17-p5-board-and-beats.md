# P5 Board & Beats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ada shows instead of telling. She draws automata on a tldraw board from semantic commands, marks up a frozen snapshot of the student's own paper, and times both to her words in beats, with trace animations and view requests. Everything runs on fakes first (spec §9 steps 6–7 end to end), then live through P2's voice loop.

**Architecture:**
- **One action vocabulary.** Ada's board, paper and stage actions are JSON `BeatAction`s defined once in `packages/shared/src/beats`. A tutor sends them immediately (an `actions` event) or inside a beat cue document (a `beat` event), whose markers fire as the words they belong to are heard (`word` events).
- **Board.** A pure reducer turns board actions into a `BoardScene`. Graphviz (`@viz-js/viz`, in a classic worker) lays out each automaton left to right. A `BoardEngine` renders the scene; its only implementation is tldraw, so Excalidraw stays possible behind the same interface. Ada's shapes are custom tldraw shapes (states, the trace card, notes) plus native arrows bound to them.
- **Paper marks.** P3 owns capture, upload and storage of frames. P5 owns the frozen snapshot that explanations play over: which frame, its image, and Ada's marks. Marks live in page coordinates and are projected through the frame's page quad into an SVG layer over the paper panel.
- **Beats.** A word-gated player fires each marker when its anchor word is heard. Fake scripts compile spoken lines with `{#id}` anchors into beats plus synthetic word events. Live, a Pipecat processor strips `[[…]]` tags from Ada's text before TTS and sends the cue document keyed by Pipecat's `segment_id`.

**Tech Stack:**
- **Unchanged from P1:** Electron exactly 44.9.0 (Chromium 152.0.7977.167, [release](https://releases.electronjs.org/release/v44.9.0)), React 19, Zustand 5, Tailwind v4, i18next, Vitest, Playwright 1.64.1 `_electron`.
- **New, desktop:** `tldraw` 5.5.2 and `@tldraw/assets` 5.5.2, published 2026-10-02, with React peers `^18.2.0 || ^19.2.1` ([npm](https://www.npmjs.com/package/tldraw/v/5.5.2), [release](https://github.com/tldraw/tldraw/releases/tag/v5.5.2)); `@viz-js/viz` 3.31.0, MIT, Graphviz 16.1.0 with the WebAssembly embedded in the JS and no `eval` ([npm](https://www.npmjs.com/package/@viz-js/viz), [API](https://viz-js.com/api/), [build flags](https://github.com/mdaines/viz-js/blob/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f/packages/viz/backend/Dockerfile)).
- **Server (Tasks 9 and 13):** P2's `pipecat-ai[webrtc,deepgram]==1.12.0`, Pydantic v2, pytest. No new Python dependency.

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md`, mainly §4.1, §5.4 ("Showing, not telling"), §5.5 (beats), §6 (session screen, accessibility), §7 (fakes) and §9 steps 5–7. Read it with:
- `docs/research/03-whiteboard-visuals-avatar.md` (tldraw, Graphviz, the cue document format) and `docs/research/00-flagged-items.md`;
- the roadmap, and the P1, P2 and P3 plans (`2026-10-17-p{1,2,3}-*.md`): P1's `TutorEvent`, fake tutor and stage store; P2's `word` events, RTVI mapping and bot pipeline; P3's `PaperSource`, frames API, page quad and paper panel;
- the session direction contract `apps/desktop/.impeccable/surfaces/er-src-features-session-sessionscreen-tsx-a096c7a1.md`, the mock `.impeccable/mocks/decision/stage.html` (its paper marks and board trace are the visual target), `docs/design-system/DESIGN.md`, and the P1 design checklist `docs/superpowers/records/2026-10-17-p1-foundation/design/checklist.md` §0.

**Starts from:** `claude/p1-foundation` after P1 Task 15. Work on `claude/p5-board-and-beats`, with the SDD workspace `.superpowers/sdd/2026-10-17-p5-board-and-beats/`. P2 and P3 run at the same time; Tasks 12–14 wait for them (see "Merging with P2 and P3").

## Global Constraints

Every task's requirements include this section.

### Carried from P1
- Electron stays at **exactly `44.9.0`**. Renderers keep `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`; `window.tassel` is the only IPC surface, and P5 adds no IPC channel.
- **The page CSP in `apps/desktop/src/renderer/index.html` stays exactly as P1 wrote it:** no `'unsafe-eval'`, no `'wasm-unsafe-eval'`. WebAssembly runs only in a classic dedicated worker loaded from the app's own origin, as P3's OpenCV does (P5-R3).
- Every script runs on macOS **and Windows**; Node scripts use `cross-spawn`; nothing is bash-only.
- Every UI string goes through i18next keys present in `en`, `es` and `ko`, and `pnpm check:i18n` passes. Korean uses polite 해요체. Task 1 adds every P5 key (the table below), so no later task edits the catalogs except to fix copy.
- Design tokens only. Iris (`#c094e4`) and iris-ink (`#7d4fc4`) belong to Ada alone: her marks, highlights, rings and tokens, never chrome. No drop shadows (hairline `0 0 0 1px` only). Functional text is never below 11px.
- Commits go on `claude/p5-*` branches and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only `claude/*` branches.

### Keys and fakes
- **No provider key ever reaches the desktop app.** The tldraw license key is different: tldraw validates it offline in the page, and keys are designed to ship in client bundles (P5-R2).
  - **Where it comes from:** `TLDRAW_LICENSE_KEY`, read when the desktop app is built or served for dev. The environment wins; otherwise the build reads the owner's git-ignored `services/server/.env`. Task 4 injects it into the renderer as the build-time constant `__TASSEL_TLDRAW_LICENSE_KEY__`.
  - **Never** commit it, log it, print it, or read that file in an agent session; tests use temporary files with made-up keys.
  - **Without it**, `pnpm dev` works (tldraw treats `http://localhost` as development and shows only its watermark), and so do the unit tests. A production build on `app://tassel` without a valid key blanks the editor after 5 s, so the E2E specs that need the board skip with that reason when no key is found.
- Every P5 feature runs with no keys. The fake and live pairs (spec §7):

| Part | Fake | Live |
|---|---|---|
| Ada's board, paper and stage actions | Fake tutor scripts `board-demo`, `marks-demo`, `trace-demo`, `dfa-demo`, `dfa-demo-clip` | P2's voice loop: `[[…]]` tags in her text become `beat` server events (Tasks 13–14) |
| Word timing | `synthWords` timings and scripted `word` events | P2's `word` events from Pipecat's per-word `bot-output` progress |
| The snapshot's image | The fixture page `dfa-wrong` | P3's analyzed frame (`frame` or `latest`), or a grab of the live feed |
| Element geometry on the paper | The fixture's truth | P4's transcription |
| Mouth cues | Rest cues (`X` for the whole beat) | P6's visemes |
| Where her board edits go | `devEditSink` (logs) | P4's gate upload |

### Visual values
These come from the mock (`stage.html`), DESIGN.md and spec §5.4. Sizes are CSS px at zoom 1.

| Element | Values |
|---|---|
| State (board) | circle r 32; stroke 2 ink; fill paper; label Geist 18/520 ink. Accept: inner circle at r 26. Highlight: iris-ink 2 ring at r 38. Current (trace): iris-ink 3 ring at r 38, fill `color-mix(in oklab, var(--color-iris) 20%, white)` |
| Transition (board) | tldraw arrow, ink, its thinnest size; label Geist Mono 15; highlighted: iris-ink. Start arrow: 48 long, no label |
| Trace card (board) | paper card, radius 16, hairline ring, padding 20, width ≥ 440. Title mono 12 smoke-text. Tape cells 44×44, radius 10, 1.5 ink border, Geist Mono 24; the cell being read is blush. Rows Geist 17: "STEP n" mono 12 smoke-text, "read s", "q0 → q1", "loops" in iris-ink. The newest row sits on `color-mix(in oklab, var(--color-iris) 18%, white)`, radius 12. Verdict: an ink pill (white Geist 15) for hers, a 1px ink-ring pill for the note |
| Note (board) and callout (paper) | ink rounded rect, radius 20, padding 10×16, white Geist 17/400, max width 320, wraps |
| Paper marks | stroke 3 iris-ink, round caps and joins; wash `#c094e4` at 20%; step dot r 13 iris-ink with white Geist Mono 13; callout leader 2.5 iris-ink, no arrowhead; arrow mark 3 with a 10px open head; current-state ring 3 iris-ink at 1.25 r; token dot 10 iris-ink |
| Snapshot | the frozen frame contain-fit on the paper panel; letterbox on `--color-desk` once P3 has merged, on paper before |

**Motion** (`board/motion.ts`, Task 1). Reveal fade 180 ms; mark draw-on 320 ms; pill and row fade 150 ms; token glide 450 ms per edge; pulse 600 ms; camera 240 ms. Easing `cubic-bezier(0.16, 1, 0.3, 1)`, except the glide's `cubic-bezier(0.65, 0, 0.35, 1)`. Under `prefers-reduced-motion: reduce` everything is instant: no glide, no pulse, no draw-on. Every animation runs toward a final state that is already set, so an animation that fails still leaves it visible (checklist §0.6).

**Language.** Ada's board and paper content (trace labels, verdicts, the description lists) uses the **session's** language, `useCurrentSession().session.language`, through `t(key, { lng })`. Chrome (tool names, Back to live) uses the UI language.

**E2E** drives the built app: `pnpm --filter @tassel/desktop build`, then Playwright `_electron` through P1's `launchApp`. Specs save screenshots with `snap()` for the milestone QA (Task 15); no task has its own screenshot review. A spec that needs the board past tldraw's 5 s license window starts with `test.skip(!hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)')` (Task 4's helper). Every other spec runs with no key.

### Copy (exact; Task 1 adds all of it)

| Key | en | es | ko |
|---|---|---|---|
| `board.tools.label` | Board tools | Herramientas de la pizarra | 보드 도구 |
| `board.tools.select` | Select | Seleccionar | 선택 |
| `board.tools.pen` | Pen | Lápiz | 펜 |
| `board.tools.arrow` | Arrow | Flecha | 화살표 |
| `board.tools.eraser` | Eraser | Borrador | 지우개 |
| `board.description.label` | What's on Ada's board | Lo que hay en la pizarra de Ada | Ada의 보드에 있는 것 |
| `board.description.states` | States: {list} | Estados: {list} | 상태: {list} |
| `board.description.start` | Start: {state} | Inicio: {state} | 시작: {state} |
| `board.description.accepting` | Accepting: {list} | De aceptación: {list} | 수락 상태: {list} |
| `board.description.transition` | {from} to {to} on {symbols} | De {from} a {to} con {symbols} | {from} → {to}, 입력 {symbols} |
| `board.trace.title` | Trace · input {input} | Traza · entrada {input} | 추적 · 입력 {input} |
| `board.trace.step` | Step {n} | Paso {n} | {n}단계 |
| `board.trace.read` | read {symbol} | lee {symbol} | {symbol} 읽음 |
| `board.trace.loops` | loops | se queda | 제자리 |
| `board.trace.stuck` | no move: rejected | sin transición: rechaza | 전이 없음: 거부 |
| `board.verdict.yours` | Your {kind}: {verdict} | Tu {kind}: {verdict} | 내 {kind}: {verdict} |
| `board.verdict.this` | This {kind}: {verdict} | Este {kind}: {verdict} | 이 {kind}: {verdict} |
| `board.verdict.accept` | accept | acepta | 수락 |
| `board.verdict.reject` | reject | rechaza | 거부 |
| `board.kind.dfa` | DFA | AFD | DFA |
| `board.kind.nfa` | NFA | AFN | NFA |
| `marks.snapshot` | Snapshot {time} | Instantánea {time} | 스냅샷 {time} |
| `marks.backToLive` | Back to live | Ver en vivo | 실시간 보기 |
| `marks.loading` | Getting the snapshot… | Cargando la instantánea… | 스냅샷을 가져오는 중이에요… |
| `marks.failed` | Couldn't load the snapshot | No se pudo cargar la instantánea | 스냅샷을 불러오지 못했어요 |
| `marks.description.label` | Ada's marks on your paper | Las marcas de Ada en tu papel | 내 종이에 Ada가 남긴 표시 |
| `marks.description.step` | Step {n}: {target} | Paso {n}: {target} | {n}단계: {target} |
| `marks.description.circle` | Circled: {target} | Marcado: {target} | 표시: {target} |
| `marks.description.note` | Note: {text} | Nota: {text} | 메모: {text} |
| `marks.target.state` | state {id} | estado {id} | 상태 {id} |
| `marks.target.edge` | {from} to {to} | de {from} a {to} | {from} → {to} |
| `marks.target.start` | the start arrow | la flecha de inicio | 시작 화살표 |
| `marks.target.point` | a spot on your paper | un punto de tu papel | 종이의 한 곳 |

Korean templates avoid particles after a placeholder (`{to}로` changes with the final consonant), so they use `→`.

## Rulings (spec conflicts and gaps)

The owner pre-authorized self-approval of plans, so these stand unless the owner overrides them. Each gives the ruling, why, and the cost if it's wrong.

- **P5-R1. tldraw 5.5.2, the current release of the spec's 5.5 line, with a custom shape for states.** `tldraw` and `@tldraw/assets` are pinned at 5.5.2. Spec §5.4's API list needs four corrections for 5.5.2, and the tasks follow them:
  - `animateShape` exists, but its last frame is an ordinary, undoable *user* change ([Editor.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/Editor.ts#L8698-L8790)). So Ada's reveals set `opacity` inside `mergeRemoteChanges` and fade with CSS;
  - `OverlayUtil` draws on a 2D canvas and is never stored ([overlay utils](https://tldraw.dev/sdk-features/overlay-utils)), which suits pulses and gliding tokens;
  - arrow labels are `richText` (`toRichText`), shape utils must implement `getIndicatorPath`, and the camera lives in `options.camera` ([TLArrowShape.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/shapes/TLArrowShape.ts#L165-L182), [ShapeUtil.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/shapes/ShapeUtil.ts#L158-L247), [options.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/options.ts#L182-L186));
  - states are a custom `tassel-state` shape, not custom geo types. Geo values aren't typed (the official example casts them `as any`), and they can't draw Ada's rings ([geo shapes](https://tldraw.dev/sdk-features/geo-shape)). Arrows bind to any shape.

  *Cost if wrong:* the adapter in `board/tldraw/` only.
- **P5-R2. The license: development runs unlicensed; every production build needs a key that covers `app://tassel`.**
  - **How tldraw decides:** an origin is development when it is `http:`, loopback `https:`, or built with `NODE_ENV` other than production. Since 5.3.2, a custom protocol such as `app://tassel` in a production build is production ([LicenseManager.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/license/LicenseManager.ts#L187-L215), [PR #10021](https://github.com/tldraw/tldraw/pull/10021)). Spec §5.4 and research 03 predate that change.
  - **What it does:** in development with no key, the editor works and shows a watermark. In production with no key, a host that doesn't match or an expired key, the editor is replaced by an empty `div[data-testid=tl-license-expired]` after 5 s ([LicenseProvider.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/license/LicenseProvider.tsx#L34-L90)).
  - **How it checks:** offline, with ECDSA in `crypto.subtle`, which P1's `secure: true` scheme provides. Trial and hobby keys, and unlicensed production, also fetch a tracking pixel from `cdn.tldraw.com` with the page's URL; P1's `connect-src https:` allows it.
  - **Ruling:**
    - The key is `TLDRAW_LICENSE_KEY`, from the environment, then the owner's git-ignored `services/server/.env`. Task 4 reads it at build and dev time and passes it as `licenseKey`.
    - The owner asks tldraw for a key that matches `app://tassel/`. Keys carry a host list, and a `NATIVE_LICENSE` flag, added for Electron apps, matches hosts as regexes against `location.href` ([LicenseManager.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/license/LicenseManager.ts#L408-L454), [PR #6726](https://github.com/tldraw/tldraw/pull/6726)).
    - The app never fakes development to get past the check; the license forbids interfering with key enforcement ([LICENSE.md](https://github.com/tldraw/tldraw/blob/v5.5.2/LICENSE.md#L9-L34)). So machines without a key skip the board E2E specs, CI gets the key as a secret, and P10's packaging must fail without one.
  - *Cost if wrong:* a packaged app shows an empty board; `pnpm dev` still works.
- **P5-R3. Graphviz, in a classic worker.** Spec §5.4 names Graphviz (`@viz-js/viz`), while §11 leaves "ELK and dagre" to the builder; the roadmap says Graphviz. Ruling: `@viz-js/viz` 3.31.0 with `renderString(dot, { format: 'json0' })` (no draw ops), run in a classic worker the page creates from `app://tassel/assets/…`.
  - A worker loaded from `app://` takes its CSP from its own response, and P1's `app://` handler sends none, so WebAssembly runs there while the page's CSP stays untouched. This was verified in Electron 44.9.0: the page blocks WASM, the `app://` worker allows it, and a `blob:` worker inherits the page's policy ([HTML](https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container), [Chromium 152](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/core/workers/dedicated_worker_global_scope.cc#L264-L272), [chromestatus](https://chromestatus.com/feature/5715844005888000)). So never Vite's `?worker&inline`, which makes a `blob:` worker.
  - Hardening, not in P5: P10 may have the `app://` handler send `Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'` on the layout worker's script only, which still runs viz but forbids `eval` (verified); it must not apply to P3's OpenCV worker, whose embind code calls `new Function`. That needs the owner's sign-off.
  - Unit tests call viz directly in Node. Fallback if the worker build fails: the same code over `ipcMain.handle` in main (viz ships `dist/viz.cjs`), then pure-JS `@dagrejs/dagre` 3.1.1 as the last resort.
  - *Cost if wrong:* one transport file.
- **P5-R4. Beats: word-gated markers in a cue document that carries its actions.** Spec §5.5: the client "plays cues and markers against the audio playback clock, anchored by Pipecat's playback-synced word events", and research 03 §4 gives `markers: [{id, at}]`.
  - What Pipecat 1.12.0 sends a client-js 1.14.0 client: no word-level `bot-output`, but one sentence-level `bot-output` progress message per word, released at the word's `pts` on the server's clock, keyed by `segment_id` ([observer.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/frameworks/rtvi/observer.py#L684-L794), [base_output.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/transports/base_output.py#L1138-L1159)). P2 turns these into `word` events.
  - **Ruling:** a marker fires when its anchor word's `word` event arrives. Each marker carries its `action` and the index of the `word` it precedes; the document carries the `segment` it belongs to, so live words match by segment and index, never by text alone. Word times and `mouthCues` stay in the document for P6's lip-sync; in a live document they may be empty until TTS timing is known, and P6 owns that timing update.
  - *Cost if wrong:* a timer offset in the player.
- **P5-R5. Mouth cues: P5 checks their shape, P6 makes them.** Fakes carry one `X` cue for the whole beat. *Cost if wrong:* none to P5.
- **P5-R6. Live board commands are inline `[[…]]` tags, not tools.** In Pipecat 1.12.0, tool calls run only after the LLM stream ends, and their results land after the speech, so a tool can't time a reveal to a word ([base_llm.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/services/openai/base_llm.py#L604-L631)). Tags written into `raw_text` stay in the LLM's history for the words actually spoken ([llm_response_universal.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/aggregators/llm_response_universal.py#L2231-L2260)), so Ada remembers what she drew. P2's `show_stage` and `set_language` tools stay. *Cost if wrong:* a tool schema on top of the same actions.
- **P5-R7. `show_stage`.** P2 already ships the `show_stage` tool, its `StageEvent` and P1's `requestMode` (pins win). Ruling: P5 adds the timed `stage` action and an auto-split rule: an action that shows something on a hidden panel requests `split`. A pin still wins; Ada's request is remembered, and P1's pin indicator says "Ada asks: …". *Cost if wrong:* one function.
- **P5-R8. Who owns the frame.** P3 owns capture, the live panel, upload and storage. P5 owns the snapshot that explanations freeze on: it picks the frame (`FrameRef`), fetches the image through P3's frames API, and draws marks over it while P3's capture keeps running underneath. Mount points:
  - `PaperMarksLayer` renders inside P1's paper `Panel`, after P3's `PaperPanel` body, at `z-[5]` (above the video, below P1's `TopLine` at `z-10`);
  - `SnapshotTag` goes in the `TopLine`'s `trailing` slot, after P3's `PaperTopLineExtras`. If P3 hasn't merged, Task 1 adds `trailing?: ReactNode` exactly as P3 Task 13 specifies it, and the merge keeps one copy.

  *Cost if wrong:* two mount lines.
- **P5-R9. "SNAPSHOT 14:32" is the frame's capture time,** as local `HH:mm` (`Intl.DateTimeFormat(lng, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`). It needs no session clock, reads the same in all three languages, and matches the spec's example. *Cost if wrong:* one formatter.
- **P5-R10. Paper coordinates are P3's page coordinates:** 0–1 of the page's width and height, origin top-left. Radii are in page-width units. *Cost if wrong:* one conversion.
- **P5-R11. On the board Ada draws in ink, and iris-ink is her emphasis.** Spec §5.4 makes deep iris the ink on paper; the mock's board is ink with iris-ink accents ("loops"). *Cost if wrong:* theme colors.
- **P5-R12. Not in P5:**
  - brief pointers over the *live* feed with a homography re-found each tick (spec §5.4 calls it "a later polish milestone"; no roadmap plan owns it yet);
  - display versus spoken captions: P2 deferred them to P5's beats, and the document carries the display `text`, but how live captions use it is P9's (captions);
  - PDA and TM shapes and traces (P11); P5 draws and traces DFAs and NFAs, with NFA token sets as sets of states;
  - character-level timings (P6), Manim and plots (spec §5.6), and the session event log (P8; every action is plain JSON, so P8 can log it);
  - the "How I read your DFA" read-back (spec §5.3, P4). P4 draws it as a titled `board.automaton`, and re-checks her board edits from Task 6's read-back.
- **P5-R13. Her board edits: P5 captures them, P4 sends them.** Spec §5.4 sends her changed shapes "through the same gate as the paper". P5 builds the capture (image plus shape JSON plus the automata read from arrow bindings) behind `BoardEditSink`; P4 installs the live sink. *Cost if wrong:* none to P5.
- **P5-R14. P5's touch list.** The roadmap gives P5 `apps/desktop/src/renderer/src/board/**` and `packages/shared/src/beats/**`. P5 also creates `services/server/src/tassel/beats/**`, `apps/desktop/config/tldraw-license.ts`, `apps/desktop/tests/{unit,e2e}/board/**`, `packages/shared/tests/beats.test.ts`, `services/server/tests/beats/**`, five fake scripts in `tutor/scripts/`, and the QA record `docs/superpowers/records/2026-10-17-p5-board-and-beats/qa.md`. It makes small edits in:
  - P1: `tutor/{types,use-tutor-session,create-client}.ts`, `features/session/Stage.tsx`, `features/session/shortcuts.ts` (Task 6, only if needed), `apps/desktop/electron.vite.config.ts` (one `define`), `apps/desktop/tsconfig.node.json`, `apps/desktop/tests/unit/setup.ts` (one `vi.mock`), `packages/shared/package.json`, `packages/shared/src/i18n/{en,es,ko}.json`, `apps/desktop/package.json`, `pnpm-lock.yaml`, `README.md`, `CLAUDE.md`;
  - P2 (Tasks 13–14, after P2 merges): `packages/shared/src/voice/{messages.ts,fixtures.json}`, `services/server/src/tassel/voice/{messages,bot,prompts}.py`, `voice/fakes/scenarios/dfa-board.json` (new), `tutor/live/rtvi-map.ts`, and their tests.

  P5 never edits P3's files; Task 12 only imports them. *Cost if wrong:* merge work.

## Review Focus

These are the five failure modes a student is most likely to meet that the spec never names. Each has a test in the task named.

1. **Ada draws while she has pinned another view** (or the board panel is hidden or zero-width). Expected: nothing Ada does is lost; the hidden board renders; "Ada asks: Paper and board" shows; on unpin the finished drawing is in view, the camera fitted after the panel grows. Tests: Task 1 (`a showing board action while pinned to paper keeps the pin and remembers split`), Task 5 (E2E pin, then unpin; the camera refits on resize).
2. **Interrupted or uneven speech:** a barge-in mid-sentence, a word event missed or merged, the same word twice ("q zero … q zero"), a cue document that arrives after its first words. Expected: markers fire only for words she heard, each once, in order; a newer turn discards the older turn's pending markers. Tests: Task 8 player tests.
3. **The stage reflows or the window resizes while a snapshot is frozen** (the 240 ms split reflow, 1024×680). Expected: the marks stay on her ink and never lag. Tests: Task 7 (`toScreen` at two panel sizes; E2E bounding boxes at 1440×900 and 1024×680, measured against the fixture's own ink).
4. **Long Spanish or Korean text in Ada's callouts, notes and trace rows.** Expected: pills wrap at 320 px, stay 14 px inside the panel, and keep Korean words whole; trace rows never overflow the card. Tests: Task 7 (`calloutFor` clamps; a 140-character Spanish callout), Task 10 (trace rows in es and ko).
5. **Bad or out-of-order actions from a live tutor:** a reveal before its automaton exists, an unknown state, a mark before the snapshot has loaded, an invalid cue document. Expected: invalid pieces are skipped with one `console.warn`, valid ones still apply, nothing throws, and marks that arrive while the snapshot loads appear once it's ready. Tests: Task 1 (parsers), Task 3 (`problem`s, no throw), Task 7 (marks queued while loading), Task 8 (an invalid marker doesn't block the next), Task 14 (`rtvi-map` drops an invalid document).

## Parallel tracks

Task 1 runs first, on `claude/p5-board-and-beats`. It fixes every seam the tracks meet at: the shared contract, the new `TutorEvent` variants, the dispatcher, stub stores and panels already mounted in the stage, the dependencies and all P5 copy. Three sub-teams then work at once, each in its own worktree and branch cut from it after Task 1, at most three helpers:

| Track | Tasks, in order | Worktree and branch | Writes (nobody else edits these) |
|---|---|---|---|
| **A: tldraw board** | 4 → 5 → 6 (Task 5 also needs Tasks 2 and 3 merged) | `.claude/worktrees/p5-board`, `claude/p5-board` | `board/{tldraw/**,engine.ts,board-store.ts,BoardPanel.tsx,BoardDescription.tsx,edit-sink.ts,glyphs.tsx}`, `apps/desktop/config/**`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/tsconfig.node.json`, `apps/desktop/tests/unit/setup.ts`, `tutor/scripts/board-demo.json`, `tests/unit/board/tldraw/**` and the other unit tests Tasks 4–6 name, `tests/e2e/board/{board-*.spec.ts,tldraw-key.ts}`, `features/session/shortcuts.ts` (Task 6, if needed) |
| **B: layout, scene and server** | 2 → 3 → 9 | `.claude/worktrees/p5-layout`, `claude/p5-layout` | `board/{automata,layout,scene}/**`, `tests/unit/board/{automata,layout,scene}/**`, `tests/unit/board/fixtures.ts` (the WRONG and CORRECT DFAs), `services/server/src/tassel/beats/**`, `services/server/tests/beats/**` |
| **C: marks and beats** | 7 → 8 | `.claude/worktrees/p5-marks`, `claude/p5-marks` | `board/{marks,beats,script}/**`, `tutor/scripts/marks-demo.json`, `tutor/create-client.ts` (Task 8), `tests/unit/board/{marks,beats,script}/**`, `tests/e2e/board/{marks,beats}-*.spec.ts` |
| **Converge** (one builder) | 10 → 11 → 12 → 13 → 14 → 15 | `claude/p5-board-and-beats` | anything P5 owns, plus the P2 files of P5-R14 once P2 has merged |

Renderer paths are under `apps/desktop/src/renderer/src/` and test paths under `apps/desktop/` unless a path says otherwise.

**Rules:**
- Merge B before A starts Task 5; merge A, B and C (any order) before Task 10. Run `pnpm install` after each merge.
- Teams meet only at Task 1's seams. A change to one goes to `main` as a `QUESTION:` first.
- E2E runs in one worktree at a time unless each has its own `TASSEL_E2E_PORT` and `TASSEL_E2E_DATABASE_URL`.
- **Gates:** Task 12 starts once P3 has merged into `claude/p1-foundation` (or its successor); Tasks 13–14 once P2 has. Until then the converge builder does Tasks 10, 11 and 15's fake parts.

## Merging with P2 and P3

- **`tutor/types.ts`:** P2 Task 1 adds `connection`, `mic`, `language`, `word` and `voice-debug`. P5 Task 1 adds `actions` and `beat`, and gives `word` two optional fields, `segment?: string; index?: number`. Keep one `word` variant, with both fields.
- **`tutor/use-tutor-session.ts`:** P2 Task 17 says "`word` is ignored for now". P5 routes it to the beat player instead; keep P2's other cases.
- **`tutor/create-client.ts`:** P2 Task 17 changes the signature to `createTutorClient(cfg, deps?)`. P5 only adds entries to `SCRIPTS` and compiles them (Task 8). Adjacent edits; keep both.
- **`features/session/Stage.tsx`:** P3 Task 13 adds `PaperPanel`, `usePaperTag` and `TopLine`'s `trailing` slot. P5 adds `PaperMarksLayer` after the paper body, `SnapshotTag` in `trailing` after `PaperTopLineExtras`, and `BoardPanel` in the board panel (P5-R8).
- **`features/session/shortcuts.ts`:** P2 Task 18 adds Space for push-to-talk; Task 6 may add one line that skips events inside the board. Keep both.
- **The i18n catalogs, `apps/desktop/package.json`, `packages/shared/package.json`:** all three plans add keys, dependencies and exports. Keep them all, then run `pnpm install` (never hand-merge `pnpm-lock.yaml`) and `pnpm check:i18n`.
- **P2's files (Tasks 13–14 only):** P5 edits them after P2 is merged, so there is nothing to merge.
- **P3:** Task 12 imports P3's `paper/upload/frames-api.ts` (`listFrames`, `getFrameImage`), `paper/paper-store.ts` (`usePaperStore`) and `paper/detector/homography.ts` (`homography`, `applyH`), and reads `--color-desk`; it edits none of them. After P3, `launchApp` gives every spec the fake clip by default; P5's specs don't depend on the paper source unless they say so.
- **P6:** the beat player exposes `onWord(listener)` with the matched document and word index, and the document carries `mouthCues`; P6 builds its mouth clock on them.

## File map

| Area | New files |
|---|---|
| Contract (Task 1) | `packages/shared/src/beats/{automaton,actions,doc,index}.ts`, `beats/fixtures.json`; `board/{dispatch,motion,use-session-lang}.ts`; stubs `board/{board-store.ts,BoardPanel.tsx}`, `board/marks/{marks-store.ts,PaperMarksLayer.tsx,SnapshotTag.tsx}`, `board/beats/player.ts`; `tutor/scripts/{board-demo,marks-demo}.json` |
| Layout and scene (B) | `board/automata/run.ts`, `board/layout/{types,dot,from-graphviz,fallback,viz,worker,messages,client}.ts`, `board/scene/{types,reduce,placement}.ts` |
| tldraw board (A) | `apps/desktop/config/tldraw-license.ts`; `board/engine.ts`, `board/tldraw/{TldrawCanvas.tsx,assets.ts,theme.ts,board.css,env.d.ts,desired.ts,plan-sync.ts,engine.ts,effects.ts,camera.ts,StudentTools.tsx,student-edits.ts,read-automata.ts}`, `board/tldraw/shapes/{types.ts,StateShape.tsx,TraceShape.tsx,NoteShape.tsx}`, `board/{BoardDescription.tsx,edit-sink.ts,glyphs.tsx}`; `tests/e2e/board/tldraw-key.ts` |
| Marks and beats (C) | `board/marks/{project,geometry,snapshot-sources,fixture-paper}.ts(x)`, `board/marks/{MarkShapes,MarksDescription}.tsx`, `board/marks/marks.css`, `board/beats/match.ts`, `board/script/{types,compile,synth-words}.ts` |
| Server (B, converge) | `services/server/src/tassel/beats/{__init__,models,markup,assemble,processor}.py`, `services/server/tests/beats/{markup-fixtures.json,test_*.py}` |
| Converge | `board/marks/{trace-marks.ts,TraceMarks.tsx}`, `board/tldraw/arc.ts`, `tutor/scripts/{trace-demo,dfa-demo,dfa-demo-clip}.json`, `voice/fakes/scenarios/dfa-board.json`, `tests/e2e/board/{trace,dfa-demo,marks-paper,live-board}.spec.ts` |

---

### Task 1: The contract and the seams

**Files:**
- Create: `packages/shared/src/beats/automaton.ts`, `actions.ts`, `doc.ts`, `index.ts`, `fixtures.json`
- Modify: `packages/shared/package.json` (exports `"./beats": "./src/beats/index.ts"` and `"./beats/fixtures.json": "./src/beats/fixtures.json"`)
- Create: `board/dispatch.ts`, `board/motion.ts`, `board/use-session-lang.ts`
- Create, as stubs with their final exports (later tasks replace the bodies): `board/board-store.ts` (Task 5), `board/BoardPanel.tsx` (Task 4), `board/marks/marks-store.ts`, `board/marks/PaperMarksLayer.tsx`, `board/marks/SnapshotTag.tsx` (Task 7), `board/beats/player.ts` (Task 8). The panels render `null`; `load` fires every marker at once.
- Create: `tutor/scripts/board-demo.json` and `tutor/scripts/marks-demo.json` (connecting at 0, listening at 800; Tasks 5 and 7 fill them)
- Modify: `tutor/types.ts`, `tutor/use-tutor-session.ts`, `tutor/create-client.ts` (register both scripts), `features/session/Stage.tsx` (P5-R8's mounts)
- Modify: `apps/desktop/package.json` and `pnpm-lock.yaml`: devDependencies, exact, `"tldraw": "5.5.2"`, `"@tldraw/assets": "5.5.2"` and `"@viz-js/viz": "3.31.0"`. Every desktop dependency is a devDependency, because electron-vite bundles them (P1's `electron.vite.config.ts`).
- Modify: `packages/shared/src/i18n/{en,es,ko}.json` (the whole copy table in Global Constraints)
- Test: `packages/shared/tests/beats.test.ts`, `tests/unit/board/dispatch.test.ts`, `tests/unit/board/tutor-routing.test.tsx`

**Interfaces:**
- Consumes: P1's `useStageStore` (`mode`, `pinned`, `requested`, `requestMode`), `useCurrentSession`, `FakeTutorClient`, `TutorEvent`; `Lang` from `@tassel/shared/i18n`.
- Produces (`@tassel/shared/beats`). Wire keys are camelCase, because the cue document is Rhubarb-compatible (`mouthCues`); P2's voice messages stay snake_case.

```ts
// automaton.ts
export type StateId = string;            // also its label; /^[A-Za-z][A-Za-z0-9_]{0,15}$/
export const EPSILON = 'ε';
export interface AutomatonSpec {
  kind: 'dfa' | 'nfa';
  states: Array<{ id: StateId; accept?: boolean }>;
  start: StateId;
  transitions: Array<{ from: StateId; to: StateId; symbols: string[] }>;   // symbols: 1–4 chars, no ',' or space; EPSILON only in an NFA
}
export type ElementRef = 'start' | `state:${string}` | `edge:${string}>${string}`;
export function edgeRef(from: StateId, to: StateId): ElementRef;       // 'edge:q0>q1'
export function parseElementRef(ref: string): { kind: 'start' } | { kind: 'state'; id: StateId } | { kind: 'edge'; from: StateId; to: StateId } | null;
export function checkAutomaton(spec: AutomatonSpec): string[];         // [] when valid
// actions.ts
export interface Pt { x: number; y: number }
export interface NormRect { x: number; y: number; w: number; h: number }
export type StageView = 'paper' | 'board' | 'split';
export type BoardAction =
  | { kind: 'board.automaton'; item: string; spec: AutomatonSpec; title?: string; reveal?: 'all' | 'none' }
  | { kind: 'board.addState'; item: string; id: StateId; accept?: boolean }
  | { kind: 'board.addTransition'; item: string; from: StateId; to: StateId; symbols: string[] }
  | { kind: 'board.reveal'; item: string; els?: ElementRef[] }          // no els: everything
  | { kind: 'board.highlight'; item: string; el: ElementRef; on: boolean }
  | { kind: 'board.pulse'; item: string; el: ElementRef }
  | { kind: 'board.note'; item: string; text: string; near?: { item: string; el: ElementRef } }
  | { kind: 'board.trace'; item: string; spec: AutomatonSpec; input: string; subject?: 'student' | 'tutor'; on?: string; title?: string }
  | { kind: 'board.traceStep'; item: string; step?: number }
  | { kind: 'board.verdict'; item: string; got: 'accept' | 'reject'; expected?: 'accept' | 'reject'; note?: string }
  | { kind: 'board.focus'; item?: string }
  | { kind: 'board.clear'; item?: string };
export type PaperTarget = { el: ElementRef } | { at: Pt } | { box: NormRect };        // page coordinates (P5-R10)
export type PaperMark =
  | { type: 'circle'; id: string; target: PaperTarget; wash?: boolean }
  | { type: 'arrow'; id: string; from: PaperTarget; to: PaperTarget }
  | { type: 'step'; id: string; n: number; target: PaperTarget }
  | { type: 'callout'; id: string; target: PaperTarget; text: string }                // ≤ 280 chars
  | { type: 'strike'; id: string; target: PaperTarget }
  | { type: 'check'; id: string; target: PaperTarget };
export type FrameRef = { kind: 'frame'; id: string } | { kind: 'latest' } | { kind: 'live' } | { kind: 'fixture'; name: 'dfa-wrong' };
export interface PaperElements {                                                       // page coordinates; edge keys 'q0>q1'
  states: Record<StateId, { center: Pt; r: number }>;                                  // r in page-width units
  edges: Record<string, { path: Pt[]; label?: Pt }>;                                   // a self-loop's path runs around its state
  start?: { path: Pt[] };
}
export type PaperAction =
  | { kind: 'paper.freeze'; frame: FrameRef; elements?: PaperElements; spec?: AutomatonSpec }
  | { kind: 'paper.mark'; mark: PaperMark }
  | { kind: 'paper.unmark'; id: string }
  | { kind: 'paper.trace'; input: string }
  | { kind: 'paper.traceStep'; step?: number }
  | { kind: 'paper.clear' }
  | { kind: 'paper.live' };
export type StageAction = { kind: 'stage'; view: StageView };
export type BeatAction = BoardAction | PaperAction | StageAction;
export function parseAction(data: unknown): BeatAction | null;      // field by field, and checkAutomaton on every spec
// doc.ts
export const MOUTH_SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];
export interface MouthCue { start: number; end: number; value: MouthShape }            // seconds from the beat's first audio
export interface BeatWord { text: string; start: number | null; end: number | null }  // null until timing is known (P5-R4)
export interface BeatMarker { id: string; word: number; action: BeatAction }          // fires as words[word] is heard; word === words.length fires with the last word
export interface BeatDoc {
  version: 1; id: string; turn: string; segment: string; lang: Lang;
  text: string;                       // the line as captions show it
  durationSec: number | null;
  shapeSet: 'rhubarb9'; mouthCues: MouthCue[];
  words: BeatWord[]; markers: BeatMarker[];
}
export function parseBeatDoc(data: unknown): { doc: BeatDoc | null; problems: string[] };  // a bad marker is dropped and reported; anything else rejects the doc
export function restCues(durationSec: number): MouthCue[];                                // [{ start: 0, end: durationSec, value: 'X' }]
export function normalizeWord(text: string): string;                                      // NFC, lower case, only letters, digits and inner apostrophes
```

- Produces (renderer):

```ts
// tutor/types.ts, additive
  | { type: 'actions'; actions: BeatAction[] }                                         // apply now
  | { type: 'beat'; beat: BeatDoc }                                                    // apply as its words are heard
  | { type: 'word'; text: string; lang: Lang; segment?: string; index?: number }       // P2-R13's variant, plus where the word sits
// board/dispatch.ts
export function dispatchActions(actions: readonly unknown[]): void;   // parseAction each; invalid → one console.warn, the rest still apply
export function isShowing(action: BeatAction): boolean;
// board/motion.ts
export const MOTION: { revealMs: 180; drawMs: 320; fadeMs: 150; glideMs: 450; pulseMs: 600; cameraMs: 240;
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)'; glideEase: 'cubic-bezier(0.65, 0, 0.35, 1)' };
export function prefersReducedMotion(): boolean;   // false where matchMedia is missing
// board/use-session-lang.ts
export function useSessionLang(): Lang;            // the open session's language, else the UI language
// stubs, final signatures
export function applyBoardAction(action: BoardAction): void;   export const useBoardStore;       // board-store.ts
export function applyPaperAction(action: PaperAction): void;   export const useMarksStore;       // marks/marks-store.ts
export function BoardPanel(): JSX.Element | null;  export function PaperMarksLayer(): JSX.Element | null;  export function SnapshotTag(): JSX.Element | null;
export interface HeardWord { text: string; lang: Lang; segment?: string; index?: number; atMs: number }
export interface BeatPlayer { load(data: unknown): void; hear(word: HeardWord): void; reset(): void;
  onWord(listener: (m: { doc: BeatDoc; index: number; atMs: number }) => void): () => void }
export function createBeatPlayer(deps: { dispatch(actions: readonly unknown[]): void; now?: () => number; bufferMs?: number }): BeatPlayer;
export const beatPlayer: BeatPlayer;               // the session's player, dispatching through dispatchActions
```

- **`checkAutomaton` problems** (exact strings): `unknown start q9`, `duplicate state q1`, `unknown state q9 in q0>q9`, `two moves from q0 on 1`, `ε in a DFA`, `bad state id "q 1"`, `bad symbol "0,1"`.
- **`parseBeatDoc` problems** (exact strings, used by the fixtures): `bad version`, `words out of order at 2`, `mouthCues must start at 0 and end on X`, `mouthCues have a gap at 0.20`, `mouthCues need durationSec`, `marker m2 anchors to word 7 of 3`, `marker m1 has an invalid action`, `duplicate marker m1`. Limits: 80 words, 40 markers, ids ≤ 64 characters, `text` ≤ 400.
- **`dispatchActions`**, for each valid action in order:
  - `stage`: `requestMode(view)`.
  - `board.*`: if `isShowing(action)` and Ada's view (`pinned ? requested : mode`) is `paper`, `requestMode('split')` first; then `applyBoardAction`.
  - `paper.*`: the same with `board` as the hiding view; then `applyPaperAction`.
  - `isShowing` is true for every action except `board.focus`, `board.clear`, `board.automaton` with `reveal: 'none'`, `board.highlight` with `on: false`, `paper.unmark`, `paper.clear`, `paper.live` and `stage`.
- **`useTutorSession`** gains: `actions` → `dispatchActions(event.actions)`; `beat` → `beatPlayer.load(event.beat)`; `word` → `beatPlayer.hear({ …, atMs: performance.now() })`; and `beatPlayer.reset()` in its cleanup.
- **`Stage.tsx`** (P5-R8): `<PaperMarksLayer />` after the paper panel's body; `<SnapshotTag />` in the paper `TopLine`'s `trailing` slot (add the optional `trailing?: ReactNode`, rendered after `PinIndicator`, if P3 hasn't); `<BoardPanel />` first in the board `Panel`, before its `TopLine`.
- **`fixtures.json`** holds `actions` (one of every kind, using the demo's DFAs), `invalidActions` (`{ data, why }`: an unknown start, two moves on one symbol, ε in a DFA, a mark with no target, `edge:q0` as a ref, an unknown kind, a 281-character callout), `beats` (a fake-style document with times and rest cues, a live-style one with null times and no cues, a wordless one) and `invalidBeats` (`{ data, problem }`, one per problem string). Task 9's Python models test against the same file.

- [ ] **Step 1: Write the failing tests.**
  - **`beats.test.ts`:**
    - `it.each(fixtures.actions)('parses the $kind action', (a) => expect(parseAction(a)).toEqual(a))`;
    - `it.each(fixtures.invalidActions)('rejects $why', ({ data }) => expect(parseAction(data)).toBeNull())`;
    - `it.each(fixtures.beats)('accepts beat $id', (d) => expect(parseBeatDoc(d)).toEqual({ doc: d, problems: [] }))`;
    - `it.each(fixtures.invalidBeats)('reports $problem', ({ data, problem }) => expect(parseBeatDoc(data).problems).toContain(problem))`;
    - `a bad marker is dropped and the rest of the beat kept`: markers `[ok, bad]` give one marker and `['marker m2 has an invalid action']`;
    - `checkAutomaton names each problem` (the strings above);
    - `restCues(1.25)` is `[{ start: 0, end: 1.25, value: 'X' }]`;
    - `normalizeWord`: `'Today?'` → `'today'`, `"I'm"` → `"i'm"`, `'1010.'` → `'1010'`, `'«q0»,'` → `'q0'`, `'E\u0301l'` → `'él'`, `'상태를,'` → `'상태를'`;
    - `edgeRef('q0', 'q1')` is `'edge:q0>q1'`; `parseElementRef('edge:q0>q0')` is `{ kind: 'edge', from: 'q0', to: 'q0' }`; `parseElementRef('edge:q0')` is null.
  - **`dispatch.test.ts`** (stores real, the stub sinks spied):
    - `routes stage, board and paper actions in order`;
    - `a showing board action on the paper view requests split`;
    - `a showing board action while pinned to paper keeps the pin and remembers split` (Review Focus 1): after `pin('paper')`, mode stays `paper`, `requested` is `split`;
    - `a showing paper action on the board view requests split`;
    - `focus, clear, reveal none and paper.live never change the view`;
    - `an invalid action is skipped with one warning and the next still applies` (Review Focus 5).
  - **`tutor-routing.test.tsx`** (jsdom, P1's `scriptedTutor` pattern): `an actions event dispatches its actions`; `a beat event fires its markers through the player`; `a word event reaches the player with its segment and index`; `unmount resets the player`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/shared test beats && pnpm --filter @tassel/desktop test board/`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the contract, the seams and the stubs, add the copy, and install the dependencies.** Hand-write the guards; no validation library. Run `pnpm install`, and check that pnpm 12's release-age gate held back none of the three pins (P2's global constraint on `minimumReleaseAgeExclude`); all three are weeks old.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's command, then `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck && pnpm check:i18n`, then `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e fake-tutor session-layout`. Expected: PASS, and P1's unit and E2E specs still pass with the new mounts.
- [ ] **Step 5: Commit.** `git add packages/shared apps/desktop pnpm-lock.yaml && git commit -m "feat(board): P5 contract, dispatcher, stubs and copy"`

### Task 2: Automaton runs and Graphviz layout

**Files:**
- Create: `board/automata/run.ts`
- Create: `board/layout/types.ts`, `dot.ts`, `from-graphviz.ts`, `fallback.ts`, `viz.ts`, `messages.ts`, `worker.ts`, `client.ts`
- Test: `tests/unit/board/automata/run.test.ts`, `tests/unit/board/layout/dot.test.ts`, `layout.test.ts`, `client.test.ts`

**Interfaces:**
- Consumes: `AutomatonSpec`, `ElementRef`, `edgeRef`, `EPSILON`, `Pt` (Task 1); `@viz-js/viz` `instance()` and `viz.renderString(dot, { format: 'json0' })` ([API](https://viz-js.com/api/)).
- Produces:

```ts
// automata/run.ts
export interface RunStep { index: number; symbol: string; from: StateId[]; to: StateId[]; edges: ElementRef[] }
export interface AutomatonRun { input: string; steps: RunStep[]; final: StateId[]; accepted: boolean; stuckAt: number | null }
export function runAutomaton(spec: AutomatonSpec, input: string): AutomatonRun;
export function mergedEdges(spec: AutomatonSpec): Array<{ from: StateId; to: StateId; symbols: string[] }>;
// layout/types.ts
export const STATE_RADIUS = 32;
export interface AutomatonLayout {                    // board px, origin top-left, y down
  width: number; height: number;
  states: Record<StateId, { x: number; y: number; r: number }>;        // centers
  edges: Record<string, { bend: number; label: Pt; loop: 'top' | 'bottom' | 'left' | 'right' | null }>;   // key 'q0>q1'
  start: { from: Pt; to: Pt };
}
// layout/dot.ts
export function toDot(spec: AutomatonSpec): string;
// layout/from-graphviz.ts
export interface GraphvizJson0 { bb: string; objects?: Array<{ name: string; pos?: string }>;
  edges?: Array<{ id?: string; tail: number; head: number; pos?: string; lp?: string }> }
export function fromGraphvizJson(json: GraphvizJson0, spec: AutomatonSpec): AutomatonLayout;
// layout/viz.ts
export function layoutWithViz(spec: AutomatonSpec): Promise<AutomatonLayout>;   // one viz instance per thread
// layout/fallback.ts
export function fallbackLayout(spec: AutomatonSpec): AutomatonLayout;   // no Graphviz: one row 112 px apart, loops on top, neighbors straight,
                                                                         // longer edges bent 40 px (forward above, backward below); Task 5 uses it when the worker fails
// layout/messages.ts
export type ToLayoutWorker = { id: number; spec: AutomatonSpec };
export type FromLayoutWorker = { id: number; layout: AutomatonLayout } | { id: number; error: string };
// layout/client.ts
export interface LayoutClient { layout(spec: AutomatonSpec): Promise<AutomatonLayout>; dispose(): void }
export function createLayoutClient(opts?: { createWorker?: () => Worker; timeoutMs?: number }): LayoutClient;  // timeout 4000; cached by canonical spec JSON
export function getLayoutClient(): LayoutClient;      // the renderer's shared client, made on first use
```

- **Runs.** A DFA holds one state. A missing move gives `to: []`, `stuckAt = index`, and ends the run there (`accepted: false`): the implicit dead state of spec §5.3. An NFA holds the ε-closure, at the start and after each symbol, in spec order. `edges` are the merged edges taken. `mergedEdges` gives one entry per ordered pair, in order of first appearance, with symbols unique and in first-seen order.
- **DOT**, exactly (states and edges in spec order; ids quoted):

```
digraph automaton {
  rankdir=LR; nodesep=0.45; ranksep=0.6; splines=true;
  node [shape=circle, fixedsize=true, width=0.8889, label="", fontsize=14];
  edge [arrowsize=0.7, fontsize=14];
  "__start" [shape=point, width=0.01, style=invis];
  "q0"; "q1"; "q2"; "q3" [shape=doublecircle]; "qd";
  "__start" -> "q0" [id="start"];
  "q0" -> "q1" [id="q0>q1", label="0"];
  "q3" -> "q3" [id="q3>q3", label="0,1"];
}
```

  `width=0.8889` in is 64 pt, twice `STATE_RADIUS`. Edges carry `id`, because Graphviz returns edges out of their input order ([json docs](https://graphviz.org/docs/outputs/json/)); `__start` keeps a `pos` even though it's invisible.
- **`fromGraphvizJson`.** Graphviz points are board px; y is flipped against `bb` (Graphviz's origin is bottom-left), and everything is shifted 16 px in, so `width` and `height` are `bb` plus 32.
  - Edge `pos` is `[e,x,y] [s,x,y] p0 p1 …`, cubic B-spline points ([splineType](https://graphviz.org/docs/attr-types/splineType/)). The curve's midpoint is the point at half its sampled length.
  - `bend` is that midpoint's signed distance from the chord between the two state centers: positive to the left of tail → head, in y-down coordinates. It is clamped to ±0.6 × the chord, and anything under 4 px becomes 0. Task 5 maps the sign to tldraw's.
  - A self-loop has `bend` 0 and `loop` set to the side of `lp` from the state's center.
  - `label` is `lp` when present, else the midpoint. `start.to` is the start state's boundary point toward `__start`.

- [ ] **Step 1: Write the failing tests.** Fixtures `WRONG` (q0 start; q0-0-q1, q1-1-q2, q2-0-q3, q3-0,1-q3, q0-1-q0; q3 accepts) and `CORRECT` (adds qd: q0-1-qd, q1-0-qd, q2-1-qd, qd-0,1-qd) live in `tests/unit/board/fixtures.ts`.
  - **run:**
    - `the wrong DFA accepts 1010 through q0's loop`: edges `['edge:q0>q0', 'edge:q0>q1', 'edge:q1>q2', 'edge:q2>q3']`, final `['q3']`, accepted;
    - `the reference DFA rejects 1010 in the dead state`: `steps[0].to` is `['qd']`, final `['qd']`, not accepted;
    - `a missing move gets stuck and rejects`: WRONG on `00` gives `stuckAt` 1, two steps, `steps[1].to` `[]`;
    - `an NFA follows ε-moves`: q0 -ε→ q1 -a→ q2 (accepting) on `a` gives `steps[0].from` `['q0', 'q1']` and accepts;
    - `mergedEdges merges q3's 0 and 1 into one loop`.
  - **dot:** `toDot(CORRECT)` contains `rankdir=LR`, `"q3" [shape=doublecircle]`, `"__start" -> "q0" [id="start"]` and `"q3" -> "q3" [id="q3>q3", label="0,1"]`, and two calls give the same string.
  - **layout** (Node, real viz, `{ timeout: 30_000 }`):
    - `lays the reference DFA out left to right`: `q0.x < q1.x < q2.x < q3.x` and `qd.x > q0.x`;
    - `keeps states apart`: every pair at least 80 px between centers;
    - `puts the start arrow on q0's left`: `start.to` within 2 px of `(q0.x − 32, q0.y)`, and `start.from.x < start.to.x`;
    - `marks self-loops`: `q3>q3` and `qd>qd` have `loop`, other edges don't;
    - `fits its box`: every state ± r lies inside `[0, width] × [0, height]`;
    - `is deterministic`: two layouts are deep-equal;
    - `fallbackLayout keeps the same contract`: states in spec order on one row, 112 px apart, loops on top, every edge keyed, and the same `fits its box` and `keeps states apart` checks;
    - `bends a pair of opposite edges to opposite sides`: with q0 -a→ q1 and q1 -b→ q0, the two `bend`s have opposite signs.
  - **client** (an injected fake worker that runs `layoutWithViz` in-process; `vi.useFakeTimers` for the timeout):
    - `resolves a layout through the worker`;
    - `serves the same spec from its cache`: two calls, one message;
    - `rejects with the worker's error`;
    - `rejects after 4000 ms without an answer`;
    - `dispose terminates the worker and rejects pending calls`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/automata board/layout`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `worker.ts` is a **classic** worker: the client makes it with `new Worker(new URL('./worker.ts', import.meta.url))`, with no `type`, which Vite bundles as one IIFE chunk ([worker options](https://vite.dev/config/worker-options)). Never `?worker&inline` (P5-R3).
  - It types its scope structurally (`interface LayoutScope { onmessage: …; postMessage(m: FromLayoutWorker): void }`, `self as unknown as LayoutScope`), so it compiles under `tsconfig.web.json` with no WebWorker lib.
  - If the IIFE chunk fails to run viz in Task 5's E2E, switch to `{ type: 'module' }` (viz-js.com runs it in a module worker, [worker.js](https://github.com/mdaines/viz-js/blob/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f/website/src/worker.js)) and say so in the report.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's command and `pnpm --filter @tassel/desktop typecheck`, then `pnpm --filter @tassel/desktop build`. Expected: PASS, and `out/renderer/assets/` holds a worker chunk containing `WebAssembly.instantiate`.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(board): automaton runs and Graphviz layout in a worker"`

### Task 3: The board scene

**Files:**
- Create: `board/scene/types.ts`, `reduce.ts`, `placement.ts`
- Test: `tests/unit/board/scene/reduce.test.ts`, `placement.test.ts`

**Interfaces:**
- Consumes: `BoardAction`, `ElementRef`, `parseElementRef`, `edgeRef` (Task 1); `runAutomaton`, `mergedEdges`, `AutomatonLayout` (Task 2).
- Produces:

```ts
export interface AutomatonItem { kind: 'automaton'; id: string; title: string | null; spec: AutomatonSpec;
  revealed: 'all' | ElementRef[]; highlighted: ElementRef[]; current: StateId[] }
export interface TraceItem { kind: 'trace'; id: string; title: string | null; spec: AutomatonSpec; input: string; run: AutomatonRun;
  shown: number; subject: 'student' | 'tutor'; on: string | null;
  verdict: { got: 'accept' | 'reject'; expected: 'accept' | 'reject' | null; note: string | null } | null }
export interface NoteItem { kind: 'note'; id: string; text: string; near: { item: string; el: ElementRef } | null }
export type BoardItem = AutomatonItem | TraceItem | NoteItem;
export interface BoardScene { items: BoardItem[]; focus: string | null; rev: number }
export type BoardEffect = { type: 'pulse'; item: string; el: ElementRef } | { type: 'glide'; item: string; edges: ElementRef[] };
export const EMPTY_SCENE: BoardScene;            // { items: [], focus: null, rev: 0 }
export function reduceBoard(scene: BoardScene, action: BoardAction): { scene: BoardScene; effects: BoardEffect[]; problem: string | null };
export function elementsOf(spec: AutomatonSpec): ElementRef[];      // 'start', then states, then merged edges
export function isRevealed(item: AutomatonItem, el: ElementRef): boolean;
// placement.ts
export interface Box { x: number; y: number; w: number; h: number }
export const ITEM_GAP = 64;
export function traceSize(input: string, rows: number, verdict: boolean): { w: number; h: number };  // w = max(440, 40 + 52·len); h = 132 + 42·rows + (verdict ? 56 : 0)
export function itemSize(item: BoardItem, layouts: Readonly<Record<string, AutomatonLayout>>): { w: number; h: number } | null;
export function placeItems(scene: BoardScene, layouts: Readonly<Record<string, AutomatonLayout>>): Record<string, Box>;
```

- **Rules** (each a test). A problem never throws; it returns the scene unchanged (the same object) with `problem` set, except where a rule says the valid part still applies. Every change bumps `rev`.
  - `board.automaton` adds the item, or replaces one with the same id (resetting `revealed`, `highlighted` and `current`), and focuses it. `revealed` is `[]` for `reveal: 'none'`, else `'all'`.
  - `board.addState` on an unknown item gives `unknown item fix`; a duplicate gives `duplicate state q1`. A new state is revealed when `revealed` is a list.
  - `board.addTransition` needs both states, merges symbols into an existing pair, and reveals the edge as above.
  - `board.reveal` with no `els` reveals everything. With `els`, unknown refs give `unknown element edge:q9>q1` while the known ones still apply. Revealing an edge reveals both its states; `start` reveals the start state.
  - `board.highlight` adds or removes the element; `board.pulse` emits a `pulse` effect for a revealed element, else `not shown state:qd`.
  - `board.note` adds or replaces a note; an unknown `near` gives a problem and the note still goes in, with `near: null`.
  - `board.trace` adds a trace item (`run = runAutomaton(spec, input)`, `shown` 0, `subject` defaulting to `tutor`) and focuses it. A known `on` sets that automaton's `current` to the run's starting states; an unknown one gives a problem and `on: null`.
  - `board.traceStep` sets `shown` to `step ?? shown + 1`, clamped to the number of steps. With `on`, it emits `glide` along that step's edges and sets `current` to its `to`.
  - `board.verdict` sets the verdict. `board.focus` sets `focus` (null means everything). `board.clear` removes one item and the notes near it, or everything.
- **Placement.** Items stack in one column at x 0, in scene order, `ITEM_GAP` apart. A note with `near` sits 32 px right of that item's box, at its top. An automaton's size is its layout's size, plus 28 px for a title row. Items after one whose size isn't known yet stay unplaced until it is, so nothing jumps when a layout arrives.

- [ ] **Step 1: Write the failing tests:** one per rule above, plus:
  - `reveal before the automaton exists is a problem, not a throw` (Review Focus 5);
  - `twelve bad actions in a row leave the scene unchanged and never throw`;
  - placement: `stacks items 64 apart`; `puts a note beside its item`; `leaves items after a pending layout unplaced`; `traceSize(1010, 4, true)` is `{ w: 440, h: 356 }`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/scene`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pure functions and immutable updates; no store here.
- [ ] **Step 4: Run them and confirm they pass.** Same command, plus `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(board): the board scene and its placement"`

### Task 4: tldraw in the board panel

**Files:**
- Create: `apps/desktop/config/tldraw-license.ts`
- Modify: `apps/desktop/electron.vite.config.ts` (the renderer's `define`), `apps/desktop/tsconfig.node.json` (include `config`)
- Create: `board/tldraw/TldrawCanvas.tsx`, `assets.ts`, `theme.ts`, `board.css`, `env.d.ts` (`declare const __TASSEL_TLDRAW_LICENSE_KEY__: string;`). Nothing here needs Track B's code, so Task 4 runs alongside Tasks 2 and 3.
- Modify (replace Task 1's stub): `board/BoardPanel.tsx`
- Modify: `apps/desktop/tests/unit/setup.ts` (P1's): one `vi.mock` that turns `board/tldraw/TldrawCanvas` into a component rendering nothing, so jsdom tests (P1's session-screen tests show the board too) never load tldraw
- Create: `tests/e2e/board/tldraw-key.ts` (`hasTldrawKey()`, through `readTldrawLicenseKey`)
- Test: `tests/unit/board/tldraw-license.test.ts`, `tests/unit/board/import-boundary.test.ts`, `tests/unit/board/board-panel.test.tsx`, `tests/e2e/board/board-canvas.spec.ts`

**Interfaces:**
- Consumes: Task 1's stubs and `MOTION`; P1's `Stage` panels and `useStageStore`; tldraw 5.5.2's `<Tldraw>` props `licenseKey`, `hideUi`, `autoFocus`, `colorScheme`, `themes`, `initialTheme`, `assetUrls`, `options`, `shapeUtils`, `overlayUtils` and `onMount` ([TldrawEditor.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/TldrawEditor.tsx#L117-L256), [Tldraw.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/Tldraw.tsx#L75-L113)); Node's `util.parseEnv` ([docs](https://nodejs.org/api/util.html#utilparseenvcontent), added in 20.12.0 and 21.7.0); Vite's `define` ([docs](https://vite.dev/config/shared-options#define)).
- Produces:

```ts
// apps/desktop/config/tldraw-license.ts: Node, at build and dev time
export interface TldrawKey { key: string | null; from: 'environment' | 'services/server/.env' | null }
export function readTldrawLicenseKey(opts?: { env?: NodeJS.ProcessEnv; serverEnvFile?: string;
  readFile?: (path: string) => string | null }): TldrawKey;          // never throws, never logs the key
// board/tldraw/TldrawCanvas.tsx
export function TldrawCanvas(props: { onEditor(editor: Editor | null): void }): JSX.Element;
// board/tldraw/assets.ts and theme.ts
export const BOARD_ASSET_URLS: ReturnType<typeof getAssetUrlsByImport>;   // at module scope
export const TASSEL_THEME: TLTheme;                                        // id 'tassel'
```

- **The key** (P5-R2). `readTldrawLicenseKey` takes `env.TLDRAW_LICENSE_KEY`. Without it, it parses `services/server/.env` (resolved from `apps/desktop`) with `util.parseEnv` and takes that file's `TLDRAW_LICENSE_KEY`. Values are trimmed; empty means none. `electron.vite.config.ts` calls it once, sets the renderer's `define: { __TASSEL_TLDRAW_LICENSE_KEY__: JSON.stringify(key ?? '') }`, and prints exactly one line, never the key: `[tassel] tldraw license key: from environment`, `… from services/server/.env`, or `… none (dev works; production builds blank the board)`.
- **The canvas** (`TldrawCanvas`, tldraw 5.5.2's `<Tldraw>`):
  - `licenseKey={__TASSEL_TLDRAW_LICENSE_KEY__ || undefined}`, `hideUi`, `autoFocus={false}`, `colorScheme="light"`, `themes={[TASSEL_THEME]}`, `initialTheme="tassel"`, `assetUrls={BOARD_ASSET_URLS}`, and no `persistenceKey`, so each session's board starts empty.
  - **Self-hosted assets:** `getAssetUrlsByImport()` from `@tldraw/assets/imports.vite` ([installation](https://tldraw.dev/installation#Static-assets)). Without it tldraw loads fonts, icons and translations from `cdn.tldraw.com`, and the page CSP blocks the fonts and icons ([assetUrls.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/ui/assetUrls.ts#L15-L34)). `board.css` imports `tldraw/tldraw.css`.
  - **`TASSEL_THEME`** ([themes](https://tldraw.dev/sdk-features/themes)): tldraw's light palette, with `black` = ink `#222222`, `violet` = iris-ink `#7d4fc4` and `light-violet` = iris `#c094e4`; fonts `sans` = `Geist, "Pretendard Variable", sans-serif` and `mono` = `"Geist Mono", "Pretendard Variable", monospace`, which P1's `fonts.css` already loads.
  - **No background or grid** from tldraw: the canvas is transparent, so P1's dotted `.board-canvas` shows through.
  - **`onMount`:**
    - `editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false })`, and `options.enableToolbarKeyboardShortcuts: false`. `hideUi` keeps tldraw's shortcuts, which would take letters such as B and C ([useKeyboardShortcuts.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/ui/hooks/useKeyboardShortcuts.ts#L36-L80)).
    - Turn off pasting files and links, by registering handlers that do nothing for those external content types: a pasted link would fetch a preview.
    - Then `onEditor(editor)`, with a cleanup that calls `onEditor(null)`.
- **`BoardPanel`** mounts with the stage and renders `data-testid="board-canvas"` at `absolute inset-0`. It mounts `TldrawCanvas` lazily, the first time the board panel shows (Task 5 adds: or the board store holds an item), and keeps it mounted from then on. A session that never shows the board never loads tldraw. The canvas comes through `React.lazy` inside an error boundary: if tldraw fails to load or crashes, the panel keeps P1's dotted canvas, warns once, and the session carries on.
- **The boundary:** only `board/tldraw/**` imports `tldraw` or `@tldraw/*`, and only `board/layout/**` imports `@viz-js/viz`. An Excalidraw engine would replace `board/tldraw/` and nothing else.

- [ ] **Step 1: Write the failing tests.**
  - **`tldraw-license.test.ts`** (Node; temporary directories and made-up keys such as `tldraw-test-0000`, never the real file):
    - `the environment wins over the file`;
    - `reads TLDRAW_LICENSE_KEY from the server's .env, with comments and quotes`;
    - `a missing file or an empty value means no key`;
    - `never logs the key` (console spied).
  - **`import-boundary.test.ts`:** `only board/tldraw imports tldraw` and `only board/layout imports viz`. Both scan `src/renderer/src/**/*.{ts,tsx}` and expect no offenders.
  - **`board-panel.test.tsx`** (jsdom, the canvas mocked): `the canvas mounts only once the board panel shows, and stays`; `a canvas that throws leaves the dotted panel and warns once`.
  - **E2E `board-canvas.spec.ts`:**
    - `mounts self-hosted and quiet` (no key needed): start a session and press B three times (Board pinned).
      1. `[data-testid="board-canvas"] .tl-container` shows within 5 s.
      2. No request goes to any host but `app://`, `blob:`, `data:` and the E2E server, except tldraw's license ping `https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg`.
      3. No console error, and no `securitypolicyviolation` event (a listener added through `page.evaluate` before the board shows).
      4. After a click on the canvas, C still toggles the captions (P1's shortcut).
      5. `snap('p5-board-canvas-1440')`.
    - `stays alive past the license window` (`test.skip(!hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)')`): after 6 s, `.tl-container` is still there and `[data-testid="tl-license-expired"]` isn't. This is the day-one check that the owner's key covers `app://tassel`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/tldraw-license board/import-boundary board/board-panel`, then `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e board/board-canvas`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the task report, record tldraw 5.5.2's DOM attribute names for a shape's container (its type and its id); Tasks 5 and 6 select on them.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's commands, plus the whole `pnpm --filter @tassel/desktop test` (P1's session-screen tests show the board, through the mock) and `typecheck`. Expected: PASS, and the build prints the key line without the key.
- [ ] **Step 5: Commit.** `git add apps/desktop pnpm-lock.yaml && git commit -m "feat(board): tldraw in the board panel, self-hosted, keyed at build time"`

### Task 5: Ada's shapes on the board

**Files:**
- Create: `board/engine.ts` (the engine-agnostic interface); `board/tldraw/shapes/types.ts`, `StateShape.tsx`, `TraceShape.tsx`, `NoteShape.tsx`; `board/tldraw/desired.ts`, `plan-sync.ts`, `engine.ts`, `effects.ts`, `camera.ts`; `board/BoardDescription.tsx`
- Modify: `board/board-store.ts` (replace Task 1's stub), `board/BoardPanel.tsx` (attach the engine; render `BoardDescription`; also mount tldraw once the store holds an item), `board/tldraw/TldrawCanvas.tsx` (the shape and overlay utils), `board/tldraw/board.css` (the reveal fade), `tutor/scripts/board-demo.json`
- Test: `tests/unit/board/tldraw/desired.test.ts`, `plan-sync.test.ts`, `tests/unit/board/board-store.test.ts`, `board-description.test.tsx`, `tests/e2e/board/board-demo.spec.ts`

**Interfaces:**
- Consumes:
  - Tasks 2–4: `reduceBoard`, `placeItems`, `traceSize`, `BoardScene`, `BoardEffect`, `getLayoutClient`, `fallbackLayout`, `AutomatonLayout`, `TldrawCanvas`;
  - tldraw 5.5.2:
    - shapes: `ShapeUtil` and `BaseBoxShapeUtil` (`getDefaultProps`, `getGeometry`, `component`, `getIndicatorPath`, `static props` with `T`) ([BaseBoxShapeUtil.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/shapes/BaseBoxShapeUtil.tsx#L13-L38)), `OverlayUtil`;
    - helpers: `createShapeId`, `toRichText`;
    - editor: `createShapes`, `updateShapes`, `deleteShapes`, `createBindings`, `deleteBindings`, `store.mergeRemoteChanges`, `run(fn, { history: 'ignore', ignoreShapeLock: true })`, `zoomToBounds(bounds, { inset, targetZoom, animation })`;
    - arrows: arrow props and binding props `terminal`, `normalizedAnchor`, `isExact`, `isPrecise` ([TLArrowBinding.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/bindings/TLArrowBinding.ts#L28-L78)).
- Produces:

```ts
// board/engine.ts: what the rest of the app knows of a board (P5-R1's thin wrapper); imports nothing from tldraw
export interface StudentBoardEdit { at: string; changed: string[]; removed: string[]; shapes: unknown[]; image: Blob | null; automata: AutomatonSpec[] }
export interface BoardEngine {
  render(scene: BoardScene, layouts: Readonly<Record<string, AutomatonLayout>>): void;
  play(effect: BoardEffect): Promise<void>;                          // resolves when it ends; at once under reduced motion
  focus(item: string | null, opts: { animate: boolean }): void;      // null fits everything
  onStudentEdit(listener: (edit: StudentBoardEdit) => void): () => void;   // Task 6 fills it; until then it never fires
  dispose(): void;
}
// shapes/types.ts: declare module 'tldraw' { interface TLGlobalShapePropsMap { … } }  (https://tldraw.dev/docs/shapes)
'tassel-state': { w: number; h: number; label: string; accept: boolean; ring: 'none' | 'highlight' | 'current' }
'tassel-trace': { w: number; h: number; lang: Lang; input: string; title: string | null; kind: 'dfa' | 'nfa'; subject: 'student' | 'tutor';
  rows: Array<{ symbol: string; from: string; to: string; loop: boolean; stuck: boolean }>; shown: number;
  verdict: { got: 'accept' | 'reject'; note: string | null } | null }
'tassel-note': { w: number; h: number; text: string; variant: 'note' | 'title' }
// desired.ts: pure; imports nothing from tldraw
export interface DesiredShape { id: string; type: 'tassel-state' | 'tassel-trace' | 'tassel-note' | 'arrow'; x: number; y: number;
  opacity: 0 | 1; props: Record<string, unknown>; meta: { ada: true; item: string; el: string } }
export interface DesiredBinding { id: string; arrow: string; to: string; terminal: 'start' | 'end'; normalizedAnchor: Pt; isPrecise: boolean }
export interface Desired { shapes: Map<string, DesiredShape>; bindings: Map<string, DesiredBinding> }
export const NO_SHAPES: Desired;
export function adaShapeId(item: string, el: string): string;      // `shape:ada.${item}.${el}`
export function desiredBoard(scene: BoardScene, layouts: Readonly<Record<string, AutomatonLayout>>, lang: Lang): Desired;
// plan-sync.ts: pure
export interface SyncPlan { create: DesiredShape[]; update: Array<{ id: string; type: string } & Partial<DesiredShape>>;
  remove: string[]; bind: DesiredBinding[]; unbind: string[] }
export function planSync(prev: Desired, next: Desired): SyncPlan;
// engine.ts
export function createTldrawEngine(editor: Editor, opts?: { reducedMotion?: () => boolean; container?: HTMLElement }): BoardEngine;
// board-store.ts (final)
export interface BoardState { scene: BoardScene; layouts: Record<string, AutomatonLayout>;
  apply(action: BoardAction): void; attach(engine: BoardEngine): () => void; reset(): void }
export const useBoardStore: UseBoundStore<StoreApi<BoardState>>;
export function applyBoardAction(action: BoardAction): void;
// BoardDescription.tsx
export function BoardDescription(): JSX.Element;    // a visually hidden list named board.description.label, in the session language
```

- **`desiredBoard`** (each rule a test):
  - Each item goes at its `placeItems` box. An automaton with a title gets a `tassel-note` (`variant: 'title'`) at the top of its box, and its states start 28 px lower.
  - **A state:** a `tassel-state` at its center minus r, with `w = h = 2r`, `label` its id, and `accept`. `ring` is `current` when the state is in the item's `current`, else `highlight` when it's in `highlighted`, else `none`. `opacity` is 1 when revealed, else 0.
  - **A merged edge:** an `arrow` at the tail's center:
    - props `kind: 'arc'`, `bend` (Task 2's sign, mapped to tldraw's), the label `symbols.join(',')` (the engine turns it into `richText` with `toRichText`), `color` `violet` when highlighted else `black`, `size: 's'`, `font: 'mono'`, `arrowheadEnd: 'arrow'`, `arrowheadStart: 'none'`, `labelPosition: 0.5`;
    - two bindings, each with `isPrecise: false` and anchor `{ x: 0.5, y: 0.5 }`.
  - **A self-loop:** both ends bound to its state, with the anchors for its `loop` side (top: `{0.3, 0.06}` and `{0.7, 0.06}`; bottom mirrors y; left and right swap the axes), and `bend` `−1.6 r`. When both ends bind one shape, tldraw uses the anchors even with `isPrecise: false` ([shared.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/shapes/arrow/shared.ts#L73-L99)); @tldraw/mermaid draws its loops the same way ([renderBlueprint.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/mermaid/src/renderBlueprint.ts#L238-L299)).
  - **The start arrow:** an `arrow` from `layout.start.from`, with only its end bound.
  - **A trace:** a `tassel-trace` sized by `traceSize`. Its rows come from the run: `loop` when a step's `from` equals its `to`, `stuck` when its `to` is empty. It also carries `kind`, `subject` and `lang`.
  - **A note:** a `tassel-note`.
- **`planSync` diffs Ada's last desired board against the new one, never against the editor.** So Ada changes only what she changed: a state the student moved stays where she put it, and a shape she erased isn't recreated. Each `update` carries only the changed fields.
- **The engine:**
  - It applies a plan inside `editor.store.mergeRemoteChanges(() => editor.run(…, { history: 'ignore', ignoreShapeLock: true }))`. Ada's changes are therefore `remote`, so they never count as the student's (Task 6), and they stay out of undo. Updates and bindings for shapes that no longer exist are skipped.
  - **Reveals** change only `opacity`. `board.css` fades Ada's shapes with an opacity transition of `MOTION.revealMs` on tldraw's shape containers whose id starts with `shape:ada.` (the attribute names from Task 4's report), and none under reduced motion. Never `animateShape` (P5-R1).
  - **`play`:** a `pulse` draws an iris-ink ring that grows from r + 4 to r + 14 and fades over `MOTION.pulseMs`; a `glide` moves a 10 px token along each edge, `MOTION.glideMs` per edge (Task 10 adds its path). Both are entries of `AdaEffectsOverlay`, an `OverlayUtil`, so nothing is stored ([overlay utils](https://tldraw.dev/sdk-features/overlay-utils)). Under reduced motion `play` resolves at once and draws nothing.
  - **`focus`** fits the item's box (or every item) with `zoomToBounds`: inset 48, `targetZoom` at most 1.25, animated over `MOTION.cameraMs`, instant under reduced motion.
  - It refits the current focus whenever the panel resizes (a `ResizeObserver`, debounced 120 ms), so the stage reflow and an unpin both end fitted (Review Focus 1).
- **The shapes:**
  - `StateShape` (`BaseBoxShapeUtil`): the values in Global Constraints, drawn in SVG. `getIndicatorPath` is its circle. Its root carries `data-accept`, `data-ring` and an `aria-label` such as "q3, accepting".
  - `TraceShape`: the mock's board trace (`stage.html`), all in the shape's `lang`:
    - the title `board.trace.title`, then the tape;
    - the rows: `board.trace.step`, `board.trace.read`, `q0 → q1`, `board.trace.loops` and `board.trace.stuck`. Only rows below `shown` render;
    - the verdict row: `board.verdict.yours` or `board.verdict.this`, with `board.kind.*` and `board.verdict.*`.

    Task 10 adds its motion.
  - `NoteShape`: the note pill, or a `title` (mono 12, smoke-text).
- **The store:**
  - **`apply`:**
    - reduces the action; a problem warns once as `[board] <problem>`;
    - lays out each automaton whose spec changed through `getLayoutClient()`. When that fails it falls back to `fallbackLayout`, with one warning;
    - holds an effect until its item's layout exists, then `play`s it;
    - renders on every change while an engine is attached.
  - **`attach`** renders at once and returns a detach.
  - **`reset`** empties the scene, the layouts and the held effects. `BoardPanel` resets it on mount and unmount, so every session starts blank, and a scene that arrives before tldraw has loaded renders when the engine attaches.
- **`board-demo.json`** (FakeScript steps; speed-1 times):
  - 0 connecting; 800 listening;
  - 1500 student "Can you show me a DFA for strings that start with 010?";
  - 2500 speaking; 2600 Ada "Here's one. We start at q0.";
  - 2700 `board.automaton fix` (CORRECT, `reveal: 'none'`); 3000 `board.reveal fix [start]`;
  - 3600, 4200, 4800 and 5400 reveal `edge:q0>q1`, `edge:q1>q2`, `edge:q2>q3` and `edge:q3>q3`;
  - 6000 reveal `state:qd` and pulse it; 6600 reveal `edge:q0>qd`, `edge:q1>qd` and `edge:q2>qd`; 7200 reveal `edge:qd>qd`; 7800 highlight `state:qd`;
  - 8400 listening.

- [ ] **Step 1: Write the failing tests.**
  - **desired:**
    - `a hidden automaton has every shape at opacity 0`;
    - `revealing q0>q1 shows the arrow and both states`;
    - `the q3 loop binds q3 twice, at its top anchors`;
    - `the start arrow binds only its end`;
    - `a highlighted edge is violet, and a current state rings`;
    - `a titled automaton puts its title on top and its states 28 px lower`;
    - `ids are stable across calls`.
  - **plan-sync:**
    - `an unchanged board plans nothing`;
    - `a reveal updates only opacity`;
    - `a removed item removes its shapes and bindings`;
    - `Ada's later changes never move a state back`: prev and next differ only in another shape, so the plan has no update for it;
    - `a re-laid-out automaton moves only its states`.
  - **board-store** (a fake engine and layout client):
    - `a scene that arrives before an engine renders when one attaches`;
    - `effects wait for their layout`;
    - `a layout failure falls back with one warning`;
    - `reset empties the scene`.
  - **board-description** (jsdom): `lists revealed states, the start, accepting states and transitions in the session language`; `hidden elements aren't listed`.
  - **E2E `board-demo.spec.ts`** (`test.skip(!hasTldrawKey(), …)`). Collect console warnings and errors; expect none.
    1. After the script, the board region shows beside the paper: Ada's first showing action split the stage.
    2. There are five `tassel-state` shapes, labelled q0, q1, q2, q3 and qd; only q3 has `data-accept="true"`; all are at computed opacity 1; and there are nine arrows.
    3. The description list reads "States: q0, q1, q2, q3, qd" and "Accepting: q3", and contains "q2 to qd on 1".
    4. Every state's box lies inside the board region at 1440×900, and again after `setWindowSize(app, page, 1024, 680)`.
    5. The `0,1` label of q3's loop is above q3's center, and the `1` label of q0→qd sits on the side Graphviz put it (checks the bend's sign).
    6. A second test at `TASSEL_FAKE_SPEED=1` presses B before 2.7 s, pinning Paper. The board region stays absent and "Ada asks: Paper and board" shows; after Unpin, the board appears with every state inside it (Review Focus 1).
    7. `snap('p5-board-demo-1440')` and `snap('p5-board-demo-1024')`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/`, then the E2E. Expected: FAIL.
- [ ] **Step 3: Implement.** Before the shapes, read the mock's board (`stage.html`) and Global Constraints' visual values.
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test board/ && pnpm --filter @tassel/desktop typecheck && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e board/board-demo`. Expected: PASS, with both screenshots.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(board): Ada's automata, trace card and notes on tldraw"`

### Task 6: Her own drawing and the board read-back

**Files:**
- Create: `board/tldraw/StudentTools.tsx`, `board/tldraw/student-edits.ts`, `board/tldraw/read-automata.ts`, `board/edit-sink.ts`, `board/glyphs.tsx`
- Modify: `board/tldraw/engine.ts` (`onStudentEdit`), `board/BoardPanel.tsx` (the toolbar, once tldraw has mounted), `features/session/shortcuts.ts` (only if the E2E below shows tldraw swallowing M, B or C)
- Test: `tests/unit/board/tldraw/read-automata.test.ts`, `student-edits.test.ts`, `tests/unit/board/student-tools.test.tsx`, `tests/e2e/board/board-student.spec.ts`

**Interfaces:**
- Consumes: Task 5's engine and shapes; tldraw's default `select`, `draw`, `arrow` and `eraser` tools (`editor.setCurrentTool`), `editor.store.listen(fn, { source: 'user', scope: 'document' })` ([Store.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts#L64-L84)) and `editor.toImage(ids, { format: 'png', background: false })` → `{ blob }`; P1's `Clock` and `@radix-ui/react-toggle-group`.
- Produces:

```ts
// edit-sink.ts
export interface BoardEditSink { send(edit: StudentBoardEdit): void }
export const devEditSink: BoardEditSink;      // console.info(`[board] her edit: ${changed} changed, ${removed} removed, ${automata} automata`)
export function setBoardEditSink(sink: BoardEditSink): () => void;   // P4 installs the live sink (P5-R13)
export function getBoardEditSink(): BoardEditSink;
// read-automata.ts: pure, over plain records
export interface RecordsLike {
  shapes: Array<{ id: string; type: string; props: Record<string, unknown> }>;
  bindings: Array<{ fromId: string; toId: string; props: { terminal: 'start' | 'end' } }>;
}
export function readAutomata(records: RecordsLike, labelOf: (arrowId: string) => string): AutomatonSpec[];
// student-edits.ts
export function createStudentEditWatcher(deps: {
  listen(onChange: (c: { changed: string[]; removed: string[] }) => void): () => void;
  exportImage(ids: string[]): Promise<Blob | null>; snapshot(): RecordsLike; labelOf(arrowId: string): string;
  clock: Clock; onEdit(edit: StudentBoardEdit): void; quietMs?: number }): () => void;   // quietMs 1500
// StudentTools.tsx
export type StudentTool = 'select' | 'draw' | 'arrow' | 'eraser';
export function StudentTools(props: { tool: StudentTool; onTool(tool: StudentTool): void }): JSX.Element;
```

- **Her tools.** A Radix toggle group, named `board.tools.label`, sits in a paper pill with a hairline, 14 px in from the board panel's bottom left. It holds four 40 px round icon toggles: Select, Pen, Arrow and Eraser, with `board/glyphs.tsx` icons drawn in `icons.tsx`'s hand (24 px, 1.6 stroke).
  - The pressed tool is ink-filled. Arrow keys move between tools (Radix); tldraw's own shortcuts stay off (Task 4).
  - Pen draws in ink. Her arrow tool binds to any shape, Ada's states included.
- **Her edits** (spec §5.4, P5-R13). The watcher collects her `user` changes. After 1.5 s with none, it sends one `StudentBoardEdit` to the sink, holding:
  - the ids changed and removed, and the changed shapes' records;
  - a PNG of the changed shapes that still exist, or null if the export fails;
  - `readAutomata` of the whole board.

  Ada's changes are `remote`, so they never count.
- **`readAutomata`:**
  - states are the `tassel-state` shapes;
  - a transition is an arrow with both ends bound to states, whose label splits on commas and spaces into its symbols; an unlabeled arrow is skipped;
  - the start is an arrow bound only by its end;
  - each connected group with a start becomes one automaton: `dfa` when deterministic, else `nfa`.

  So when she re-points Ada's q0 loop at qd, the read-back changes with no vision call (spec §5.3).

- [ ] **Step 1: Write the failing tests.**
  - **read-automata:**
    - `reads the wrong DFA back from shapes and bindings`;
    - `a re-pointed loop becomes q0 to qd on 1`;
    - `the arrow bound only by its end is the start`;
    - `an unlabeled arrow is skipped`; `pen strokes are ignored`;
    - `two separate drawings give two automata`.
  - **student-edits** (a manual clock):
    - `an edit waits for 1.5 s of quiet`; `a burst of changes sends one edit`;
    - `removed shapes are reported`;
    - `the image covers only her changed shapes that still exist`;
    - `a failed export still sends the edit, with image null`.
  - **student-tools** (jsdom):
    - `the tools are named in ko` (선택, 펜, 화살표, 지우개);
    - `choosing Pen presses it and reports draw`;
    - `arrow keys move between the tools`.
  - **E2E `board-student.spec.ts`** (`test.skip(!hasTldrawKey(), …)`; console messages collected):
    1. Pin Board, choose Pen and drag a stroke across the canvas: within 3 s the console shows `[board] her edit: 1 changed, 0 removed, 0 automata`.
    2. Erase it: `0 changed, 1 removed`.
    3. At `TASSEL_FAKE_SPEED=1` with `board-demo`: once q1 is revealed, drag it 80 px down with Select. Its arrows follow, and the next edit reports `1 automata`. At 7.8 s Ada highlights qd, and q1 stays where she put it.
    4. With the canvas focused, M toggles the mic and C the captions (P1's shortcuts).
    5. `snap('p5-board-student')`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/`, then the E2E. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test board/ && pnpm --filter @tassel/desktop typecheck && pnpm --filter @tassel/desktop e2e board/board-student`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(board): her pen, arrows and eraser, and the board read-back"`

### Task 7: Marks on a frozen snapshot of her paper

**Files:**
- Create: `board/marks/project.ts`, `geometry.ts`, `snapshot-sources.ts`, `fixture-paper.tsx`, `MarkShapes.tsx`, `MarksDescription.tsx`, `marks.css`
- Modify (replace Task 1's stubs): `board/marks/marks-store.ts`, `PaperMarksLayer.tsx`, `SnapshotTag.tsx`
- Modify: `tutor/scripts/marks-demo.json`
- Test: `tests/unit/board/marks/project.test.ts`, `geometry.test.ts`, `marks-store.test.ts`, `marks-layer.test.tsx`, `tests/e2e/board/marks-demo.spec.ts`

**Interfaces:**
- Consumes: `PaperAction`, `PaperMark`, `PaperTarget`, `PaperElements`, `FrameRef`, `parseElementRef`, `MOTION`, `prefersReducedMotion`, `useSessionLang` (Task 1). Nothing from Track B, so Task 7 runs alongside Tasks 2 and 3.
- Produces:

```ts
// project.ts
export type Quad = [Pt, Pt, Pt, Pt];                 // TL, TR, BR, BL in frame pixels (P3's convention)
export type Project = (p: Pt) => Pt;                 // page coordinates → frame pixels
export function rectProjector(w: number, h: number): Project;
export interface Fit { scale: number; x: number; y: number }      // frame pixels → panel px, contain
export function containFit(frame: { w: number; h: number }, box: { w: number; h: number }): Fit;
export function toScreen(p: Pt, project: Project, fit: Fit): Pt;
// geometry.ts (panel px)
export interface Resolved { anchor: Pt; center: Pt; radius: number; bbox: { x: number; y: number; w: number; h: number };
  path: Pt[] | null; labelSide: 'above' | 'below' | null }
export function resolveTarget(target: PaperTarget, elements: PaperElements | null, project: Project, fit: Fit): Resolved | null;
export function circleFor(r: Resolved): { cx: number; cy: number; rx: number; ry: number };
export function stepDotFor(r: Resolved, repeat: number): Pt;
export function calloutFor(target: Resolved, pill: { w: number; h: number }, box: { w: number; h: number }): { x: number; y: number; leader: [Pt, Pt, Pt] };
// snapshot-sources.ts
export type SnapshotImage = { kind: 'url'; url: string; w: number; h: number; revoke(): void } | { kind: 'fixture'; name: 'dfa-wrong'; w: number; h: number };
export interface LoadedFrame { image: SnapshotImage; project: Project; capturedAt: string; elements?: PaperElements; spec?: AutomatonSpec }
export interface SnapshotSource { load(ref: FrameRef, ctx: { signal: AbortSignal }): Promise<LoadedFrame> }
export function registerSnapshotSource(kind: FrameRef['kind'], source: SnapshotSource): () => void;
export const fixtureSource: SnapshotSource;          // registered for 'fixture' at import
// fixture-paper.tsx
export const FIXTURE_DFA_WRONG: { w: 1100; h: 850; spec: AutomatonSpec; elements: PaperElements };
export function FixturePaper(): JSX.Element;        // inline SVG, 1100×850; each piece of ink carries data-ink="state:q0", "edge:q0>q0", …
// marks-store.ts
export type MarksStatus = 'live' | 'loading' | 'frozen' | 'failed';
export interface Snapshot extends LoadedFrame { ref: FrameRef; elements: PaperElements | null; spec: AutomatonSpec | null }
export interface MarksState { status: MarksStatus; snapshot: Snapshot | null; marks: PaperMark[];
  apply(action: PaperAction): void; goLive(): void; reset(): void }      // Task 10 adds `trace`
export const useMarksStore: UseBoundStore<StoreApi<MarksState>>;
```

- **The fixture page** draws the demo's wrong DFA where P3's synthetic clip does (P3 Task 6), on a landscape 11:8.5 page: states of r 0.055 (page-width units) at y 0.55 and x 0.18, 0.39, 0.60, 0.81; q3 with an inner circle at 0.8 r; a start arrow from x 0.08; edge labels above the edges; self-loops above q3 (`0,1`) and q0 (`1`); ruled lines `#e4ebf3` every 1/20 of the height from 18%; a margin line `#f3c9cf` at 7%; ink `#474747` at 0.35% of the width; labels in Geist. The fixture source returns its spec and elements, so a script's `paper.freeze` needs only `{ kind: 'fixture', name: 'dfa-wrong' }`.
- **Geometry rules** (panel px):
  - a state resolves to its projected center, with `radius` the length of `toScreen(center + (r, 0)) − toScreen(center)`. An edge resolves to its projected path, its bbox and the side its label is on;
  - `circleFor`: a state gets a circle at 1.35 × radius; anything else, its bbox plus 14 px on each side;
  - `stepDotFor`: on a straight edge, its midpoint moved 26 px along the normal away from its label (below when there's none); on a self-loop, 22 px left of its leftmost point; on a state, `center + (−0.7, 0.7) × (radius + 18)`; for a point or box, the anchor. Repeat k (the same edge numbered again) moves it 30k px along the edge (down, for a loop);
  - `calloutFor`: above and right of the target, 24 px off its bbox; on overflow, flip left or below; then clamp to 14 px inside the panel, and below y 54 (P1's top line). The leader is a quadratic curve from the pill's nearest edge midpoint to the anchor.
- **The store:**
  - `paper.freeze` aborts any load in flight, clears the marks, sets `loading`, and loads through the source for `frame.kind`. With no source, or on failure, it goes to `failed`, warns once, and the paper stays live. On success it sets `frozen`, with `elements = action.elements ?? loaded.elements ?? null` (the same for `spec`).
  - `paper.mark` while `loading` is queued and applied in order once frozen (Review Focus 5). While `frozen` it replaces a mark with the same id or appends. While `live` or `failed` it is dropped with a warning.
  - `paper.unmark` removes one mark; `paper.clear` removes the marks but stays frozen; `paper.live` and `goLive()` return to live and call the image's `revoke()`; `reset()` also aborts.
  - `paper.trace` and `paper.traceStep` do nothing until Task 10.
- **The layer.** While `frozen`, `PaperMarksLayer` renders `data-testid="paper-snapshot"` at `absolute inset-0 z-[5] bg-paper`:
  - the image, contain-fit, as `<img>` or `<FixturePaper/>` scaled by the same `Fit`;
  - one SVG in panel px for strokes, plus absolutely placed HTML for callout pills, so text wraps at 320 px (`[word-break:keep-all]` under `:lang(ko)`);
  - `MarksDescription`, a visually hidden list named `marks.description.label`.

  A `ResizeObserver` on the layer recomputes the `Fit` on every size change, the stage reflow included (Review Focus 3). Draw-on uses `pathLength="1"` with a dash-offset animation of `MOTION.drawMs`, and pills fade in over `MOTION.fadeMs`; `marks.css` turns both off under reduced motion. Test ids: `mark-<type>-<id>`.
- **`SnapshotTag`**, in the `TopLine`, follows P3's top-line pills (26 px, paper fill, hairline, `pointer-events-auto`):
  - `loading`: `marks.loading`;
  - `failed`: `marks.failed`, for 4 s;
  - `frozen`: a mono 11 pill reading `marks.snapshot` with `time` from P5-R9, then a ghost pill button "Back to live" (sans 13/520) that calls `goLive()`.
- **`marks-demo.json`** (FakeScript steps, times at speed 1):
  - 0 connecting; 800 listening;
  - 1500 student "I don't understand, can you show me?";
  - 2400 speaking; 2500 Ada "Let's walk 1010 through your DFA.";
  - 2600 `paper.freeze` fixture;
  - 3200, 3800, 4400 and 5000: step marks 1–4 on `edge:q0>q0`, `edge:q0>q1`, `edge:q1>q2` and `edge:q2>q3`;
  - 5600 a washed circle on `edge:q0>q0`;
  - 6200 a callout on `edge:q0>q0`, "A leading 1 loops here, so 1010 gets in";
  - 7000 listening.

- [ ] **Step 1: Write the failing tests.**
  - **project:** `rectProjector(1100, 850)` maps (0.5, 0.5) to (550, 425); `containFit({ w: 1100, h: 850 }, { w: 550, h: 600 })` is `{ scale: 0.5, x: 0, y: 87.5 }`; `toScreen` composes them.
  - **geometry:**
    - `a state resolves to its projected center and radius`: q1 at scale 0.5 has radius 30.25;
    - `circleFor rings a state at 1.35 × its radius and pads an edge's box by 14`;
    - `stepDotFor puts dot 2 below the q0→q1 edge, between q0 and q1, and shifts a repeat by 30`;
    - `calloutFor keeps a 320×80 pill inside a 490×400 panel for a target at its top-right corner` (Review Focus 4);
    - `an unknown state resolves to null`;
    - `marks follow the panel's size`: at 1440×900 and 1024×680 panel sizes, the same target's screen position equals `toScreen` within 0.5 px (Review Focus 3).
  - **marks-store:**
    - `freeze, then marks`;
    - `marks sent while loading appear in order when it's ready` (a deferred fake source; Review Focus 5);
    - `a mark with no snapshot is dropped with one warning`;
    - `a second freeze replaces the snapshot and clears the marks`;
    - `a mark with the same id replaces the old one`;
    - `a failed load shows failed and keeps the paper live`;
    - `going live revokes the image`.
  - **marks-layer** (jsdom; `ResizeObserver` stubbed):
    - `renders nothing while live`;
    - `frozen shows the page with step dots 1–4, a circle and a callout`;
    - `the tag reads Snapshot 14:32 for a frame captured at 14:32 local time`;
    - `Back to live returns to live`;
    - `a 140-character Spanish callout gets max-width 320px and a position inside the panel` (Review Focus 4);
    - `the description lists the marks in the session language`.
  - **E2E `marks-demo.spec.ts`** (`TASSEL_FAKE_SCRIPT=marks-demo`, a paper session through the new-session sheet). Collect console warnings and errors; expect none.
    1. `paper-snapshot` is visible and the tag matches `/^Snapshot \d\d:\d\d$/`.
    2. Dot 2's center lies between the boxes of `[data-ink="state:q0"]` and `[data-ink="state:q1"]`, below `[data-ink="edge:q0>q1"]`; the circle mark's box contains `[data-ink="edge:q0>q0"]`'s box; the callout reads "A leading 1 loops here, so 1010 gets in".
    3. `snap('p5-marks-1440')`; `setWindowSize(app, page, 1024, 680)`; check step 2 again after `settle`; `snap('p5-marks-1024')`.
    4. "Back to live" removes `paper-snapshot`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/marks`, then `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e board/marks-demo`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before the UI, read the mock's paper marks (`stage.html`, the paper `<svg>`) and Global Constraints' visual values.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's commands, plus `typecheck`. Expected: PASS, with both screenshots saved.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(marks): Ada's marks on a frozen snapshot of the paper"`

### Task 8: Beats: the player and fake beats

**Files:**
- Modify (replace Task 1's stub body): `board/beats/player.ts`
- Create: `board/beats/match.ts`, `board/script/types.ts`, `compile.ts`, `synth-words.ts`
- Modify: `tutor/create-client.ts` (compile every script), `tutor/scripts/marks-demo.json` (turns)
- Test: `tests/unit/board/beats/player.test.ts`, `match.test.ts`, `tests/unit/board/script/compile.test.ts`, `synth-words.test.ts`, `scripts.test.ts`, `tests/e2e/board/beats-timing.spec.ts`

**Interfaces:**
- Consumes: `BeatDoc`, `BeatWord`, `parseBeatDoc`, `normalizeWord`, `restCues` (Task 1); `FakeScript`, `TutorEvent`, `TutorState` (P1).
- Produces: Task 1's `BeatPlayer` interface, now word-gated, and:

```ts
// beats/match.ts
export function matchByText(words: BeatWord[], next: number, heard: string, lookahead?: number): number | null;  // lookahead 3
// script/types.ts
export interface AuthoredBeat { say: string; actions?: Record<string, BeatAction | BeatAction[]> }
export type AuthoredStep =
  | { at: number; event: TutorEvent }                                   // passes through
  | { at: number; do: BeatAction[] }                                    // an `actions` event
  | { at: number; turn: AuthoredBeat[]; then?: TutorState };            // Ada speaks
export interface AuthoredScript { lang: Lang; steps: AuthoredStep[] }
// script/synth-words.ts
export function synthWords(text: string): { words: BeatWord[]; durationSec: number };
// script/compile.ts
export function compileScript(script: AuthoredScript | FakeScript, name: string): FakeScript;
```

- **Player rules** (each a test):
  1. A document with no words fires all its markers on load.
  2. Documents are keyed by `segment`. A heard word with `segment` and `index` fires every unfired marker of that document with `word ≤ index`; at its last word it also fires the markers with `word === words.length`.
  3. A heard word without them is matched by `matchByText`: against the oldest unfinished document of the newest turn, comparing `normalizeWord`s, skipping up to 3 words ahead.
  4. A word that matches nothing is buffered for `bufferMs` (8000). A document that loads later catches up on buffered words of its segment (or, without segments, a run matching its first words), firing their markers at once, in order.
  5. Loading a document from a new `turn` drops every unfinished document of older turns, with their unfired markers (barge-in).
  6. A marker fires at most once; markers sharing a word fire in array order; one action that `dispatch` rejects never stops the rest.
  7. `onWord` is told every matched word; `reset()` empties the documents and the buffer.
- **`synthWords`**, exactly: `letters(w)` counts `\p{L}` and `\p{N}` (at least 1). Each word lasts `0.09 + 0.055 × letters(w)` s. The gap after it is 0.06 s, or 0.18 after `,`, `;` or `:`, or 0.32 after `.`, `?` or `!`. Times are rounded to milliseconds, and `durationSec` is the last word's end.
- **`compileScript`:**
  - A `FakeScript` passes through unchanged.
  - `{#id}` (`/\{#([a-z0-9-]+)\}/`) anchors `actions[id]` (one action or several) to the next word, or after the last word when it ends the line.
  - A `turn` at T gives `state speaking` at T. Beat k starts at S₀ = T + 150, and S₍ₖ₊₁₎ = Sₖ + duration + 280. At Sₖ come the tutor caption (final, the line without anchors), then the `beat`, then each word at Sₖ + start × 1000. After the last beat, `then` (default `listening`) comes 300 ms after it ends.
  - A `do` step gives one `actions` event.
  - Ids: document `<name>-<step>-<beat>`, `turn` `<name>-<step>`, `segment` the document id, and markers `<doc>.<n>`. Each word event carries its `segment` and `index`, and every document gets `restCues(durationSec)`.
  - An anchor with no action throws `script <name>: step <i> beat <k> has no action "<id>"`; an action never anchored throws `script <name>: step <i> beat <k> never uses "<id>"`.
- **`marks-demo.json`** becomes an authored script with the same actions as Task 7, in two of Ada's beats:
  - "Let's walk 1010 through your DFA, {#freeze}one symbol at a time.";
  - "First a 1, {#s1}which keeps you on q0, {#s2}then a 0 to q1, {#s3}a 1 to q2, {#s4}and a 0 to q3. {#circle}This loop {#callout}is what lets 1010 in."

  `{#s1}` sits after the line's fourth word, so the E2E can see it arrive after the caption.

- [ ] **Step 1: Write the failing tests.**
  - **player** (a manual `now`): one test per rule, including:
    - `a repeated word ("q zero … q zero") fires each marker once, at its own occurrence` (Review Focus 2);
    - `a late document fires the markers of words already heard, at once and in order`;
    - `a new turn drops the old turn's unfired markers`;
    - `a duplicate word event never fires a marker twice`;
    - `an invalid marker is dropped and the next still fires` (Review Focus 5).
  - **match:** exact, skip-ahead and no-match cases, in English, Spanish (`é` composed and decomposed) and Korean.
  - **compile:**
    - `a turn compiles to speaking, then per beat a caption, the beat and its words, then listening`;
    - `{#id} anchors to the next word`; `a trailing {#id} anchors after the last word`;
    - `an anchor with no action throws, naming the script, step and beat`; `an unused action throws`;
    - `do steps become actions events`; `a FakeScript passes through`;
    - `word events carry segment and index`;
    - `the next beat starts 280 ms after the last one ends`.
  - **synth-words:** `synthWords('Try 1010.')` gives `Try` 0–0.255 and `1010.` 0.315–0.625, with `durationSec` 0.625; `'q0, then'` puts `then` 0.18 s after `q0,` ends.
  - **scripts:** `every registered script compiles, and every beat parses with no problems` (iterates `SCRIPTS`).
  - **E2E `beats-timing.spec.ts`** (`TASSEL_FAKE_SPEED=1`, `marks-demo`, a paper session):
    - when the caption "First a 1, which keeps you on q0…" appears, `mark-step-s1` isn't there yet; it appears within 2 s;
    - the callout appears only after `mark-circle-circle`;
    - no console warnings.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/beats board/script`, then the E2E. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `createTutorClient`'s behavior for `dfa-opening` byte-identical: it passes through.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's commands, `pnpm --filter @tassel/desktop test` (P1's `fake-client` tests too) and `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(beats): word-gated beat player and compiled fake beats"`

### Task 9: Beats on the server: the contract mirror, markup and assembly

**Files:**
- Create: `services/server/src/tassel/beats/__init__.py` (a docstring), `models.py`, `markup.py`, `assemble.py`
- Create: `services/server/tests/beats/__init__.py`, `markup-fixtures.json`, `test_models.py`, `test_markup.py`, `test_assemble.py`

**Interfaces:**
- Consumes: `packages/shared/src/beats/fixtures.json` (Task 1), read from the repo root as P2's voice tests do (`Path(__file__).resolve().parents[4]`).
- Produces:

```python
# models.py: Pydantic v2 mirrors of Task 1's types; extra="forbid"; camelCase on the wire
#   (alias_generator=to_camel, populate_by_name=True); actions are a union discriminated on `kind`
BEAT_ACTION: TypeAdapter[BeatAction]
class BeatDoc(BaseModel): ...          # version, id, turn, segment, lang, text, duration_sec, shape_set, mouth_cues, words, markers
def dump_beat(doc: BeatDoc) -> dict    # by alias, None kept: the JSON the client parses
# markup.py
@dataclass
class BoardContext:                    # one per bot: what Ada has defined, and the paper-mark counter
    specs: dict[str, AutomatonSpec]; next_mark: int = 1
@dataclass(frozen=True)
class Sentence: clean: str; tagged: str; anchors: list[tuple[int, BeatAction]]; problems: list[str]
def parse_command(command: str, ctx: BoardContext) -> BeatAction | None
class MarkupStream:
    def __init__(self, ctx: BoardContext) -> None
    def feed(self, chunk: str) -> list[Sentence]     # complete sentences so far
    def flush(self) -> list[Sentence]                 # end of the response; drops an unclosed "[["
# assemble.py
def build_beat(sentence: Sentence, *, beat_id: str, turn: str, segment: str, lang: Lang) -> BeatDoc
```

- **The markup** (P5-R6): `[[verb args…]]`, anywhere in Ada's text, anchored to the word that starts after it. A tag inside a word anchors to that word. An element is `start`, a state id (`q0`), or `q0>q1`. A quoted string is `"…"`.

| Command | Action |
|---|---|
| `dfa ITEM [hidden] [title="…"] start=S [accept=S,S] FROM-SYMS-TO…` (and `nfa`, with `eps` for ε) | `board.automaton` (`reveal: 'none'` when hidden); the spec is remembered in `BoardContext` |
| `reveal ITEM [EL…]` · `add ITEM S [accept]` · `edge ITEM FROM TO SYMS` | `board.reveal` · `board.addState` · `board.addTransition` |
| `highlight ITEM EL` · `unhighlight ITEM EL` · `pulse ITEM EL` | `board.highlight` on and off · `board.pulse` |
| `note ITEM "…" [near=ITEM:EL]` | `board.note` |
| `trace ITEM ON INPUT [student]` · `step ITEM` · `verdict ITEM accept\|reject [expected=…] [note="…"]` | `board.trace` (the spec copied from `ON`) · `board.traceStep` · `board.verdict` |
| `focus [ITEM]` · `clear [ITEM]` · `stage paper\|board\|split` | `board.focus` · `board.clear` · `stage` |
| `circle EL` · `wash EL` · `number N EL` · `strike EL` · `check EL` · `callout EL "…"` | `paper.mark` with id `m<n>` from the counter |
| `ptrace INPUT` · `pstep` · `live` | `paper.trace` · `paper.traceStep` · `paper.live` |

  A bad or unknown command is removed from the text, adds a problem, and anchors nothing. Single brackets (`[0,1]`) are text. Sentences end at `.`, `?` or `!` followed by whitespace or the end, outside tags.
- **`build_beat`:** `words` are the clean text split on whitespace, with null times; `duration_sec` is null; `mouth_cues` is empty (P5-R4); marker ids are `<beat_id>.<n>`; a word index past the end clamps to `len(words)`. A sentence with only tags gives a wordless beat, which the client fires on load.

- [ ] **Step 1: Write the failing tests.**
  - **`test_models.py`:**
    - every action and beat in the shared `fixtures.json` validates and round-trips through `dump_beat`;
    - every `invalidActions` entry raises `ValidationError`;
    - every `invalidBeats` entry does too, including the bad marker, which the TS parser drops instead: the server never sends one.
  - **`test_markup.py`** (`markup-fixtures.json` holds `{ text, clean, anchors }` cases, in all three languages):
    - `"[[dfa fix hidden start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3 q0-1-qd q1-0-qd q2-1-qd qd-0,1-qd]]Here's one that works."` anchors the automaton at word 0;
    - `"We start at [[reveal fix start q0]]q zero."` gives `"We start at q zero."`, anchored at word 3;
    - a Korean callout with a quoted string;
    - an unknown verb leaves clean text and one problem;
    - `"[0,1]"` stays text.
  - **`MarkupStream`:**
    - `a tag split across three chunks gives the same sentence as unsplit text`;
    - `two sentences in one chunk come out as two`;
    - `an unclosed [[ at the end of a response is dropped`;
    - `trace copies the spec of the automaton it names`.
  - **`test_assemble.py`:**
    - `build_beat lays out words with null times and markers at their word indexes`;
    - `a tags-only sentence gives a wordless beat`;
    - `an anchor past the end clamps to the trailing position`.
- [ ] **Step 2: Run them and confirm they fail.** Run `uv run --directory services/server pytest tests/beats -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Standard library and Pydantic only; nothing here imports Pipecat.
- [ ] **Step 4: Run them and confirm they pass.** Same command, plus `uv run --directory services/server ruff check`. Expected: PASS, clean.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(server): beat contract mirror, board markup and beat assembly"`

### Task 10: Trace animations

*Converge: starts after Tracks A, B and C have merged.*

**Files:**
- Create: `board/marks/trace-marks.ts`, `board/marks/TraceMarks.tsx`, `board/tldraw/arc.ts`
- Modify: `board/marks/marks-store.ts` (`paper.trace`, `paper.traceStep`), `board/marks/PaperMarksLayer.tsx`, `board/tldraw/shapes/TraceShape.tsx` (the tape cursor and row fade), `board/tldraw/effects.ts` (the glide's path), `board/tldraw/shapes/StateShape.tsx` (the current ring's motion)
- Create: `tutor/scripts/trace-demo.json`; Modify: `tutor/create-client.ts` (register it). `board-demo` and `marks-demo` stay as they are, so the earlier specs keep their expectations.
- Test: `tests/unit/board/marks/trace-marks.test.ts`, `tests/unit/board/tldraw/arc.test.ts`, `tests/e2e/board/trace.spec.ts`

**Interfaces:**
- Consumes: `AutomatonRun` (Task 2); `TraceItem.shown`, `AutomatonItem.current` and the `glide` effect (Task 3); Task 5's engine and shapes; Task 7's store and layer.
- Produces:

```ts
// marks/trace-marks.ts
export interface PaperTracePlan { dots: Array<{ n: number; el: ElementRef; repeat: number }>; ring: StateId[]; glide: ElementRef | null; done: boolean }
export function planPaperTrace(run: AutomatonRun, shown: number): PaperTracePlan;
// tldraw/arc.ts
export function sampleArc(start: Pt, end: Pt, bend: number, n: number): Pt[];   // n points on the arc through the chord midpoint offset by bend
```

- **Paper** (spec §5.4's trace: "a cursor advances along the input string, a token glides along each arrow, and the current state rings"):
  - `MarksState` gains `trace: { run: AutomatonRun; shown: number } | null`, which `paper.freeze`, `paper.clear` and going live reset;
  - `paper.trace` runs the snapshot's `spec` (no spec: a problem) with `shown` 0; `paper.traceStep` advances it like `board.traceStep`;
  - `planPaperTrace`: one numbered dot per shown step on its edge (an NFA step numbers each edge it takes), `repeat` counting earlier uses of that edge; `ring` is the latest step's `to` (or the starting states); `glide` is the latest step's edge; a stuck step has no edge;
  - `TraceMarks` draws the dots with `stepDotFor`, the ring at 1.25 r, and the token gliding along the projected edge path over `MOTION.glideMs`. "At the end, the accept/reject mismatch is marked and the blamed transition circled": both come as explicit actions (`board.verdict`, a `circle` mark) from the tutor, which knows the verdict.
- **Board:**
  - the `glide` effect moves a 10 px iris-ink token along each edge's arrow, in page space, sampled with `sampleArc` from the arrow's terminals and bend;
  - an automaton's `current` states get the "current" ring (Global Constraints);
  - the trace card fades in each new row over `MOTION.fadeMs`, tints the newest row, and moves the blush cell to the symbol just read;
  - the verdict row uses `board.verdict.yours` when `subject` is `student`, else `board.verdict.this`, with `kind` from `board.kind.*`.
- **Reduced motion:** the token jumps to the edge's end, the ring and dots appear at once, and nothing animates.
- **`trace-demo.json`** (authored, en; speed-1 times): 0 connecting; 800 listening; 1500 student "Can you trace 1010 for me?"; then at 2500 Ada's turn, then `listening`:
  1. "{#setup}Let's trace 1010 on your paper and on mine." `{#setup}` holds `paper.freeze` fixture, `paper.trace 1010`, `board.automaton fix` (CORRECT, all shown) and `board.trace tr` (CORRECT, 1010, `on: 'fix'`).
  2. "{#s1}First a 1. {#s2}Then a 0. {#s3}A 1. {#s4}And a 0." Each `{#sN}` holds `paper.traceStep` and `board.traceStep tr`.
  3. "{#v}Mine rejects it." This is `board.verdict tr got reject`.

- [ ] **Step 1: Write the failing tests.**
  - **trace-marks:**
    - `two steps of the wrong DFA on 1010 number q0's loop and q0→q1, ring q1 and glide on q0→q1`;
    - `a loop taken twice numbers it with repeats 0 and 1` (`11` on WRONG);
    - `a stuck step adds no dot and ends the trace`;
    - `an NFA step numbers every edge it takes`.
  - **arc:** `sampleArc` with bend 0 is the straight segment; with bend 40 its middle sample is 40 px off the chord's midpoint, on the left of start → end.
  - **E2E `trace.spec.ts`** (`TASSEL_FAKE_SCRIPT=trace-demo`, a paper session). The tests that look at the board start with `test.skip(!hasTldrawKey(), …)`; the paper tests always run.
    - **board:** the trace card shows four rows, the last reading "Step 4", "read 0", "qd → qd" and "loops", and the verdict pill reads "This DFA: reject"; `qd` has `data-ring="current"`;
    - **paper:** dots 1–4 sit on q0's loop, q0→q1, q1→q2 and q2→q3, the ring is on q3, and `document.getAnimations()` is empty once settled;
    - **reduced motion:** with `page.emulateMedia({ reducedMotion: 'reduce' })` ([Playwright](https://playwright.dev/docs/api/class-page#page-emulate-media)) before the session, no animation ever runs in the board or the paper layer, and the final dots and rings are there;
    - **languages:** in a Spanish session (the sheet's language) the rows read "Paso 1" and "lee 1", and in a Korean one "1단계" and "1 읽음"; every row's `scrollWidth ≤ clientWidth` (Review Focus 4);
    - `snap('p5-trace-board')`, `snap('p5-trace-paper')`, `snap('p5-trace-ko')`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/marks/trace-marks board/tldraw/arc`, then the E2E. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's commands, then the whole `pnpm --filter @tassel/desktop test` and `e2e board/`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(board): trace animations on the board and her paper"`

### Task 11: The §9 demo on fakes, with show_stage

**Files:**
- Create: `tutor/scripts/dfa-demo.json`, `tests/unit/board/script/dfa-demo.test.ts`, `tests/e2e/board/dfa-demo.spec.ts`
- Modify: `tutor/create-client.ts` (register `dfa-demo`)

**Interfaces:**
- Consumes: everything above. Produces the script `TASSEL_FAKE_SCRIPT=dfa-demo`, the fake that plays spec §9 steps 3–7.

- **The script** (authored, en; times at speed 1). It starts with P1's `dfa-opening` steps, 0–33 000 ms, copied as `event` steps: the planted mistake, then Ada's 1010 question with `stage split`. Then:
  - 34 000, student: "I don't understand, can you show me?"
  - 35 000, Ada's turn:
    1. "{#freeze}Let's run 1010 through your DFA, one symbol at a time." `{#freeze}` holds three actions: `paper.freeze` fixture, `paper.trace` 1010, and `board.trace` `yours` (the fixture's WRONG spec, 1010, `subject: 'student'`).
    2. "First a 1. {#s1}It keeps you on q0, because of this loop." `{#s1}` is `paper.traceStep` and `board.traceStep yours`.
    3. "{#s2}Then a 0 to q1, {#s3}a 1 to q2, {#s4}and a 0 to q3."
    4. "{#v}So your DFA accepts 1010, {#circle}but 1010 doesn't start with 010. {#callout}This loop lets it in." `{#v}` is `board.verdict yours got accept expected reject note "Starts with 010? No → reject"`; `{#circle}` a washed circle on `edge:q0>q0`; `{#callout}` the callout "A leading 1 loops here, so 1010 gets in".
  - 52 000, student: "I still don't get it, show me the answer."
  - 53 500, Ada's turn:
    1. "{#define}Here's one that works. {#q0}We start at q0." `{#define}` is `board.automaton fix` (CORRECT, `reveal: 'none'`); `{#q0}` is `board.reveal fix [start]`.
    2. "{#q1}A 0 takes us to q1, {#q2}then a 1 to q2, {#q3}and a 0 to q3, which accepts." These reveal `edge:q0>q1`, `edge:q1>q2` and `edge:q2>q3`.
    3. "{#loop}After that, anything goes." This reveals `edge:q3>q3`.
    4. "Now the new part: {#qd}a dead state." This reveals `state:qd` and pulses it.
    5. "{#d1}Any wrong symbol on the way {#d2}falls in here, and it never gets out." `{#d1}` reveals `edge:q0>qd`, `edge:q1>qd` and `edge:q2>qd`; `{#d2}` reveals `edge:qd>qd`.

    Then `listening`.
- **show_stage:** the script never requests `board`. P1's `split` at 27 600 brings in the board, and the auto-split rule (P5-R7) covers a pinned or hidden board.

- [ ] **Step 1: Write the failing tests.**
  - **`dfa-demo.test.ts`:**
    - `compiles, and every beat parses with no problems`;
    - `its DFAs tell the story`: WRONG accepts 1010 and CORRECT rejects it;
    - `every board action reduces with no problem`: all of them, in order, through `reduceBoard`;
    - `every paper mark resolves against the fixture's elements`.
  - **E2E `dfa-demo.spec.ts`** (speed 20; `test.skip(!hasTldrawKey(), …)`, because it checks the board; `marks-demo` covers the paper without a key). Collect console warnings and errors; expect none.
    1. After the 1010 question, both panels show.
    2. After the first turn: the snapshot tag, dots 1–4, the circle and the callout; the board's trace card with four rows and "Your DFA: accept", plus the note pill "Starts with 010? No → reject". `snap('p5-demo-explain-1440')`.
    3. After the second turn: five states, with q3 double-ringed and `qd` shown; nine arrows (eight transitions and the start arrow); the description list contains "Accepting: q3" and "q2 to qd on 1". `snap('p5-demo-answer-1440')`, then at 1024×680 `snap('p5-demo-answer-1024')`.
    4. **Pinned** (Review Focus 1): press B before the explanation, so Paper is pinned. The snapshot and marks still play. The board stays hidden while "Ada asks: Paper and board" shows. Unpin: the board appears with the answer fitted inside the panel (every state's box inside the board region).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test board/script/dfa-demo`, then `pnpm --filter @tassel/desktop e2e board/dfa-demo`. Expected: FAIL.
- [ ] **Step 3: Write the script and register it.**
- [ ] **Step 4: Run them and confirm they pass.** Same commands. Expected: PASS, with three screenshots.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(board): spec §9's explanation and answer on fakes"`

### Task 12: Marks on P3's paper

*Gate: P3 has merged.*

**Files:**
- Modify: `board/marks/snapshot-sources.ts` (the `frame`, `latest` and `live` sources), `board/marks/PaperMarksLayer.tsx` (register them with the session's API client; letterbox on `bg-desk`)
- Create: `tutor/scripts/dfa-demo-clip.json`, `tests/unit/board/marks/frame-sources.test.ts`, `tests/unit/board/script/dfa-demo-clip.test.ts`, `tests/e2e/board/marks-paper.spec.ts`

**Interfaces:**
- Consumes (P3, unchanged): `listFrames(api, sessionId, limit)` and `getFrameImage(api, sessionId, frameId, 'full')` from `paper/upload/frames-api.ts`; `FrameOut` (`page_found`, `page_quad`, `width`, `height`, `captured_at`); `usePaperStore` (`stream`, `stats.quad`) from `paper/paper-store.ts`; `homography` and `applyH` from `paper/detector/homography.ts`; `makeClip('dfa-demo').truth` from `@tassel/paper-synth`; P3's `startPaperSession` and `framesOf` E2E fixtures.
- Produces:

```ts
export const UNIT_SQUARE: Quad;                       // (0,0), (1,0), (1,1), (0,1)
export function quadProjector(quad: Quad): Project;  // p => applyH(homography(UNIT_SQUARE, quad), p)
export function createFrameSources(deps: { api: ApiClient; sessionId(): string | null;
  createObjectURL?(b: Blob): string; revokeObjectURL?(url: string): void;
  grab?(stream: MediaStream): Promise<{ blob: Blob; w: number; h: number }> }): Record<'frame' | 'latest' | 'live', SnapshotSource>;
```

- **`frame { id }`:**
  - finds the frame in `listFrames(api, sessionId, 50)`, else rejects `frame not found`;
  - fetches the image as a Blob and makes an object URL (`img-src` already allows `blob:`);
  - projects with `quadProjector(page_quad)` when `page_found`, else `rectProjector(width, height)`;
  - `capturedAt` is `captured_at`.
- **`latest`:** the newest frame (`limit` 1), else rejects `no frames yet`.
- **`live`:** grabs the current frame of `usePaperStore`'s stream (`ImageCapture.grabFrame()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/grabFrame)), drawn to a canvas, then JPEG), with `stats.quad` (or the whole frame); no stream rejects `paper isn't live`.
- **`dfa-demo-clip.json`** is the explanation turn of `dfa-demo` alone, for P3's `dfa-demo` clip:
  - its freeze is `{ kind: 'latest' }`, with elements following the clip's truth (P3 Task 6). Edge paths are straight between the circles, and loops run above;
  - the student's "I don't understand, can you show me?" comes at 60 000 ms, after the clip's third upload (about 47 s after the paper goes live);
  - a unit test checks the elements against `makeClip('dfa-demo').truth`: centers and radii within 0.005, edge labels within 0.02.

- [ ] **Step 1: Write the failing tests.**
  - **frame-sources** (a fake API):
    - `frame loads the image as an object URL and projects through its quad`;
    - `a frame without a page projects the whole frame`;
    - `latest with no frames rejects, so the tag shows Couldn't load the snapshot`;
    - `live without a stream rejects`;
    - `quadProjector maps the unit square's corners to the quad's within 1e-9, and its center to where the quad's diagonals cross`.
  - **E2E `marks-paper.spec.ts`** (`{ timeout: 120_000 }`; runs on macOS and Windows):
    - Setup: `test.beforeAll` generates the clip with `node packages/paper-synth/scripts/gen-clip.ts --variant dfa-demo --out .cache/paper-clips` through `cross-spawn`. Launch with `TASSEL_PAPER_SOURCE=fake-clip`, `TASSEL_FAKE_CLIP` set to that file, `TASSEL_PAPER_DEBUG=1`, `TASSEL_FAKE_SCRIPT=dfa-demo-clip` and `TASSEL_FAKE_SPEED=1`, then call `startPaperSession`.
    - Wait for the debug pill to read "3 sent", then for `paper-snapshot`.
    - The snapshot `<img>` has `naturalWidth` 960.
    - The test projects the clip's truth itself: through the frame's `page_quad` (from `framesOf`, with P3's `homography`), then through the image's on-screen box. Within 6 px, dot 2 lies between the projected centers of q0 and q1, below their edge, and the circle mark's box contains the projected region of q0's loop.
    - `snap('p5-marks-paper-1440')`.
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test board/marks board/script && pnpm --filter @tassel/desktop e2e board/marks-paper`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(marks): snapshots of P3's analyzed and live frames"`

### Task 13: Live beats on the server

*Gate: P2 has merged.*

**Files:**
- Create: `services/server/src/tassel/beats/processor.py`, `services/server/tests/beats/test_processor.py`, `services/server/src/tassel/voice/fakes/scenarios/dfa-board.json`
- Modify: `services/server/src/tassel/voice/bot.py` (insert the processor between the LLM and TTS, with one `BoardContext` per bot), `voice/prompts.py` (the board rules), `voice/messages.py` (`BeatEvent`), `packages/shared/src/voice/messages.ts` and `fixtures.json` (a `beat` server event)
- Test: `test_processor.py`; extend P2's `tests/voice/test_prompts.py`, `test_voice_messages.py`, `test_bot_pipeline.py` and `packages/shared/tests/voice-messages.test.ts`

**Interfaces:**
- Consumes: Task 9; P2's `ServerEvents.send`, `envelope`, `build_bot`, `system_prompt`, `FakeScenario`; Pipecat 1.12.0 frames `LLMFullResponseStartFrame`, `LLMTextFrame`, `LLMFullResponseEndFrame`, `AggregatedTextFrame(text, aggregated_by, raw_text)` and the interruption frame ([frames.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/frames/frames.py); confirm the names there). `LLMTextProcessor` is the stock processor this replaces ([llm_text_processor.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/aggregators/llm_text_processor.py#L40-L108)).
- Produces:

```python
class BeatTagProcessor(FrameProcessor):
    def __init__(self, *, events: ServerEvents, lang: Callable[[], Lang], board: BoardContext, **kwargs) -> None
class BeatEvent(BaseModel): kind: Literal["beat"]; beat: BeatDoc        # messages.py; joins SERVER_EVENTS
```
```ts
// packages/shared/src/voice/messages.ts: ServerEvent gains
  | { kind: 'beat'; beat: BeatDoc }       // parseServerEvent validates it with parseBeatDoc; a null doc rejects the event
```

- **The processor:**
  - `LLMFullResponseStartFrame` starts a new turn id (8 hex characters).
  - Each `LLMTextFrame` goes to `MarkupStream.feed`. For each finished sentence:
    1. make `AggregatedTextFrame(text=clean, aggregated_by="sentence", raw_text=tagged)`;
    2. send `BeatEvent(build_beat(…, segment=str(frame.id)))` first, then push the frame.

    Its `id` is the `segment_id` the client sees on `bot-output` ([observer.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/frameworks/rtvi/observer.py#L684-L794)), so the cue document always arrives before its words. `raw_text` keeps the tags in Ada's history (P5-R6). A sentence of tags alone sends a wordless beat and pushes no text.
  - `LLMFullResponseEndFrame` flushes. An interruption drops the unfinished buffer. Every other frame passes through.
- **The prompt** (English, in P2's `system_prompt`, for every language):
  - "You can draw on a shared board and on the student's paper by writing commands in double square brackets. They are never spoken. Put each command right before the words it belongs to";
  - the command table from Task 9, in one compact line per command;
  - "Define an automaton hidden before you reveal it";
  - "In speech say 'q zero'; in commands write q0";
  - "At most two commands per sentence. Never mention a command".
- **`dfa-board.json`** (en, es and ko, as P2 requires). `student`: "Can you show me the answer?". One turn, `when` "show me the answer", `say`: `[[dfa fix hidden start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3 q0-1-qd q1-0-qd q2-1-qd qd-0,1-qd]][[stage split]]Here's one that works. [[reveal fix start q0]]We start at q zero. [[reveal fix q0>q1]]A zero takes us to q one.`

- [ ] **Step 1: Write the failing tests.**
  - **`test_processor.py`** (the processor between a source and a recorder, with fake `ServerEvents`; the `say` text fed in 3-word `LLMTextFrame`s, as P2's fake LLM streams it):
    - `strips tags before TTS`: no recorded text frame contains `[[`;
    - `sends one beat per sentence, before its text frame, keyed by the frame's id`;
    - `anchors markers at their word indexes`: "We start at q zero." has its reveal at word 3;
    - `a tags-only response sends a wordless beat and no text frame`;
    - `an interruption drops the unfinished sentence`;
    - `each response gets a new turn id`.
  - Extend P2's tests:
    - `test_prompt_rules[en|es|ko]` also finds `[[reveal` and "never spoken";
    - `test_board_tags_never_reach_tts` (the `dfa-board` scenario): the fake TTS hears no `[[`, and `beat` server messages arrive;
    - the voice fixtures gain one `beat` event, which `parseServerEvent` and Pydantic both accept.
- [ ] **Step 2: Run them and confirm they fail.** Run `uv run --directory services/server pytest tests/beats tests/voice -v && pnpm --filter @tassel/shared test voice-messages`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep P2's pipeline order otherwise: `[input, stt, …, user_aggregator, llm, BeatTagProcessor, tts, output, assistant_aggregator]`.
- [ ] **Step 4: Run them and confirm they pass.** Same command, plus `ruff check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server packages/shared && git commit -m "feat(voice): beats from Ada's board tags, sent before her words"`

### Task 14: Live beats in the app

*Gate: Task 13.*

**Files:**
- Modify: `tutor/live/rtvi-map.ts` (P2's), `apps/desktop/tests/unit/live/rtvi-map.test.ts`
- Create: `tests/e2e/board/live-board.spec.ts`

**Interfaces:**
- Consumes: P2's `mapRtvi`, `MapState.segment`, `parseServerEvent` (extended in Task 13), `launchVoice` and the developer console (P2 Task 15); Task 1's `word` fields.
- Produces two new `mapRtvi` rules:
  - `server` `{ kind: 'beat', beat }` → `{ type: 'beat', beat }`;
  - each `word` event from `bot-output` gains `segment: segmentId` and `index`, its 0-based position among the segment's words (`accumulated.trim().split(/\s+/)`).

- [ ] **Step 1: Write the failing tests.**
  - **rtvi-map:**
    - `a beat server event becomes a beat tutor event`;
    - `an invalid beat maps to nothing` (Review Focus 5);
    - `word events carry their segment and index`;
    - `the index starts at 0 in each segment`.
  - **E2E `live-board.spec.ts`** (`test.skip(!hasTldrawKey(), …)`):
    - Launch: `launchVoice` with `TASSEL_TUTOR=live`, the server on fake providers (`TASSEL_FAKE_TTS=tone`), and `TASSEL_FAKE_SCRIPT=dfa-board`, which P2's `offerData()` sends as the scenario.
    - Type "Can you show me the answer?" in the developer console.
    - Within 15 s, the board shows `fix` with exactly two states visible, q0 and q1, and the stage is split.
    - No caption ever contains `[[`.
    - `snap('p5-live-board')`.
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test live/rtvi-map && pnpm --filter @tassel/desktop e2e board/live-board`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(voice-client): live beats and word positions"`

### Task 15: Milestone: QA, the design pass and docs

*Converge, last. The live parts wait for Tasks 13–14.*

**Files:**
- Modify: `README.md` (a "Board and beats" section: the fake scripts, where `TLDRAW_LICENSE_KEY` goes and what happens without it, the board tools), `CLAUDE.md` (the rules below), and `services/server/.env.example` once P2 has created it (one commented line, `TLDRAW_LICENSE_KEY=`)
- Create: `docs/superpowers/records/2026-10-17-p5-board-and-beats/qa.md` (what was run, by whom, on which OS, and the screenshot list)

- [ ] **Step 1: Run everything.** `pnpm check`, `pnpm test`, `uv run --directory services/server pytest`, `pnpm e2e`. Expected: all pass, with the `p5-*` screenshots in `apps/desktop/test-results/screens/`.
- [ ] **Step 2: Check parity on Windows.** On a Windows PC: `pnpm test`, then `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e board/`. Expected: PASS. Record who ran it in `qa.md`.
- [ ] **Step 3: App QA, once, with screenshots.**
  - Run `TASSEL_FAKE_SCRIPT=dfa-demo pnpm dev` (with `cross-env` or the shell's syntax on Windows). Walk spec §9 steps 3–7 at 1440×900 and 1024×680, with an en, an es and a ko UI. Pin and unpin mid-explanation, and resize during the split reflow.
  - Then once in a production build with the owner's key (`pnpm --filter @tassel/desktop build`, which prints where it found the key, then the E2E app), and check the board survives past 5 s on `app://tassel`.
  - Post the screenshots to Discord with the `.claude/hooks` helper. They show only synthetic content.
- [ ] **Step 4: The design pass, once.** Run the impeccable finish review (`impeccable:impeccable-finish-reviewer`) on the board, the marks, the snapshot tag and the trace card, against the direction contract, the mock and DESIGN.md. Fix every material finding, rerun the affected specs, and record the verdict in `qa.md`.
- [ ] **Step 5: Live check (owner, once keys exist).** Run a live session and ask Ada to show the answer. Note in `qa.md` whether reveals land on their words. If they lead the audio, set the player's `delayMs` (a new option, default 0) from the measurement.
- [ ] **Step 6: Write the docs.** `CLAUDE.md` gains these rules:
  - only `board/tldraw/**` imports tldraw, and only `board/layout/**` imports `@viz-js/viz` (Task 4's boundary test enforces both);
  - the page CSP never gains `'unsafe-eval'` or `'wasm-unsafe-eval'`;
  - the tldraw key lives only in the environment or the git-ignored `services/server/.env`; never print it, log it, or read that file in an agent session;
  - Ada's commands are `BeatAction`s, never coordinates;
  - new fake scripts register in `tutor/create-client.ts`.
- [ ] **Step 7: Commit and push.** `git add -A && git commit -m "docs(board): P5 QA record, README and agent rules"`, then `git push -u origin claude/p5-board-and-beats`.

---

## Source notes

These are the sources behind the pinned versions and APIs, beyond those linked inline, all checked on 2026-10-17. If an implementer finds one changed, the task report says so before the code changes.

- **tldraw 5.5.2** (tag `v5.5.2`):
  - versions and peers: [npm](https://www.npmjs.com/package/tldraw/v/5.5.2), [registry](https://registry.npmjs.org/tldraw), [release](https://github.com/tldraw/tldraw/releases/tag/v5.5.2), [`@tldraw/assets`](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/assets/package.json) (no `exports` map; `imports.vite.js` sits at the package root);
  - the license:
    - code: [LicenseManager.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/license/LicenseManager.ts) (development or production at L187–L215, the ping at L217–L272, hosts and the native flag at L408–L454), [LicenseProvider.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/license/LicenseProvider.tsx#L34-L121) (the 5 s blank, and the env-name fallback, which doesn't read `RENDERER_VITE_*`), [Watermark.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/license/Watermark.tsx#L26), [LICENSE.md](https://github.com/tldraw/tldraw/blob/v5.5.2/LICENSE.md#L9-L34);
    - changes: PRs [#10021](https://github.com/tldraw/tldraw/pull/10021) (custom protocols are production), [#6726](https://github.com/tldraw/tldraw/pull/6726) (native keys) and [#10060](https://github.com/tldraw/tldraw/pull/10060);
    - docs: [license keys](https://tldraw.dev/sdk-features/license-key), [license](https://tldraw.dev/community/license), [pricing](https://tldraw.dev/pricing), [FAQ](https://tldraw.dev/faq). The docs still say any non-HTTPS protocol is development; the code no longer does;
  - props and options: [TldrawEditor.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/TldrawEditor.tsx#L117-L256), [Tldraw.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/Tldraw.tsx#L75-L113), [options.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/options.ts), [v5.0.0 notes](https://tldraw.dev/releases/v5.0.0) (`colorScheme` replaced `inferDarkMode`);
  - the editor and store: [API report](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/api-report.api.md), [Store.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts#L64-L84), [animation](https://tldraw.dev/sdk-features/animation) (the option is `easing`, and the last frame is an ordinary `updateShapes`);
  - shapes and arrows: [ShapeUtil.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/shapes/ShapeUtil.ts#L158-L247), [shapes](https://tldraw.dev/docs/shapes), [TLArrowShape.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/shapes/TLArrowShape.ts#L165-L182), [TLArrowBinding.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/bindings/TLArrowBinding.ts#L28-L78), [tlschema API report](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/api-report.api.md) (`toRichText`);
  - assets, keyboard and CSP:
    - [assetUrls.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/ui/assetUrls.ts#L15-L34), [installation](https://tldraw.dev/installation#Static-assets), [assets](https://tldraw.dev/sdk-features/assets) (tldraw's recommended CSP), [issue #9441](https://github.com/tldraw/tldraw/issues/9441);
    - [TldrawUi.tsx](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/ui/TldrawUi.tsx#L73-L92) and [useKeyboardShortcuts.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/lib/ui/hooks/useKeyboardShortcuts.ts#L36-L80) (`hideUi` keeps the shortcuts);
    - a scan of the 663 published `dist-esm` files found no `eval`, `new Function`, WebAssembly or workers. tldraw injects `<style>` tags, which P1's `style-src 'unsafe-inline'` allows;
  - testing: there is no exported test editor, and tldraw's own jsdom setup needs canvas, ResizeObserver, IndexedDB, FontFace and fetch polyfills ([TestEditor.ts](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/src/test/TestEditor.ts#L72-L187), [setupVitest.js](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tldraw/setupVitest.js)). So P5's unit tests never mount tldraw: the planners are pure, and the editor is tested in E2E.
- **Graphviz and viz-js:**
  - `@viz-js/viz` 3.31.0, 2026-09-28: [npm](https://www.npmjs.com/package/@viz-js/viz), [CHANGELOG](https://github.com/mdaines/viz-js/blob/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f/packages/viz/CHANGELOG.md), [source](https://github.com/mdaines/viz-js/blob/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f/packages/viz/src/viz.js). The WebAssembly is embedded as a UTF-8 string (Emscripten `SINGLE_FILE`); there is no `.wasm` file ([file list](https://data.jsdelivr.com/v1/packages/npm/@viz-js/viz@3.31.0?structure=flat)). A scan of `dist/viz.js` found no `eval(` or `new Function`.
  - JSON output: [json](https://graphviz.org/docs/outputs/json/) (`json0` has no draw ops), [pos](https://graphviz.org/docs/attrs/pos/), [lp](https://graphviz.org/docs/attrs/lp/), [bb](https://graphviz.org/docs/attrs/bb/), [rankdir](https://graphviz.org/docs/attrs/rankdir/), [splines](https://graphviz.org/docs/attrs/splines/), the [FSM gallery](https://graphviz.org/Gallery/directed/fsm.html).
  - Fallbacks: `@hpcc-js/wasm-graphviz` 1.29.2 ([npm](https://www.npmjs.com/package/@hpcc-js/wasm-graphviz)); `@dagrejs/dagre` 3.1.1, pure JS ([npm](https://www.npmjs.com/package/@dagrejs/dagre), [layout.ts](https://github.com/dagrejs/dagre/blob/v3.1.1/lib/layout.ts)).
- **Workers and CSP in Chromium 152:**
  - a dedicated worker takes its CSP from its own response unless its URL is local ([HTML](https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container), [dedicated_worker_global_scope.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/core/workers/dedicated_worker_global_scope.cc#L264-L272), shipped in M97 per [chromestatus](https://chromestatus.com/feature/5715844005888000));
  - `'wasm-unsafe-eval'` allows compiling WebAssembly but not `eval` ([CSP3](https://w3c.github.io/webappsec-csp/#can-compile-wasm-bytes));
  - verified on this Mac in Electron 44.9.0 with P1's scheme privileges and meta CSP: the page blocks WASM; an `app://` worker with no CSP header allows WASM and `eval`; a header of `script-src 'self' 'wasm-unsafe-eval'` allows WASM and blocks `eval`; a `blob:` worker inherits the page's policy.
- **Pipecat 1.12.0 and client-js 1.14.0** (beats and the live path):
  - 2.x clients get sentence-level `bot-output` with one progress message per word, `segment_id`, and `spoken_progress.accumulated_text`; word-level `bot-output` goes to 1.x clients only ([observer.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/frameworks/rtvi/observer.py#L684-L794), [client messages.ts](https://github.com/pipecat-ai/pipecat-client-web/blob/client-js-v1.14.0/client-js/rtvi/messages.ts#L237-L259));
  - timed frames are released at their `pts` on the server's clock, so word events reach the client somewhat ahead of what she hears (by an UNVERIFIED margin) ([base_output.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/transports/base_output.py#L375-L405));
  - ElevenLabs word times are start times only ([tts_base.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/services/elevenlabs/tts_base.py#L413-L470));
  - the TTS's `text_aggregator` was removed in 1.0.0 in favor of `LLMTextProcessor` between the LLM and TTS ([CHANGELOG](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/CHANGELOG.md?plain=1#L8864)); `PatternPairAggregator`'s handler gets no word position, which is why Task 13 writes its own processor ([pattern_pair_aggregator.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/utils/text/pattern_pair_aggregator.py#L46-L75));
  - an `RTVIServerMessageFrame` is a system frame and is sent at once ([rtvi frames.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/frameworks/rtvi/frames.py#L38-L45)); a non-urgent transport message with a `pts` is never sent ([base_output.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/transports/base_output.py#L1138-L1159));
  - on an interruption the context keeps only the words already released, with their tags from `raw_text` ([llm_response_universal.py](https://github.com/pipecat-ai/pipecat/blob/v1.12.0/src/pipecat/processors/aggregators/llm_response_universal.py#L2413-L2437)).
- **The key at build time:** Vite's `define` replaces the constant in dev and in builds ([define](https://vite.dev/config/shared-options#define)). Node's `util.parseEnv` parses a `.env` file into an object without touching `process.env`, and is stable from Node 22.21.0 and 24.10.0 ([docs](https://nodejs.org/api/util.html#utilparseenvcontent)). Prefix-based env files (`RENDERER_VITE_*`, [electron-vite](https://electron-vite.org/guide/env-and-mode)) aren't used, because the owner keeps the key in `services/server/.env`.
