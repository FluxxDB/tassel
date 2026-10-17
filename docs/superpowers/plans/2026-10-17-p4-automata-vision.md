# P4 Automata Core + Vision Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ada interrupts like a good tutor. P4 reads the student's DFA from her paper, checks it exactly, decides when to step in, and finds the counterexample: the demo's "Before you move on, try running 1010 through your DFA" (spec §9 steps 3–5). It runs end to end on fakes first, then live with OpenAI's Decisions API (or Clef on Vultr) as the gate and Claude Opus 5.5 as the reader.

**Architecture:**
- **Automata core** (`services/server/src/tassel/domains/dfa`, pure Python). It turns a reading into a machine (a missing move goes to an implicit dead state) and determinizes NFAs. A breadth-first search over (student, reference) state pairs gives the shortest counterexample, both traces and the blame step. It also finds one-edit fixes, compiles regexes through automata-lib, matches a hand-written reference catalog, and cross-checks LLM-written references on every string up to length 12.
- **Vision brain** (`services/server/src/tassel/vision`), one `VisionSession` per tutoring session:
  1. P3's frames API hands over each stored frame, and the server flattens the page from P3's quad (OpenCV);
  2. the decision gate (fake, OpenAI Decisions, or Clef on Vultr) answers four English predicates, at most once per 5 s;
  3. when the gate says it's worth it, Set-of-Mark candidates (circles and ink blobs) are numbered on the page, and the deep check (a fixture fake, or Opus 5.5 with structured output) transcribes the DFA in mark numbers;
  4. snapping turns the answer into a `DfaReading` in page coordinates, and the verifier computes the verdict;
  5. the policy applies the etiquette and the escalation ladder. At a natural pause it sends the "How I read your DFA" reading to the board, then a compact English note into P2's bot, which the fast model speaks in the session language.
- **App** (`apps/desktop/src/renderer/src/vision`): the read-back card on the board panel, a developer vision HUD, and the pen activity (from P3's detector) that the etiquette needs.

**Tech Stack:**
- **Server, new:**
  - `automata-lib==9.2.0`, MIT, pure Python ([PyPI](https://pypi.org/project/automata-lib/9.2.0/), [source](https://github.com/caleb531/automata/tree/v9.2.0)). It pulls `networkx`, `frozendict` (LGPL-3.0, pure Python), `typing-extensions` and `cached_method`.
  - `opencv-python-headless==4.14.0.94` (abi3 wheels for macOS arm64 and x86_64 14+, Windows x64 and manylinux; [PyPI](https://pypi.org/project/opencv-python-headless/4.14.0.94/)). It bundles FFmpeg under LGPL-2.1 ([README](https://github.com/opencv/opencv-python/blob/4.x/README.md)). Pinned below 5.x on purpose: 5.0 changes `putText` font metrics.
  - `numpy>=2.5,<3` ([PyPI 2.5.4](https://pypi.org/project/numpy/2.5.4/)).
  - `anthropic==1.15.0`, on `httpx2`, Python ≥ 3.10 ([PyPI](https://pypi.org/project/anthropic/1.15.0/)).
  - `openai==3.31.0`, which has `client.decisions.create` (added in 3.26.0) and is three days old ([PyPI](https://pypi.org/project/openai/3.31.0/), [CHANGELOG](https://github.com/openai/openai-python/blob/main/CHANGELOG.md)).
  - `httpx2>=2.12,<3`, the transport both SDKs use, which P4 imports directly for Clef and for tests ([PyPI](https://pypi.org/project/httpx2/); the floor is openai-python's own requirement).
- **Server, from P1 to P3:** Python 3.12, FastAPI, Pydantic v2, pydantic-settings, SQLAlchemy 2, pytest; P2's `pipecat-ai[webrtc,deepgram]==1.12.0` ([PyPI](https://pypi.org/project/pipecat-ai/1.12.0/)); P3's frames API and object store.
- **Providers:**
  - OpenAI Decisions API, `POST /v1/decisions`, model `gpt-6-luna`, public beta since 2026-10-06 ([guide][oa-guide], [reference][oa-ref], [changelog][oa-changelog]);
  - Clef Flash on Vultr Serverless Inference, `POST https://api.vultrinference.com/v1/systemone` ([reference][vu-ref], [OpenAPI][vu-openapi]);
  - Claude Opus 5.5, `claude-opus-5-5`, through the Messages API with structured outputs ([vision][cl-vision], [coordinates][cl-coords], [structured outputs][cl-so], [fallback][cl-fallback]).
- **Desktop:** P1's stack, unchanged: Electron exactly 44.9.0 ([release](https://releases.electronjs.org/release/v44.9.0)), React 19, Zustand 5, Tailwind v4, i18next, Vitest, Playwright `_electron`. P4 adds **no** npm dependency. The read-back card lays out in plain TypeScript, so the page needs no WebAssembly (P4-R14).

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md`. Mainly:
- §2 (goals 2 and 11), §4.2 (the vision pipeline), §5.1 step 5, §5.2 (vision → decision → check → policy, and the etiquette), §5.3 (computed correctness and the read-back), §5.8 (the automata row and evaluation sets);
- §5.9 (languages), §6 (privacy), §7 (fakes, contract tests and the gate evaluation), §9 steps 3–7, §10 (keys).

Read it with:
- `docs/research/00-flagged-items.md` (the Decisions API and Clef), `01-voice-loop-and-models.md` §6 (Opus 5.5), `02-desktop-camera-vision.md` §5–§6 (flattening, Set-of-Mark, coordinates) and `07-p2-provider-verification.md`;
- the roadmap;
- the P2 plan (`2026-10-17-p2-voice-loop.md`: the bot, the notes convention and the fakes);
- the P3 plan (`2026-10-17-p3-paper-view.md`: the frames API, page quad, coordinates and paper-synth);
- the P5 plan draft (`2026-10-17-p5-board-and-beats.md`: the board, paper marks and the board-edit sink, R10 and R13).

**Starts from:** `claude/p1-foundation` once P3 has merged there. Work on `claude/p4-automata-vision`, with the SDD workspace `.superpowers/sdd/2026-10-17-p4-automata-vision/`. Tasks 1–13 don't need P2; Tasks 14–17 start once P2 has merged (see "Parallel tracks").

**Review flow (main's ruling R30):**
- Every task runs test-first and gets one code review, covering spec and quality.
- Every task runs its own tests and in-app E2E as written. Server-only tasks are exercised in the app by Tasks 14–16.
- App QA with screenshots, and one design pass, happen once at the P4 milestone (end of this plan), not per task. Specs still call `snap()`, so the milestone has screens to look at.

## Global Constraints

Every task's requirements include this section.

**Carried from P1–P3, unchanged**
- **Electron** is exactly `44.9.0`. `contextIsolation`, `sandbox` and no Node in renderers; `window.tassel` is the only IPC surface, and P4 adds no IPC channel.
- **The page CSP** in `apps/desktop/src/renderer/index.html` doesn't change in P4.
- **Cross-platform:** every script runs on macOS and Windows. Node scripts use `cross-spawn`. No command relies on POSIX `VAR=value cmd`; settings travel through scripts and Playwright configs, or the PowerShell form is given too.
- **UI:**
  - every string goes through i18next keys in en, es and ko (`pnpm check:i18n`), with Korean in polite 해요체;
  - every JSON file passes Biome (`pnpm check`);
  - design tokens only. Iris and iris-ink belong to Ada alone (her ring, her caption label, her marks); no drop shadows (hairline `0 0 0 1px`); functional text is never below 11px.
- **Ada's board content** (the read-back's title, footnote and labels) uses the **session's** language, `useCurrentSession().session.language`, through `t(key, { lng })`, as P5 rules. Chrome (the HUD) uses the UI language.
- **Privacy (P3):**
  - a real camera frame is never committed, posted or screenshotted, and `pnpm check` fails on tracked `.jpg`, `.jpeg`, `.mjpeg` and `.y4m` files;
  - agents never answer macOS permission prompts;
  - E2E goes through P3's `launchApp`, which pins a fake paper source and the capture guard.
- **Ports and databases:** 8787 for dev, 8799 for E2E (`TASSEL_E2E_PORT`), database `tassel_e2e`. A second checkout running E2E sets its own `TASSEL_E2E_PORT`, `TASSEL_E2E_DATABASE_URL` and `TASSEL_E2E_S3_BUCKET`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only `claude/*` branches.

**Keys and providers**
- **Keys live only in `services/server/.env`** (git-ignored), with exactly these names:
  - `OPENAI_API_KEY` (the decision gate);
  - `ANTHROPIC_API_KEY` (Opus transcription and the membership call);
  - `VULTR_INFERENCE_API_KEY` (only for the optional Clef gate, spec §10 item 6's Serverless Inference key).

  They never appear in the app, in server events, in client messages, in the vision log or in exception text. Agents never read `.env`: the preflight reports which keys are set, never their values.
- **`VisionSettings`** reads that file in the app's lifespan, never at import or in `create_app`, the way P2's `VoiceSettings` does (P2 Task 2). `TASSEL_VOICE_ENV_FILE` overrides the path, empty means "read no file", and empty values count as unset.
- **Provider mode:**
  - `TASSEL_GATE_PROVIDER` and `TASSEL_DEEPCHECK_PROVIDER` are each `fake`, `live` or `auto`, falling back to P2's `TASSEL_PROVIDERS` (default `fake`);
  - `TASSEL_GATE_LIVE` (`openai` by default, or `clef`) picks the live gate;
  - `auto` is live exactly when the key is set, so with `TASSEL_PROVIDERS=auto` the gate and the deep check stay fake until `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` appear;
  - a provider that resolves live without its key fails startup with `"<VAR>=<mode> needs <KEY> in services/server/.env"`.
- **Tests never reach a live provider:**
  - an autouse fixture in `tests/vision/conftest.py` clears the three keys and every `TASSEL_GATE_*`, `TASSEL_DEEPCHECK_*`, `TASSEL_FAKE_TRUTH`, `TASSEL_FAKE_READING` and `TASSEL_VISION_*` variable, and sets `TASSEL_VOICE_ENV_FILE=""`;
  - P2's `e2eServerEnv` strips the three keys too (Task 16);
  - live runs happen only through `pnpm vision:live-check` (Task 17).
- **Real frames to providers:** live mode sends real camera frames to OpenAI, Anthropic or Vultr. Until P9 ships the consent copy, live vision is for the owner's own testing (P3-R8's gate, extended in P4-R20).

**Values the spec fixes**
- **Gate:** at most one call per 5 s. Four predicates, written in English whatever the session language: `diagram_attempt_complete`, `new_work_worth_checking`, `student_seems_stuck`, `not_schoolwork`.
- **Etiquette:**
  - Ada speaks only after a pause of ≥ 600 ms in her speech and ≥ 1500 ms of pen stillness;
  - never over her;
  - at most one unprompted interruption per 45 s;
  - at most 2 hints per problem while she draws, and only when she stalls or makes a structural slip;
  - a holding line when a check runs past ~2 s.
- **Escalation ladder:** hint → guiding question → counterexample → step-by-step on her paper → full solution on the board. It never jumps to the solution unprompted.
- **Deep check:** Opus 5.5 `claude-opus-5-5` at effort `low` (`medium` allowed), with structured output.
- **Verifier:** missing moves go to an implicit dead state, shown as a note. LLM-written references are trusted only after agreeing on every string up to length 12.
- **The demo:** for "binary strings that start with 010", the scripted wrong DFA (a `1` self-loop on q0) gives `1010`, a false accept, with the q0 loop as the blame step.

**P4's own values** (rulings below), each a named constant in the module that owns it:

| Name | Value | Where |
|---|---|---|
| `STALL_MS` | 6000 (no ink and no speech before the gate is asked about a stall); `TASSEL_VISION_STALL_MS` overrides it | `vision/ports.py` (Task 1, because Teams A and G both use it) |
| `FRESH_FRAME_WAIT_MS` | 6000 (how long a "done" waits for a frame taken after the pen stopped) | `vision/orchestrator.py` |
| `NOTE_TTL_MS` | 30000 | `vision/policy.py` |
| `UNPROMPTED_CHECK_INTERVAL_MS` | 15000 (deep checks nobody asked for) | `vision/policy.py` |
| `PAGE_LONG_SIDE` | 1568 px, the flattened page Opus sees: inside the high-resolution tier, so no server-side resize | `vision/page.py` |
| `GATE_LONG_SIDE` | 1024 px, the image the gate sees | `vision/page.py` |
| `CONFIDENCE_FLOOR` | 0.6 | `vision/transcription.py` |
| `MAX_RERUNS` | 2 (a barge-in before Ada speaks a note reruns the LLM at most twice) | `vision/orchestrator.py` |

## Rulings (spec conflicts and gaps)

The owner pre-authorized self-approval of plans, so these stand unless the owner overrides them. Each gives the ruling, why, and the cost if it's wrong.

- **P4-R1. The OpenAI Decisions API exists as the spec names it** (§3, §4.2, §10). It is `POST https://api.openai.com/v1/decisions`, in public beta since 2026-10-06, with `gpt-6-luna` as its only model and `predicate` questions that return a `probability` ([guide][oa-guide], [reference][oa-ref], [changelog][oa-changelog]). Corrections to research 00:
  - no beta header;
  - send user-role messages only, which is all the SDK types allow;
  - images go as base64 data URLs (hosted URLs work since SDK 3.30, but the guide still says base64);
  - each question can come back as `{"type": "refusal"}` inside an HTTP 200;
  - Luna's image limits and latency are undocumented; one community measurement is about 0.8 s per image request ([thread][oa-forum]);
  - a predicate near 0.5 can be a soft refusal ([thread][oa-refusal]).

  *Cost if wrong:* one adapter file.
- **P4-R2. Clef runs on Vultr's System One endpoint, which isn't OpenAI-compatible.** It is `POST https://api.vultrinference.com/v1/systemone` with model `clef-flash` ([reference][vu-ref], [OpenAPI][vu-openapi], [catalog][vu-models]):
  - the request is a `state`, a `questions` map of `noul` questions, and images in `assets`, behind the header `TypeSafe-Danger-Zone-Images: true`;
  - each image side must be 280–1568 px, at most 8 images, never resized;
  - there are no refusals: every answer is a number, and failures are whole-request HTTP errors.

  TypeSafe calls the image path experimental, so the evaluation harness decides whether it's usable. Cloudflare's model card is [here][cf-clef]. *Cost if wrong:* one adapter file.
- **P4-R3. The live default gate is OpenAI** (`TASSEL_GATE_LIVE=openai`) until the harness says otherwise. Spec §4.2: "the default becomes whichever wins on labeled frames". The owner switches it after Task 17's evaluation. *Cost if wrong:* one setting.
- **P4-R4. How Opus is called** (spec §5.2 step 3). Through `client.beta.messages.create`:
  - `claude-opus-5-5` at `output_config.effort = "low"`, and `thinking` omitted, because it is always on;
  - structured output through `output_config.format` (`json_schema`);
  - server-side fallback with `fallbacks: "default"` and the beta `server-side-fallback-2026-07-01`. Default routing drops any model that would resize a marked image ([fallback][cl-fallback]);
  - the marked page is pre-sized inside the high-resolution tier (long edge ≤ 2576 px, ≤ 4784 visual tokens) and sent with `"transformations": {"oversized_image": "error"}`, so its pixel coordinates are exactly the image Opus saw ([coordinates][cl-coords]);
  - forced tool use is rejected on this model, which is why structured outputs are used ([models][cl-models]).

  *Cost if wrong:* one request builder.
- **P4-R5. The server flattens the page** at a long side of 1568 px, from P3's `page_quad` (pixels of the uploaded full JPEG, P3-R12), or from its own page finder when the quad is missing or degenerate. *Cost if wrong:* one function.
- **P4-R6. Where the ladder starts** (spec §5.2 against §9 step 5). The ladder runs hint → guiding question → counterexample → step-by-step → solution, "climbed only when she asks or after a failed attempt". But the demo goes from one stall hint straight to the counterexample.
  - Ruling: hints while she draws (stall or slip) come out of the 2-hint budget and don't climb the ladder.
  - A completed wrong attempt is the "failed attempt": the first one starts at `counterexample` when the verifier has one, which is itself a question ("try running 1010…"), else at `guiding_question`.
  - Each later failed attempt climbs one rung, up to `walkthrough`.
  - `walkthrough` and `solution` also come when she asks (`explain_dfa`), and `solution` only then.

  *Cost if wrong:* one table row in `plan`.
- **P4-R7. Invited and unprompted.** A note that answers her completion signal or her request is invited, and the 45 s limit doesn't apply to it. Only stall and slip hints are unprompted. Both kinds wait for her pause and her pen. *Cost if wrong:* one flag.
- **P4-R8. Pen stillness comes from the app.** The server sees frames only after the detector's quiet period. So the renderer sends P3's detector `busy` flag as a `pen` client event when it changes (debounced 400 ms on the way to quiet). With no paper source, the pen counts as still. *Cost if wrong:* one client event.
- **P4-R9. A "done" waits for a fresh frame.** She usually says "I think I'm done" right after her last stroke, and the detector uploads that ink only about 3 s later (1 s stable plus 2 s quiet, P3). A gate call on the speech would then judge the stale frame and might call a wrong DFA right.
  - Ruling: a speech-triggered gate call waits until a frame arrives that the server received after the pen went still, or until 6 s have passed.
  - *Cost if wrong:* up to 6 s of delay.
- **P4-R10. The blame step** (spec §5.3 says only "the first transition after which the two disagree"). Every student state is reached first by its shortlex-least access string, and its role is the reference state that string reaches. Along the counterexample's run, the blame is the first step whose student state has a role other than the reference state at that step. If there is none, it is the last state's accept flag.
  - For the demo: q0's role is the reference start; after reading `1` the reference is dead, so step 1, q0's loop on 1, is to blame.
  - For the missing q3 loop: step 4, q3 on 0, with the prefix `010`, which is the demo's hint ("What should happen once you've already read 010?").
  - *Cost if wrong:* one function.
- **P4-R11. The "independently LLM-written membership function"** (§5.3) is a predicate in a small, non-recursive DSL: an OR of ANDs of atoms such as `starts_with`, `count_mod` and `value_mod`. It is evaluated on every string up to length 12 and is never executed code (structured outputs can't express recursive schemas anyway, [structured outputs][cl-so]).
  - The catalog comes first: the demo's hand-written reference plus three classics, matched to the read regex by language equivalence.
  - A language the DSL can't express stays untrusted, and Ada says "I think…".
  - The check covers every string up to length 12 for a binary alphabet, as the spec says. A larger alphabet checks fewer lengths, keeping it under 200,000 words (length 10 for three symbols).
  - *Cost if wrong:* the DSL gains an atom.
- **P4-R12. Notes** are English messages starting with `[vision]` (P2's `is_note`). They carry the computed facts and one line of guidance; the spec's example is a prefix of ours. The role is **`developer`**:
  - P2's OpenRouter service has no developer role, so Pipecat sends it as `user` on a request copy, and the context keeps `developer` ([openrouter llm.py L40][pc-openrouter], [open_ai_adapter.py L255–264][pc-oa-adapter]);
  - RTVI echoes only `user` messages to the client ([rtvi observer.py L831–861][pc-rtvi-obs]);
  - P2's memory keeps the note, and its titles and metrics ignore it.

  *Cost if wrong:* the role string.
- **P4-R13. Barge-in-safe injection** (§4.2 says `LLMMessagesAppendFrame(run_llm=True)`). In Pipecat 1.12.0 an interruption drops every queued interruptible frame, including a note that hasn't reached the context yet ([frame_processor.py L1129–1156][pc-frame-processor], [frame_queue.py L74–87][pc-frame-queue]).
  - Ruling: the note goes in as a non-interruptible `LLMMessagesAppendFrame` with no run, followed by an interruptible `LLMRunFrame()`, which is the pattern Pipecat Flows uses ([CHANGELOG][pc-changelog]).
  - If she barges in before Ada speaks, only `LLMRunFrame` is queued again at the next pause, at most twice. The note is never appended twice.
  - The holding line is `TTSSpeakFrame(text, append_to_context=True)` ([frames.py L873–904][pc-frames]), so the context knows Ada said it.
  - *Cost if wrong:* the delivery function.
- **P4-R14. The read-back card is P4's own overlay in the board panel,** laid out in plain TypeScript: left-to-right ranks by breadth-first order, with arcs for back edges and loops above states.
  - P5 keeps the page CSP free of WebAssembly and runs Graphviz in a worker for its board (P5-R3). The card is small enough not to need Graphviz.
  - Once P5 has merged, its board can host the reading natively; `layoutReading` is the one function to swap.
  - *Cost if wrong:* one layout function.
- **P4-R15. Hand-off to P5.** P5 draws the step-by-step marks on her paper and the solution on the board (P5's tags and marks). P4 provides the data:
  - the reading's element geometry, in page coordinates with radii in page-width units (P5-R10);
  - the verdict, with traces, the blame step and the reference machine;
  - both arrive in the `readback` event and in `GET /v1/sessions/{id}/vision`, and the notes carry them as text.

  P4's E2E stops at the spoken rung. *Cost if wrong:* none to P4.
- **P4-R16. Board edits** (spec §5.3, P5-R13). P5 captures her board edits, which are exact readings from arrow bindings. P4 installs the sink, `POST /v1/sessions/{id}/vision/board`, and runs them through the same gate and policy with no deep check and no read-back. *Cost if wrong:* one route.
- **P4-R17. The event log** (§5.1 step 5). P4 writes gate calls, checks and decisions to a JSONL file (`TASSEL_VISION_LOG`), with no images and no keys. P8 moves them into the session event log. *Cost if wrong:* none.
- **P4-R18. Evaluation sets and "done"** (§5.8, §7):
  - **Gate set:** labeled moments on paper-synth clips (no images committed), plus the owner's real recordings exported from local storage.
  - **Thresholds:** per gate in `vision/gate_thresholds.json`.
  - **Reading "done":** on the synthetic trigger frames, live Opus reaches state F1 ≥ 0.98, transition F1 ≥ 0.95, start and accept exact, and verdict agreement 100%. On at least 20 real frames: 0.95, 0.90 and 0.90.
  - **Gate "done":** balanced accuracy ≥ 0.85 per predicate at the chosen threshold.
  - The thresholds are revisited after the first real recordings. *Cost if wrong:* numbers in one file.
- **P4-R19. A held clip.** P4 adds the paper-synth variant `dfa-demo-hold`, the demo drawing with a longer stall after q3 and a 120 s tail. P3's `dfa-demo` leaves only 8.8 s for the stall hint and loops at 56 s, before the demo's later steps. *Cost if wrong:* one variant.
- **P4-R20. A new demo scenario, and live vision for the owner only, for now.**
  - P2's `dfa-opening` keeps its scripted 1010 line, so P2's specs stand. P4 adds `dfa-vision`, whose fake LLM speaks the computed note through per-language templates; nothing in it hard-codes the witness.
  - Live vision sends real frames to OpenAI, Anthropic or Vultr (spec §6). Until P9's consent copy ships, that is for the owner's own testing, as P3-R8 gates non-local uploads.
  - *Cost if wrong:* none.
- **P4-R21. What Opus receives** (§5.2 step 3):
  - the marked flattened page, and P3's changed-cell crop;
  - the problem context: the session title, her first three substantive lines and the last 20 s of transcript.

  *Cost if wrong:* one context builder.
- **P4-R22. Uncertain readings.** An element below `CONFIDENCE_FLOOR`, or not snapped to a candidate, is uncertain:
  - the card draws it dashed in iris-ink with a "?";
  - the note asks Ada to have her check that part of the board's reading first;
  - the verdict is still computed on the reading.

  *Cost if wrong:* one threshold.

**Not in P4,** with the plan that owns each:
- **P5:** the paper marks and trace animations for `walkthrough`, the board drawing for `solution`, the student's board itself, and Graphviz layout.
- **P8:** persisting vision decisions to the session event log, and `record_evidence` for DFA concepts.
- **P9:** the consent copy for frames sent to providers, and per-language tuning of how Ada words notes.
- **P10:** the Vultr deployment and its keys.
- **P11:** PDAs and Turing machines.
- **P12 and P13:** the general `SubjectModule` (spec §5.8). P4 ships only the `Verifier` protocol.

## Review Focus

These are the five failure modes a student is most likely to meet that the spec never names. Each has a test in the task named.

1. **She says "I'm done" right after her last stroke,** before the detector has uploaded it.
   - Expected: Ada judges the drawing she just finished, never the stale frame.
   - Tests: Task 13 `test_done_waits_for_a_fresh_frame`; Task 16's E2E types "I think I'm done." before the last trigger.
2. **She barges in, or coughs, just as Ada starts on a note.**
   - Expected: the note stays in context, and the LLM reruns once at the next pause. The note is never appended twice and never spoken over her.
   - Tests: Task 13 `test_barge_in_before_speech_reruns_once`; Task 15 `test_bot_channel_appends_then_runs`.
3. **A misread, low-confidence or refused reading** (wobbly circles, a smudge, an Opus refusal or timeout).
   - Expected: no confident wrong claim. Uncertain parts show on the read-back and the note asks her to check them; a failed check speaks only when invited ("I can't quite read it"); the HUD shows the failure.
   - Tests: Task 8 `test_unsnapped_and_low_confidence_are_uncertain`, Task 9 `test_refusal_timeout_and_errors`, Task 5 `test_plan_table`, Task 13 `test_failed_check_speaks_only_when_invited`.
4. **She keeps talking or drawing while a check finishes.**
   - Expected: Ada waits for a 600 ms pause and 1.5 s of pen stillness. A pending stall hint is dropped once she draws again, and any note expires after 30 s.
   - Tests: Task 5 `test_may_speak_order`; Task 13 `test_waits_for_her_pause_and_pen`, `test_hint_is_dropped_when_she_draws_again`, `test_notes_expire`.
5. **A new page or a new problem mid-session.**
   - Expected: the hint budget and the ladder reset, the old reading is cleared from the board, and it never critiques the new page.
   - Tests: Task 13 `test_page_frame_resets_the_problem`.

## What P4 builds on

| From | What P4 uses | Used in |
|---|---|---|
| P1 | `tassel.models.Lang`; `sessions_repo.get_for`; `current_learner`; `get_db`; `create_app`'s lifespan; the conftest `db`, `app` and `client` fixtures; `useStageStore`, `useCurrentSession`, the `Stage` `Panel`, `TopLine` and `TutorTile`; `launchApp`, `snap`, `settle`, `setWindowSize`; the fake tutor (`FakeTutorClient`, `SCRIPTS` in `tutor/create-client.ts`) | throughout |
| P3 Task 1 | The coordinate conventions in `renderer/src/paper/contracts.ts`: a `Quad` is TL, TR, BR, BL in pixels of the uploaded full JPEG; page coordinates are 0–1 from the flattened page's top-left; `CellMask.cells` are `[col, row]` | 7, 13 |
| P3 Task 5 | `POST /v1/sessions/{session_id}/frames` in `tassel/frames/api.py`; `FrameMeta`, `FrameOut`, `Point` (`tassel/frames/models.py`); `ObjectStore`; the `frames` table | 12, 13 |
| P3 Task 6 | `packages/paper-synth`: variants `dfa-demo`, `dfa-short`, `hand-rests`, `shadow-pass`, `erase`; the CLI `node packages/paper-synth/scripts/gen-clip.ts --variant <v> --out <dir>`, which writes `<v>-960x720-<hash8>.mjpeg` and `.truth.json` and prints one JSON line; `ClipTruth` (states with page-coordinate centers and radii, transitions with `labelAt`) | 1, 7, 9, 12, 16 |
| P3 Tasks 7, 10, 13, 14 | The detector harness `apps/desktop/tests/unit/paper/detector/harness.ts`; `usePaperStore` (`stats.busy`); `startPaperSession(page, { type, language, uiLang })`, `framesOf`, global setup's clip generation, and `launchApp`'s fake-clip pins; `scripts/dev.mjs`'s fake clip default | 14, 16 |
| P2 Task 1 | `@tassel/shared/voice` (`ServerEvent`, `ClientEvent`, `parseServerEvent`, `fixtures.json`); `tassel.voice.messages` (`_Message` style with `extra="forbid", strict=True`, `SERVER_EVENTS`, `CLIENT_EVENTS`, `StageEvent`, `is_note`, `envelope`); `TutorEvent`, `VoiceControls` and `TutorClient.voice` in `tutor/types.ts` | 14, 15 |
| P2 Tasks 4, 6, 7, 8 | `FakeScenario`, `ScriptLang`, `ScriptTool`, `next_turn`, `FakeLLMService` and `SCENARIOS_DIR`; `system_prompt`, `TOOLS` and `FunctionSchema`; `Bot` (`worker`, `context`, `events`), `BotContext`, `build_bot`, `ServerEvents.send`, the client-message handler, `worker.add_observer`; `VoiceRegistry` | 15 |
| P2 Tasks 13, 15–17 | `mapRtvi`'s server-event table and `LiveTutorClient.voice`; `useVoiceDebug`, `DevConsole` and `LatencyHud`; `useTutorSession`; `launchVoice`, `e2eServerEnv` and `startE2EServer` | 14, 16 |
| P5 (if merged) | `BoardPanel` in the board `Panel`; `BoardEditSink` (`board/edit-sink.ts`) and its automaton type (`packages/shared/src/beats/automaton.ts`) | 14 |

Names come from those plans. Where the merged code differs, follow the code and say so in the task report.

## Parallel tracks

**Task 1** runs first, on `claude/p4-automata-vision`. It fixes every seam the teams meet at: the dependencies, the settings, the contract on both sides with its fixtures, and the gate's port. Three teams then build at once, at most three helpers, each in its own worktree branched after Task 1. One builder then converges.

| Team | Tasks, in order | Worktree and branch | Writes (nobody else edits these) |
|---|---|---|---|
| **A: automata core** | 2 → 3 → 4 → 5 → 6 | `.claude/worktrees/p4-automata`, `claude/p4-automata` | `services/server/src/tassel/domains/**`, `services/server/tests/domains/**`, `vision/{policy,notes}.py`, `tests/vision/{test_policy,test_notes}.py` |
| **P: perception** | 7 → 8 → 9 | `.claude/worktrees/p4-perception`, `claude/p4-perception` | `vision/{page,marks,transcription,deepcheck,prompts}.py`, `vision/fakes/{__init__.py,deepcheck.py,problems.json}`, `tests/vision/{test_page,test_marks,test_transcription,test_deepcheck_fixture,test_deepcheck_opus}.py`, `tests/vision/fixtures/opus-*.json` |
| **G: gate and card** | 10 → 11 → 12 (Task 12 also needs Task 7 merged) | `.claude/worktrees/p4-gate`, `claude/p4-gate` | `vision/{gate,gate_openai,gate_clef,evalset,gate_eval}.py`, `vision/gate_thresholds.json`, `vision/evalsets/**`, `tests/vision/{test_gate*,test_eval*}.py`, `tests/vision/fixtures/{openai,clef}-*.json`, `apps/desktop/src/renderer/src/vision/readback/**`, `apps/desktop/tests/unit/vision/readback/**`, the `vision.readback.*` keys in `packages/shared/src/i18n/*.json` |
| **Converge** (one builder) | 13 → 14 → 15 → 16 → 17 | `claude/p4-automata-vision` | everything else P4 touches, including P2's, P3's and P5's files |

Server paths are under `services/server/src/tassel/` and server test paths under `services/server/`, unless a path says otherwise.

**Rules:**
- Teams meet only at Task 1's contract. A change to it goes to `main` as a `QUESTION:` first.
- **Gates:**
  - Task 12 starts after Team P's Task 7 has merged into `claude/p4-automata-vision`; Team G rebases first.
  - Task 13 needs Teams A and P, and Task 10, merged.
  - Tasks 14–17 need P2 merged into `claude/p1-foundation` and then into the integration branch.
- **Merging:** merge each team when it finishes, then run `uv lock --directory services/server` and `pnpm install` (never hand-merge lockfiles).
- **E2E:** only Team G's card has renderer code before integration, and it has no E2E of its own (Task 14 mounts and drives it). No team runs E2E before integration.

**Merging with P2, P3 and P5** (recheck at merge time):
- **P2's files** (Tasks 14 and 15): these are edited only after P2 has merged, so there is nothing to merge:
  - `packages/shared/src/voice/{messages.ts,fixtures.json}`;
  - `voice/{messages,bot,registry}.py`;
  - `voice/fakes/{scenario,llm}.py`;
  - `tutor/live/{rtvi-map,live-client}.ts`;
  - `tutor/{types,use-tutor-session}.ts`.

  P5's Tasks 13–14 edit the same contract files, for `actions` and `beat`. Those are adjacent edits; keep both.
- **P3's files:**
  - `frames/api.py`: one hook line after the commit (Task 13);
  - `packages/paper-synth/src/variants.ts` and the CLI's variant list: one more variant (Task 16);
  - E2E `global-setup.ts` and `fixtures.ts`: additive (Task 16);
  - `scripts/dev.mjs`: the default clip becomes `dfa-demo-hold` (Task 16).
- **`features/session/Stage.tsx` and `SessionScreen.tsx`:** P3 mounts `PaperPanel`, P5 mounts `BoardPanel` and `PaperMarksLayer`, and P4 mounts `ReadBackCard` in the board panel, plus `usePenActivity` and `VisionHud`. Keep all.
- **The i18n catalogs:** P4 adds the `vision.*` namespace only.

## File map

| Area | New files |
|---|---|
| Contract (Task 1) | `domains/{__init__,base}.py`, `domains/dfa/{__init__,contract}.py`, `vision/{__init__,settings,ports,messages,clips}.py`, `tests/vision/conftest.py`, `packages/shared/src/vision/{contract.ts,fixtures.json}` |
| Automata (A) | `domains/dfa/{machine,search,regex,reference,fixes,verify,describe,membership}.py`, `domains/dfa/catalog/{starts-with-010,ends-with-01,contains-11,even-zeros}.json`, `vision/{policy,notes}.py`, `tests/domains/**` |
| Perception (P) | `vision/{page,marks,transcription,deepcheck,prompts}.py`, `vision/fakes/{__init__,deepcheck}.py`, `vision/fakes/problems.json`, `tests/vision/fixtures/{transcription-demo,opus-transcription,opus-refusal,opus-membership}.json` |
| Gate and card (G) | `vision/{gate,gate_openai,gate_clef,evalset,gate_eval}.py`, `vision/gate_thresholds.json`, `vision/evalsets/synthetic.json`, `tests/vision/fixtures/{openai-decision,clef-systemone}.json`, `renderer/src/vision/readback/{layout.ts,ReadBackCard.tsx}` |
| Converge | `vision/{orchestrator,registry,api,log,bot_hooks,tools,prompt,smoke,read_eval}.py`, `voice/fakes/scenarios/dfa-vision.json`, `renderer/src/vision/{vision-store.ts,use-pen-activity.ts,VisionHud.tsx,board-sink.ts}`, `renderer/src/tutor/scripts/vision-readback.json`, `apps/desktop/tests/e2e/vision-{readback,demo,languages}.spec.ts`, `apps/desktop/tests/unit/paper/detector/dfa-demo-hold.test.ts`, `scripts/vision-live-check.mjs` |

Renderer paths are under `apps/desktop/src/renderer/src/`.

---

### Task 1: Vision contract, settings and dependencies

**Files:**
- Modify: `services/server/pyproject.toml` and `uv.lock`, adding the runtime dependencies `"automata-lib==9.2.0"`, `"opencv-python-headless==4.14.0.94"`, `"numpy>=2.5,<3"`, `"anthropic==1.15.0"`, `"openai==3.31.0"` and `"httpx2>=2.12,<3"`
- Create: `services/server/src/tassel/domains/__init__.py`, `domains/base.py`, `domains/dfa/__init__.py`, `domains/dfa/contract.py`
- Create: `services/server/src/tassel/vision/__init__.py` (a docstring only, so importing the contract never loads OpenCV or an SDK), `vision/settings.py`, `vision/ports.py`, `vision/messages.py`, `vision/clips.py`
- Create: `services/server/tests/vision/conftest.py`
- Create: `packages/shared/src/vision/contract.ts`, `packages/shared/src/vision/fixtures.json`
- Modify: `packages/shared/package.json`, adding the exports `"./vision": "./src/vision/contract.ts"` and `"./vision/fixtures.json": "./src/vision/fixtures.json"`
- Test: `packages/shared/tests/vision-contract.test.ts`, `services/server/tests/vision/test_contract.py`, `tests/vision/test_settings.py`, `tests/vision/test_clips.py`

**Interfaces:**
- Produces, Python `tassel.domains.dfa.contract`. Every model uses `ConfigDict(extra="forbid", strict=True)`, as P2's messages do. The wire keys are snake_case.

```python
EPSILON = "ε"; DEAD = "∅"           # DEAD is the implicit dead state in traces
MachineKind = Literal["dfa", "nfa"]
class Pt(BaseModel): x: float; y: float          # page coordinates 0–1, or pixels where a field says so
class NormBox(BaseModel): x: float; y: float; w: float; h: float  # page coordinates 0–1
class ReadState(BaseModel):
    id: str; label: str; start: bool; accept: bool; center: Pt
    r: float                                  # a fraction of the page width (P5-R10)
    box: NormBox; mark: int | None; snapped: bool; confidence: float
class ReadTransition(BaseModel):
    id: str; source: str; target: str; symbols: list[str]   # EPSILON for an ε-move
    label_box: NormBox | None; mark: int | None; snapped: bool; confidence: float
class PageGeometry(BaseModel): width: int; height: int; quad: list[Pt] | None   # flattened page px; quad in full-JPEG px
class LanguageGuess(BaseModel): regex: str | None; confidence: float
class DfaReading(BaseModel):
    version: Literal[1] = 1; frame_id: str | None;   # the frame's UUID as text
    source: Literal["paper", "board", "fixture"]; kind: MachineKind
    alphabet: list[str]; states: list[ReadState]; transitions: list[ReadTransition]; page: PageGeometry | None
    problem: str | None; problem_kind: MachineKind | None; language: LanguageGuess | None; uncertain: list[str]
IssueKind = Literal["implicit_dead_state", "nondeterminism", "epsilon_in_dfa", "missing_start", "multiple_starts",
                    "no_accept", "unreachable", "unknown_symbol", "unlabeled_transition", "dangling_transition"]
class Issue(BaseModel): kind: IssueKind; states: list[str]; symbols: list[str]
class Blame(BaseModel):
    step: int; kind: Literal["transition", "missing_transition", "accept_flag"]
    state: str; symbol: str | None; target: str | None; prefix: str
class Counterexample(BaseModel):
    input: str; direction: Literal["false_accept", "false_reject"]
    student_trace: list[list[str]]            # one sorted state set per step (singletons for a DFA); [DEAD] after a missing move
    reference_trace: list[str]; blame: Blame | None
class Fix(BaseModel): kind: Literal["flip_accept", "redirect", "add_transition", "remove_transition"]; state: str; symbol: str | None; target: str | None
class MachineSpec(BaseModel):
    states: list[str]; alphabet: list[str]; start: str; accepts: list[str]; transitions: dict[str, dict[str, str]]   # complete
class ReferenceInfo(BaseModel):
    id: str; source: Literal["catalog", "llm-checked", "llm-unchecked"]; trusted: bool
    regex: str | None; title: str | None; machine: MachineSpec | None
VerdictStatus = Literal["correct", "wrong", "unsure", "unknown", "unreadable"]
class DfaVerdict(BaseModel):
    status: VerdictStatus; computed: bool; counterexample: Counterexample | None
    issues: list[Issue]; fixes: list[Fix]; reference: ReferenceInfo | None
AtomOp = Literal["starts_with", "ends_with", "contains", "length_eq", "length_ge", "length_le", "length_mod",
                 "count_eq", "count_ge", "count_le", "count_mod", "value_mod"]
class Atom(BaseModel): op: AtomOp; text: str | None; symbol: str | None; n: int | None; m: int | None; r: int | None; negate: bool
class Clause(BaseModel): all_of: list[Atom]
class MembershipPredicate(BaseModel): expressible: bool; any_of: list[Clause]
PREDICATE_SCHEMA: dict      # the JSON Schema of MembershipPredicate for output_config.format
```

- Produces, `tassel.domains.base`: `ClaimKind = Literal["computed", "judged"]`, and `class Verifier(Protocol): subject: str; def verify(self, reading, reference) -> object`, the room spec §5.3 leaves for other domains.
- Produces, `tassel.vision.messages`: events on a local `_Message` base with `ConfigDict(extra="forbid", strict=True)`, P2's style, so this task doesn't import P2. Task 14 adds them to P2's unions.

```python
Rung = Literal["hint", "guiding_question", "counterexample", "walkthrough", "solution"]
class ReadbackEvent(_Message): kind: Literal["readback"] = "readback"; reading: DfaReading | None; verdict: DfaVerdict | None
class GateDebug(_Message): stage: Literal["gate"] = "gate"; reason: GateReason; probs: dict[Predicate, float]; ms: int; provider: str
class CheckDebug(_Message): stage: Literal["check"] = "check"; status: VerdictStatus | Literal["failed", "refused", "timeout"]
                            witness: str | None; blame: str | None; ms: int
class PolicyDebug(_Message): stage: Literal["policy"] = "policy"; action: Literal["hold", "speak", "drop", "holding-line"]
                             rung: Rung | None; why: str
class VisionDebugEvent(_Message): kind: Literal["vision-debug"] = "vision-debug"; debug: GateDebug | CheckDebug | PolicyDebug   # discriminated on stage
class PenEvent(_Message): kind: Literal["pen"] = "pen"; busy: bool
```

- Produces, `tassel.vision.ports` (the gate's port, which Teams G and A and the converge builder meet at):

```python
Predicate = Literal["diagram_attempt_complete", "new_work_worth_checking", "student_seems_stuck", "not_schoolwork"]
PREDICATES: tuple[Predicate, ...]                 # the four, in that order
PREDICATE_QUESTIONS: dict[Predicate, str]         # exact text below
GateReason = Literal["frame", "speech", "stall", "board"]
STALL_MS = 6000                                   # no ink and no speech for this long counts as a stall
@dataclass(frozen=True)
class TranscriptLine: speaker: Literal["student", "tutor"]; text: str; at_ms: int
@dataclass(frozen=True)
class GateInput:
    image_jpeg: bytes | None; transcript: tuple[TranscriptLine, ...]; lang: Lang; reason: GateReason
    quiet_ms: int | None; silence_ms: int | None; new_ink: bool; changed_cells: int
@dataclass(frozen=True)
class GateResult: probs: dict[Predicate, float]; refused: tuple[Predicate, ...]; ms: int; provider: str
class GateError(RuntimeError): ...
class DecisionGate(Protocol):
    name: str
    async def evaluate(self, gi: GateInput) -> GateResult     # raises GateError on transport failures
```

- `PREDICATE_QUESTIONS` (exact; they serve as OpenAI `instructions` and Clef `instructions`):
  - `diagram_attempt_complete`: "Has the student finished an attempt at her automaton and is she ready for feedback? Yes if she says she is done or asks whether it is right; no while she is still adding to it."
  - `new_work_worth_checking`: "Does the page show new work since the last check that is worth checking now, such as a new state, arrow or label, rather than a stray mark or nothing new?"
  - `student_seems_stuck`: "Does the student seem stuck? Yes if her automaton looks unfinished and she has stopped writing and talking for a while."
  - `not_schoolwork`: "Is the page or the conversation something other than schoolwork, such as a doodle, a personal note or an unrelated chat?"
- Produces, `tassel.vision.settings`:

```python
Mode = Literal["fake", "live", "auto"]; VisionKind = Literal["gate", "deepcheck"]
SERVER_DIR: Path
class VisionSettings(BaseSettings):   # env_prefix TASSEL_, env_ignore_empty, extra ignore, populate_by_name
    providers: Mode = "fake"; gate_provider: Mode | None = None; gate_live: Literal["openai", "clef"] = "openai"
    deepcheck_provider: Mode | None = None
    openai_api_key: SecretStr | None = Field(None, validation_alias="OPENAI_API_KEY")       # likewise ANTHROPIC_API_KEY,
    anthropic_api_key: SecretStr | None; vultr_inference_api_key: SecretStr | None            # VULTR_INFERENCE_API_KEY
    gate_model: str = "gpt-6-luna"; clef_model: str = "clef-flash"
    deepcheck_model: str = "claude-opus-5-5"; deepcheck_effort: Literal["low", "medium"] = "low"
    gate_timeout_s: float = 4.0; deepcheck_timeout_s: float = 45.0
    fake_truth: Path | None = None; fake_reading: str = "none"                # TASSEL_FAKE_TRUTH, TASSEL_FAKE_READING
    vision_stall_ms: int = 6000; vision_log: Path | None = None               # TASSEL_VISION_STALL_MS, TASSEL_VISION_LOG
    thresholds_path: Path = Path(__file__).with_name("gate_thresholds.json")
    @classmethod
    def load(cls) -> "VisionSettings"         # reads the file TASSEL_VOICE_ENV_FILE names (default SERVER_DIR/".env"; "" reads none)
class VisionConfigError(RuntimeError): ...
def resolve_vision_mode(kind: VisionKind, s: VisionSettings) -> Literal["fake", "live"]   # raises VisionConfigError
def check_vision_settings(s: VisionSettings) -> list[str]                                # every problem, one line each
```

  The keys each kind needs:
  - the gate: `OPENAI_API_KEY` for `openai`, or `VULTR_INFERENCE_API_KEY` for `clef`;
  - the deep check: `ANTHROPIC_API_KEY`.
- Produces, `tassel.vision.clips` (frames from P3's synthetic clips, for tests and the evaluation):

```python
@dataclass(frozen=True)
class ClipFiles: variant: str; mjpeg: Path; truth: Path
REPO_DIR: Path; DEFAULT_CLIPS_DIR: Path        # <repo>/.cache/paper-clips
def find_clip(variant: str, clips_dir: Path = DEFAULT_CLIPS_DIR) -> ClipFiles | None   # <variant>-960x720-*.mjpeg plus its .truth.json
def ensure_clip(variant: str, clips_dir: Path = DEFAULT_CLIPS_DIR) -> ClipFiles         # runs P3's CLI with `node` when missing
def split_mjpeg(data: bytes) -> list[bytes]    # each JPEG, SOI to EOI, walking marker segments up to SOS
def frame_at(mjpeg: Path, t_ms: int, fps: int = 30) -> bytes   # the JPEG at index round(t_ms * fps / 1000)
def variant_of(truth: Path) -> str             # "dfa-demo-hold" from "dfa-demo-hold-960x720-1a2b3c4d.truth.json"
```

- Produces, TypeScript `@tassel/shared/vision`: the same shapes as `DfaReading`, `ReadState`, `ReadTransition`, `NormBox`, `DfaVerdict`, `Counterexample`, `Blame`, `Issue`, `Fix`, `ReferenceInfo`, `MachineSpec`, `Rung`, `Predicate`, `VisionDebug` (the three stage variants), `ReadbackEvent`, `VisionDebugEvent` and `PenEvent`. Also `EPSILON`, `DEAD`, and these hand-written guards (no new dependency):
  - `isDfaReading(x: unknown): x is DfaReading`;
  - `isDfaVerdict(x: unknown): x is DfaVerdict`;
  - `isVisionDebug(x: unknown): x is VisionDebug`.
- `fixtures.json`, which both sides' tests read:
  - **`readings`**, each with the synthetic page's geometry: states at y 0.55 and x 0.18, 0.39, 0.60, 0.81, r 0.055; label boxes 0.04 × 0.04 around P3's label positions.
    - `demo-wrong`: q0 to q3; q0 the start; q3 accepting; q0 -0-> q1, q1 -1-> q2, q2 -0-> q3, q3 -0,1-> q3, q0 -1-> q0.
    - `demo-partial`: the same without the two loops.
    - `demo-correct`: `demo-wrong` without the q0 loop.
    - `demo-no-accept`: `demo-correct` with q3 not accepting.
    - `nondeterministic`: q0 -0-> q1 and q0 -0-> q2.
    - `nfa-ends-with-01`: q0 -0,1-> q0, q0 -0-> q1, q1 -1-> q2 (accepting), with kind `nfa`.
    - `unknown-symbol`: `demo-correct` plus q1 -2-> q1.
    - `uncertain`: `demo-wrong` with q2 at confidence 0.4 and listed in `uncertain`.
  - **`expected`**, the verdict fields Task 4 must reproduce against the `starts-with-010` reference:
    - `demo-wrong` is `wrong`, `1010`, `false_accept`, blame `{step 1, transition, q0, "1", q0, prefix ""}`;
    - `demo-partial` is `wrong`, `0100`, `false_reject`, blame `{step 4, missing_transition, q3, "0", null, "010"}`;
    - `demo-correct` is `correct`;
    - `demo-no-accept` is `wrong`, `010`, `false_reject`, blame `{step 3, accept_flag, q3, null, null, "010"}`.
  - **`events`:** one `readback` (with `demo-wrong` and its verdict), one `vision-debug` per stage, and one `pen`.

- [ ] **Step 1: Write the failing tests.**
  - **`vision-contract.test.ts`:**
    - every fixture reading passes `isDfaReading`;
    - `isDfaReading` refuses `null`, `{}`, a state missing `r`, and `symbols: "0"`;
    - every `events` example passes its guard.
  - **`test_contract.py`** (`REPO = Path(__file__).resolve().parents[4]`):
    - every fixture reading and event round-trips: `model_dump(mode="json")` equals the input;
    - `ReadState` refuses an extra field and a string `confidence`;
    - `PREDICATE_SCHEMA` obeys the structured-output limits:
      - every object has `additionalProperties: false` and lists every property in `required`;
      - no `minimum`, `maximum`, `minLength`, `maxLength` or `maxItems`;
      - no recursion;
      - at most 16 union-typed properties ([limits][cl-so]).
  - **`test_settings.py`:**
    - `test_defaults_are_fake`: both kinds resolve to fake, and there are no problems;
    - `test_auto_is_live_only_with_its_key`;
    - `test_clef_needs_the_vultr_key`: `gate_live="clef"` and `gate_provider="live"` give `["TASSEL_GATE_PROVIDER=live needs VULTR_INFERENCE_API_KEY in services/server/.env"]`;
    - `test_deepcheck_live_needs_anthropic`;
    - `test_reads_the_env_file_named_by_TASSEL_VOICE_ENV_FILE` (`tmp_path`);
    - `test_empty_values_are_unset`: `OPENAI_API_KEY=` with `auto` stays fake;
    - `test_secrets_never_print`: `repr()` holds no key text.
  - **`test_clips.py`:**
    - `split_mjpeg` splits three JPEGs made with `cv2.imencode`, and skips an `FFD9` inside an APP1 segment;
    - `frame_at` picks index 801 for 26700 ms;
    - `variant_of` parses the name;
    - `ensure_clip("dfa-short")` creates the files (it runs Node), and a second call doesn't rerun the CLI.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/shared test vision-contract && uv run --directory services/server pytest tests/vision -v`
  - Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - Run `uv add --directory services/server "automata-lib==9.2.0" "opencv-python-headless==4.14.0.94" "numpy>=2.5,<3" "anthropic==1.15.0" "openai==3.31.0" "httpx2>=2.12,<3"`.
  - Check: `uv run --directory services/server python -c "import automata, cv2, numpy, anthropic, openai, httpx2; print(cv2.__version__)"` prints `4.14.0`.
  - `tests/vision/conftest.py` holds the autouse scrub from Global Constraints, plus a session-scoped `clip` factory fixture over `ensure_clip`.
  - `ensure_clip` finds Node with `shutil.which("node")` and runs from the repo root.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `uv run --directory services/server pytest -v && pnpm check`.
  - Expected: PASS, and every earlier test still passes.
- [ ] **Step 5: Commit.** `git add services/server packages/shared && git commit -m "feat(vision): P4 contract, vision settings, gate port, clip frames and dependencies"`

### Task 2: The DFA machine model, determinization and structural issues

**Files:**
- Create: `services/server/src/tassel/domains/dfa/machine.py`, `services/server/tests/domains/conftest.py` (loads Task 1's fixtures as `DfaReading`s), `tests/domains/test_machine.py`

**Interfaces:**
- Consumes: Task 1's contract and fixtures.
- Produces:

```python
@dataclass(frozen=True)
class Machine:
    states: tuple[str, ...]                                  # reading order; never contains DEAD
    alphabet: tuple[str, ...]                                # sorted
    start: str | None; accepts: frozenset[str]
    moves: Mapping[tuple[str, str], frozenset[str]]          # (state, symbol or EPSILON) -> targets
    @property
    def deterministic(self) -> bool                          # one start, no EPSILON move, at most one target per (state, symbol)
    def next(self, state: str, symbol: str) -> str           # DFA only: the target, or DEAD; DEAD -> DEAD
@dataclass(frozen=True)
class Parsed: machine: Machine; issues: tuple[Issue, ...]
def machine_from_reading(reading: DfaReading, *, alphabet: Sequence[str] | None = None) -> Parsed
def machine_from_spec(spec: MachineSpec) -> Machine
def to_spec(m: Machine) -> MachineSpec                       # complete; adds "dead" for missing moves when any
def epsilon_closure(m: Machine, states: Iterable[str]) -> frozenset[str]
def determinize(m: Machine) -> tuple[Machine, dict[str, frozenset[str]]]
def reachable(m: Machine) -> frozenset[str]
def coreachable(m: Machine) -> frozenset[str]                # states from which an accept state is reachable
def to_automata_dfa(m: Machine) -> "automata.fa.dfa.DFA"     # test oracle
```

- **`machine_from_reading`.** The alphabet is the given one (a reference's), else the reading's `alphabet`, sorted. The issues, in this order:
  - `unknown_symbol`: a symbol outside the alphabet. The move is dropped.
  - `unlabeled_transition`: an empty `symbols` list. Dropped.
  - `dangling_transition`: a `source` or `target` that isn't a state id. Dropped.
  - `missing_start` (and `start` is None), or `multiple_starts` (the first start in reading order is used).
  - `no_accept`.
  - `nondeterminism`: one issue per (state, symbol) with two or more targets.
  - `epsilon_in_dfa`: an ε-move when `problem_kind` or `kind` is `dfa`.
  - `unreachable`: one issue listing them.
  - `implicit_dead_state`: one issue per state with missing moves, listing its missing symbols. This is informational: the read-back's footnote.
- **`determinize`:**
  - subset construction from the ε-closure of the start, in sorted symbol order;
  - a subset's name is its sole member, or `"{a,b}"` sorted and comma-joined;
  - the empty subset is never a state: it's DEAD;
  - the returned map gives each name its NFA states;
  - a machine that is already deterministic comes back unchanged, with singleton subsets.
- **`to_automata_dfa`:** `DFA(states=set(...), input_symbols=set(alphabet), transitions={s: {...}} for every state, initial_state=..., final_states=set(...), allow_partial=True)`. Every state is a key and lists go in as sets ([dfa.py][al-dfa]).

- [ ] **Step 1: Write the failing tests.**
  - `test_demo_wrong_parses_clean`: deterministic; states q0–q3; start q0; accepts {q3}. The only issues are `implicit_dead_state` for q1 (`["0"]`) and for q2 (`["1"]`).
  - `test_partial_has_three_dead_ends`: q1 (`0`), q2 (`1`) and q3 (`0`, `1`).
  - `test_nondeterminism_is_reported_and_kept`: `nondeterministic` gives the issue for q0 on `0`, and `deterministic is False`.
  - `test_epsilon_in_a_dfa_problem`.
  - `test_missing_and_multiple_starts`, `test_no_accept`, `test_unreachable`.
  - `test_unknown_symbol_is_dropped_and_reported`: from the `unknown-symbol` fixture.
  - `test_dangling_and_unlabeled`.
  - `test_next_goes_dead_on_a_missing_move`.
  - `test_determinize_matches_automata_lib`: `to_automata_dfa(determinize(nfa)[0]) == DFA.from_nfa(NFA.from_regex("(0|1)*01", input_symbols={"0", "1"}))`. Here `==` is language equivalence, and both sides use the same alphabet; different alphabets would be a silent `False` ([dfa.py][al-dfa]).
  - `test_to_spec_completes_with_dead`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/domains/test_machine.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement `machine.py`.** Keep `moves` in a `MappingProxyType`; the module imports automata-lib only inside `to_automata_dfa`.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(dfa): machine model with implicit dead state, determinization and structural issues"`

### Task 3: The shortest counterexample, traces and the blame step

**Files:**
- Create: `services/server/src/tassel/domains/dfa/search.py`, `tests/domains/test_search.py`, `tests/domains/test_search_oracle.py`

**Interfaces:**
- Consumes: Task 2.
- Produces (both machines deterministic, over the same alphabet, which is asserted):

```python
def access_strings(m: Machine) -> dict[str, str]          # the shortlex-least word reaching each reachable state
def run(m: Machine, word: str) -> list[str]                # the trace, start included; DEAD after a missing move
def accepts(m: Machine, word: str) -> bool
def shortest_counterexample(student: Machine, reference: Machine) -> tuple[str, Literal["false_accept", "false_reject"]] | None
def blame(student: Machine, reference: Machine, word: str) -> Blame | None
def find_counterexample(student: Machine, reference: Machine, *, subsets: Mapping[str, frozenset[str]] | None = None) -> Counterexample | None
```

- **The search** (spec §5.3):
  1. Breadth-first search over pairs `(s, r)` from `(student.start, reference.start)`, trying symbols in sorted order.
  2. DEAD is an ordinary absorbing state on either side.
  3. The first pair whose acceptance differs ends the search. Its parent pointers give the word, which is the shortest, and the least in shortlex order among the shortest.
  4. The direction is `false_accept` when the student accepts it.
- **The blame step** (P4-R10):
  1. `roles = {s: run(reference, access_strings(student)[s])[-1]}` for every reachable student state, with `roles[DEAD] = None`.
  2. Map any reference state outside `coreachable(reference)` to `None`.
  3. Walk the word. The blame is at the first step `i ≥ 1` where `roles[s_i]` differs from the normalized `r_i`.
     - Its `kind` is `missing_transition` when `s_i` is DEAD and the student had no move there; otherwise `transition`, with `target = s_i`.
     - `state` and `symbol` are `s_{i-1}` and `w[i-1]`, and `prefix` is `w[:i-1]`.
  4. With no such step, the blame is `accept_flag` at the last state, with `prefix = w`.
- **`find_counterexample`** puts the pieces together. With `subsets`, each `student_trace` entry is that subset's sorted members, which are an NFA's token sets. Otherwise each entry is `[state]`.

- [ ] **Step 1: Write the failing tests.**
  - **Against `starts-with-010`** (built here from `machine_from_spec` of a literal spec, until Task 4 adds the catalog):
    - `test_demo_wrong_gives_1010`:
      - `("1010", "false_accept")`;
      - student trace `[[q0],[q0],[q1],[q2],[q3]]`; the reference trace ends in its dead state;
      - blame `Blame(step=1, kind="transition", state="q0", symbol="1", target="q0", prefix="")`.
    - `test_partial_gives_0100_and_the_q3_hint`: `("0100", "false_reject")`, with blame `step=4, kind="missing_transition", state="q3", symbol="0", prefix="010"`.
    - `test_no_accept_blames_the_flag`: `("010", "false_reject")`, with an `accept_flag` blame at q3.
    - `test_correct_has_none`.
  - `test_shortlex_tie_break`: when two words of the shortest length are counterexamples, the lexicographically smaller one is returned.
  - `test_access_strings_are_shortlex`.
  - `test_nfa_traces_are_token_sets`: `nfa-ends-with-01` against `ends-with-01` built from `(0|1)*01` has no counterexample. After removing q1 -1-> q2, the trace lists sets such as `["q0", "q1"]`.
  - **`test_search_oracle.py`** (seed 7, 300 pairs of random partial DFAs, 1–5 states, alphabet `{"0","1"}`):
    - our result is `None` exactly when `to_automata_dfa(a) == to_automata_dfa(b)`;
    - otherwise the word is accepted by exactly one machine, and its length equals `sd.minimum_word_length()` with `sd = A.symmetric_difference(B)`;
    - it equals `next(sd.words_of_length(len))`, the shortlex-first ([dfa.py][al-dfa]).
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/domains/test_search.py tests/domains/test_search_oracle.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement `search.py`.** automata-lib has no shortest-distinguishing-word function, and `words_of_length` grows exponentially, so the product search is our own. automata-lib serves only as the oracle.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(dfa): shortest counterexample by product search, both traces and the blame step"`

### Task 4: The regex dialect, reference catalog, verify and one-edit fixes

**Files:**
- Create: `services/server/src/tassel/domains/dfa/regex.py`, `reference.py`, `fixes.py`, `verify.py`, `describe.py`
- Create: `services/server/src/tassel/domains/dfa/catalog/starts-with-010.json`, `ends-with-01.json`, `contains-11.json`, `even-zeros.json`
- Test: `tests/domains/test_regex.py`, `test_reference.py`, `test_fixes.py`, `test_verify.py`, `test_describe.py`

**Interfaces:**
- Consumes: Tasks 2 and 3; automata-lib `NFA.from_regex(regex, input_symbols=...)`, `DFA.from_nfa(...)` and `.minify()` ([regex docs][al-regex], [parser.py][al-parser]).
- Produces:

```python
class RegexError(ValueError): ...
def compile_regex(regex: str, alphabet: Sequence[str]) -> Machine     # minimal, complete; states q0, q1, … in BFS order; the sink "dead"
@dataclass(frozen=True)
class Reference:
    id: str; title: str | None; machine: Machine; regex: str | None
    source: Literal["catalog", "llm-checked", "llm-unchecked"]; trusted: bool
    def info(self) -> ReferenceInfo
CATALOG: dict[str, Reference]                                     # by id
def catalog_match(machine: Machine) -> Reference | None             # a language-equivalent entry over the same alphabet
def one_edit_fixes(student: Machine, reference: Machine, *, limit: int = 3) -> list[Fix]
def verify(reading: DfaReading, reference: Reference | None) -> DfaVerdict
def describe_machine(m: Machine) -> str
def describe_trace(word: str, trace: list[list[str]]) -> str
DFA_VERIFIER: Verifier                                               # subject "automata.dfa"; verify = the function above
```

- **The regex dialect,** which Task 9's prompt asks Opus for:
  - symbols are single characters of the alphabet;
  - `|` is union, concatenation is juxtaposition, `*` is star, `+` is one or more, `?` is optional, parentheses group, `ε` is the empty string, and `Σ` is any one symbol.
- **`compile_regex`** maps that dialect onto automata-lib:
  1. remove all whitespace (a space is a literal in 9.2.0);
  2. map `ε` to `()` and `Σ` to `(` + `|`.join(alphabet) + `)`;
  3. refuse `[ ] \ & ^ { } .` with `RegexError`. In automata-lib, `^` is shuffle and `.`, `[…]` and escapes can widen the alphabet;
  4. refuse any symbol outside the alphabet;
  5. compile with `NFA.from_regex(rx, input_symbols=set(alphabet))`, then `DFA.from_nfa`, then `minify()`;
  6. rename the states by BFS from the start, call the non-coreachable sink `dead`, and complete the machine;
  7. catch automata-lib's `RegexException` and `AutomatonException` (separate bases, [exceptions][al-exc]) as `RegexError`.
- **The catalog files** are hand-written, complete DFAs in `MachineSpec` form plus `id`, `title` and `regex`:
  - `starts-with-010`: q0–q3 and `dead`; the demo's reference;
  - `ends-with-01`: `(0|1)*01`;
  - `contains-11`: `(0|1)*11(0|1)*`;
  - `even-zeros`: `1*(01*01*)*`.
- **`verify`:**
  1. A reading with no states is `unreadable`, `computed: False`.
  2. Parse with the reference's alphabet, when there is a reference.
  3. With no reference, the status is `unknown`.
  4. Determinize when needed, keeping the subsets.
  5. `status` is `correct` or `wrong` when `reference.trusted`, else `unsure`. `computed` equals `trusted`.
  6. `fixes` come only for a deterministic student with at most 12 states, a counterexample and a trusted reference.
  7. `issues` come from the parse, and `reference` is `reference.info()` with its `MachineSpec`.
- **`one_edit_fixes`** tries:
  1. flipping each state's accept flag, in state order;
  2. then each (state, symbol) in order, pointed at each state or at DEAD:
     - `redirect` when a move existed;
     - `remove_transition` when it now goes to DEAD;
     - `add_transition` when the move was missing.

  It keeps the candidates for which `shortest_counterexample` is `None`, up to `limit`.
- **`describe_machine`** (exact form): the moves `s -a,b-> t` joined with `", "`, grouped per (s, t) with sorted symbols, leaving out moves to dead, then `"; accepting: "` and the accept states. When any move goes to dead it ends with `"; every other move goes to a dead state"`.
- **`describe_trace`** gives `"q0 -1-> q0 -0-> q1 -1-> q2 -0-> q3"`, with sets written `{q0,q1}`.

- [ ] **Step 1: Write the failing tests.**
  - **regex:**
    - `test_dialect`: `compile_regex("010(0|1)*", "01")` accepts 010, 0100 and 0101, and rejects ε, 0, 01, 1010 and 011;
    - `"010Σ*"` is equivalent;
    - `" 0 1 0 ( 0 | 1 ) * "` compiles;
    - `"(0+1)*"` means one-or-more, and its language differs from union;
    - `"0^1"`, `"[01]"`, `"\\d"` and `"012"` raise `RegexError`;
    - states are q0… and `dead`.
  - **reference:**
    - every catalog entry is complete and equivalent to `compile_regex(entry.regex)`, checked through the oracle;
    - `catalog_match(compile_regex("010(0|1)*", "01")).id == "starts-with-010"`;
    - `catalog_match(compile_regex("(0|1)*0", "01")) is None`.
  - **verify** (each against `CATALOG["starts-with-010"]`):
    - every Task 1 `expected` entry is reproduced field by field;
    - `test_unreadable_and_unknown`;
    - `test_untrusted_reference_is_unsure_and_judged`: a `Reference` with `trusted=False` gives `status "unsure"`, `computed False`, and still a counterexample.
  - **fixes:**
    - `demo-wrong`'s first fix is `Fix(kind="remove_transition", state="q0", symbol="1", target=None)`;
    - `demo-partial` has none (no single edit fixes two missing moves);
    - `demo-no-accept` gives `flip_accept` on q3.
  - **describe:**
    - `describe_machine` of the demo reference is exactly "q0 -0-> q1, q1 -1-> q2, q2 -0-> q3, q3 -0,1-> q3; accepting: q3; every other move goes to a dead state";
    - `describe_trace("1010", …)` is exactly "q0 -1-> q0 -0-> q1 -1-> q2 -0-> q3".
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/domains -v`. Expected: FAIL for the new files.
- [ ] **Step 3: Implement the five modules and the catalog.** Load the catalog once, with `importlib.resources`, so it ships inside the package.
- [ ] **Step 4: Run them and confirm they pass.** Run: `uv run --directory services/server pytest tests/domains -v && uv run --directory services/server ruff check`. Expected: PASS, then clean.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(dfa): regex dialect, reference catalog, exact verify and one-edit fixes"`

### Task 5: The interruption policy and vision notes

**Files:**
- Create: `services/server/src/tassel/vision/policy.py`, `vision/notes.py`
- Test: `services/server/tests/vision/test_policy.py`, `tests/vision/test_notes.py`

**Interfaces:**
- Consumes: Task 1 (`Predicate`, `Rung`, the contract); Task 2 (`machine_from_spec`) and Task 4 (`describe_machine`, `describe_trace`).
- Produces:

```python
RUNGS: tuple[Rung, ...] = ("hint", "guiding_question", "counterexample", "walkthrough", "solution")
NOTE_TTL_MS = 30_000; UNPROMPTED_CHECK_INTERVAL_MS = 15_000     # STALL_MS comes from vision.ports (Task 1)
@dataclass(frozen=True)
class Etiquette: pause_ms: int = 600; pen_still_ms: int = 1500; unprompted_gap_ms: int = 45_000
                 hints_per_problem: int = 2; holding_after_ms: int = 2000
@dataclass(frozen=True)
class Signals: complete: bool; worth_checking: bool; stuck: bool; not_schoolwork: bool
def signals(probs: Mapping[Predicate, float], refused: Collection[Predicate], thresholds: Mapping[Predicate, float]) -> Signals
    # a refused or missing predicate counts as False
@dataclass
class ProblemState: key: str; rung: Rung | None = None; hints: int = 0; failed_attempts: int = 0; spoke_correct: bool = False
Trigger = Literal["attempt", "stuck", "slip", "asked-walkthrough", "asked-solution"]
@dataclass(frozen=True)
class NotePlan: trigger: Trigger; rung: Rung | None; unprompted: bool; verdict: DfaVerdict | None; reading: DfaReading | None
def plan(verdict: DfaVerdict | None, reading: DfaReading | None, sig: Signals, problem: ProblemState) -> NotePlan | None
def plan_request(level: Literal["walkthrough", "solution"], verdict: DfaVerdict | None, reading: DfaReading | None,
                 problem: ProblemState) -> NotePlan | None
def apply(problem: ProblemState, p: NotePlan) -> ProblemState      # after Ada has spoken it
@dataclass(frozen=True)
class Moment: now_ms: int; user_speaking: bool; user_stopped_at: int | None; bot_busy: bool
              pen_busy: bool; pen_still_since: int | None; last_unprompted_at: int | None
def may_speak(m: Moment, e: Etiquette, *, unprompted: bool) -> tuple[bool, str]
# notes.py
def render_note(p: NotePlan) -> str
@dataclass(frozen=True)
class ParsedNote: trigger: Trigger; verdict: str; rung: Rung | None; witness: str | None; direction: str | None
                  blame_kind: str | None; state: str | None; symbol: str | None; target: str | None; prefix: str | None
                  trace: list[str]; solution: str | None; judged: bool; uncertain: list[str]
def parse_note(text: str) -> ParsedNote | None
def template_key(n: ParsedNote) -> str
def template_slots(n: ParsedNote) -> dict[str, str]                  # witness, prefix, state, symbol, target, trace, end, solution
HOLDING_LINES: dict[Lang, str] = {"en": "Let me look at that.", "es": "Déjame mirarlo.", "ko": "잠깐만요, 확인해 볼게요."}
```

- **`plan`** (exact; the first row that applies wins; "wrong" includes `unsure`):

| # | When | Plan |
|---|---|---|
| 1 | `sig.not_schoolwork` | None |
| 2 | verdict None or `unreadable` | `sig.complete` → `attempt`, rung None; else None |
| 3 | `correct` | `sig.complete` and not `problem.spoke_correct` → `attempt`, rung None; else None |
| 4 | `unknown` | `sig.complete` → `attempt`, rung None; else None |
| 5 | wrong and `sig.complete` | `attempt`, not unprompted. With `failed_attempts == 0`, the rung is `counterexample` if the verdict has one, else `guiding_question`. Later, it is the rung after `problem.rung`, capped at `walkthrough` |
| 6 | wrong, with a `nondeterminism`, `epsilon_in_dfa` or `unknown_symbol` issue, and `hints < hints_per_problem` | `slip`, `hint`, unprompted |
| 7 | wrong, `sig.stuck` and `hints < hints_per_problem` | `stuck`, `hint`, unprompted |
| 8 | otherwise | None |

- **`plan_request`:**
  - `walkthrough` needs a counterexample, and is `asked-walkthrough` / `walkthrough`;
  - `solution` needs a trusted reference with a machine, and is `asked-solution` / `solution`;
  - otherwise it returns None.
- **`apply`:**
  - `attempt` with a wrong verdict sets `rung` and `failed_attempts += 1`;
  - `attempt` with a correct one sets `spoke_correct`;
  - `stuck` and `slip` add 1 to `hints` and leave `rung`;
  - `asked-*` sets `rung`.
- **`may_speak`** checks in this order and returns the first failure:
  1. `(False, "she is speaking")`;
  2. `(False, "pause")` when `now − user_stopped_at < pause_ms`;
  3. `(False, "Ada is busy")`;
  4. `(False, "pen")` when the pen is busy or `now − pen_still_since < pen_still_ms`;
  5. `(False, "rate")` when unprompted and `now − last_unprompted_at < unprompted_gap_ms`.

  Otherwise it returns `(True, "ok")`.
- **The note grammar** (exact, English). Sentences come in this order, each ending in ". ", optional ones left out:
  1. `[vision] <EVENT>`, where the event is "DFA attempt complete", "She seems stuck", "Structural slip", "She asked to see it" or "She asked for the answer";
  2. `Verdict: <V>`, where V is `correct`, `wrong`, `probably wrong (judged)`, `unknown target language` or `unreadable`;
  3. the witness: `Accepts <w> but should reject` or `Rejects <w> but should accept`;
  4. the blame, by kind:
     - `Blame: <state> on <symbol> goes to <target>`;
     - `Blame: <state> has no move on <symbol> after reading <prefix|nothing>`;
     - `Blame: <state> should accept after reading <prefix>`, or `should not accept`;
  5. `Trace: <describe_trace>` (walkthrough only);
  6. `Solution: <describe_machine(reference)>` (solution only);
  7. `Unsure reading: <ids comma-separated>`;
  8. `Escalation: <rung|none>`;
  9. the guidance (exact):
     - `hint`: "Give one short hint as a question; don't name the fix."
     - `guiding_question`: "Ask one guiding question about that step; don't name the fix."
     - `counterexample`: "Ask her to run <w> through her DFA and say where it ends; don't name the fix."
     - `walkthrough`: "Walk through the trace on her paper, one state at a time, then say where it goes wrong."
     - `solution`: "Describe the solution state by state, and explain the dead state."
     - rung none with a correct verdict: "Confirm briefly and ask her why it works."
     - unreadable: "Say you can't read her DFA and ask her to hold the page still."
     - unknown: "Ask her which strings her DFA should accept."
     - then, when judged: "Say you think so; don't claim to be sure." When uncertain: "Ask her to check the board's reading of <ids> first."
- **`template_key`:**
  - an attempt gives its rung (with `walkthrough.<direction>` for walkthrough), or `correct`, `unreadable` or `unknown`;
  - stuck gives `hint.<blame_kind>`, or `hint.missing_transition_start` when the prefix is empty;
  - slip gives `hint.slip`;
  - asked gives `walkthrough.<direction>` or `solution`.
- **`template_slots`:**
  - `trace` is the trace's states joined by `", "`;
  - `end` is its last state;
  - `solution` is the note's solution text.

- [ ] **Step 1: Write the failing tests.**
  - **`test_plan_table`:** one parametrized case per row, and both branches of rows 2–5. They include:
    - the demo's stall: `demo-partial`, stuck, no hints yet → `stuck`/`hint`;
    - the demo's "done": `demo-wrong`, complete, no attempts → `attempt`/`counterexample`;
    - a second failed attempt → `walkthrough`;
    - a third → still `walkthrough`, never `solution`;
    - 2 hints used → None;
    - not schoolwork wins over everything (Review Focus 3).
  - `test_plan_request`: walkthrough with and without a counterexample; solution with a trusted, an untrusted and no reference.
  - `test_apply_counts_hints_and_climbs`.
  - **`test_may_speak_order`** (Review Focus 4): one moment per reason, plus the open case. A 599 ms pause fails and 600 ms passes; 1499 ms of pen stillness fails and 1500 ms passes; a 44,999 ms unprompted gap fails and 45,000 ms passes; an invited note ignores the rate.
  - **`test_render_demo_notes`**, exact strings:
    - counterexample: "[vision] DFA attempt complete. Verdict: wrong. Accepts 1010 but should reject. Blame: q0 on 1 goes to q0. Escalation: counterexample. Ask her to run 1010 through her DFA and say where it ends; don't name the fix."
    - stall hint: "[vision] She seems stuck. Verdict: wrong. Rejects 0100 but should accept. Blame: q3 has no move on 0 after reading 010. Escalation: hint. Give one short hint as a question; don't name the fix."
    - correct: "[vision] DFA attempt complete. Verdict: correct. Escalation: none. Confirm briefly and ask her why it works."
  - `test_render_walkthrough_and_solution`: they contain "Trace: q0 -1-> q0 -0-> q1 -1-> q2 -0-> q3." and "Solution: q0 -0-> q1, …; every other move goes to a dead state."
  - `test_judged_and_uncertain_suffixes`, from the `uncertain` fixture.
  - `test_parse_round_trips`: `parse_note(render_note(p))` recovers the trigger, rung, witness, direction, blame fields, trace states, solution, judged and uncertain for every plan above. `parse_note("Hi Ada")` is None.
  - `test_template_keys_and_slots`, including `hint.missing_transition` with prefix `010`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_policy.py tests/vision/test_notes.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement both modules.** They are pure: no clock, no I/O.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): interruption etiquette, escalation ladder and vision notes"`

### Task 6: LLM-written references: the membership predicate and the length-12 check

**Files:**
- Create: `services/server/src/tassel/domains/dfa/membership.py`
- Modify: `domains/dfa/reference.py` (add `resolve_reference`)
- Test: `tests/domains/test_membership.py`, `tests/domains/test_resolve.py`

**Interfaces:**
- Consumes: Task 1 (`MembershipPredicate`, `Atom`, `Clause`), Tasks 2–4.
- Produces:

```python
def validate_predicate(p: MembershipPredicate, alphabet: Sequence[str]) -> list[str]   # problems; [] when usable
def evaluate(p: MembershipPredicate, word: str) -> bool
def check_length(alphabet_size: int, cap: int = 200_000) -> int      # the largest L ≤ 12 with Σ_{k≤L} size^k ≤ cap
def agrees(machine: Machine, p: MembershipPredicate, max_len: int) -> str | None   # the shortlex-first disagreement, or None
def resolve_reference(*, regex: str | None, alphabet: Sequence[str], predicate: MembershipPredicate | None,
                      title: str | None) -> Reference | None
```

- **Atoms** (exact; `negate` flips the result):

| Atom | Fields | True when |
|---|---|---|
| `starts_with`, `ends_with`, `contains` | `text` | the word starts with, ends with or contains `text` |
| `length_eq`, `length_ge`, `length_le` | `n` | `len(w)` is `==`, `>=` or `<=` `n` |
| `length_mod` | `m`, `r` | `len(w) % m == r` |
| `count_eq`, `count_ge`, `count_le` | `symbol`, `n` | `w.count(symbol)` compared with `n` |
| `count_mod` | `symbol`, `m`, `r` | `w.count(symbol) % m == r` |
| `value_mod` | `m`, `r` | the word read as a binary number, most significant bit first (ε is 0), `% m == r`; the alphabet must be `0`, `1` |

  A clause is the AND of its atoms; the predicate is the OR of its clauses. An empty `any_of` accepts nothing.
- **`validate_predicate`** reports:
  - a field an op needs but doesn't have;
  - `m < 1`, or `r` outside `0..m-1`;
  - a symbol, or a character of `text`, outside the alphabet;
  - `expressible: False`.
- **`resolve_reference`:**
  1. `regex` None → None.
  2. `compile_regex` fails → None.
  3. `catalog_match` → that entry (`catalog`, trusted).
  4. A valid predicate with `agrees(...) is None` at `check_length(len(alphabet))` → `Reference(id="llm:<first 8 hex of sha256(regex)>", source="llm-checked", trusted=True)`.
  5. Otherwise → `source="llm-unchecked"`, `trusted=False`.

- [ ] **Step 1: Write the failing tests.**
  - `test_atoms`: a table for every op, including `negate` and `value_mod(3, 0)` on ε, "11" and "110".
  - `test_validate`: each problem above gives one line.
  - `test_check_length`: alphabet size 2 gives 12, 3 gives 10, 4 gives 8.
  - `test_agreement_finds_the_first_disagreement`: `compile_regex("(0|1)*01")` against `ends_with "01"` is None; against `ends_with "1"` it is `"1"`.
  - **`test_resolve`:**
    - the demo regex resolves to the catalog;
    - `"(0|1)*00"` with `ends_with "00"` resolves to a trusted `llm-checked` reference;
    - the same regex with `ends_with "0"` resolves to an untrusted `llm-unchecked` one;
    - with an inexpressible predicate, untrusted;
    - with regex None, None.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/domains/test_membership.py tests/domains/test_resolve.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** `agrees` walks the words in shortlex order and runs the machine incrementally (one step per extension), so length 12 over `{0,1}` stays under a second.
- [ ] **Step 4: Run them and confirm they pass.** Run: `uv run --directory services/server pytest tests/domains -v`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(dfa): membership predicate DSL and the length-12 trust check for LLM references"`

### Task 7: Page flattening and Set-of-Mark candidates

**Files:**
- Create: `services/server/src/tassel/vision/page.py`, `vision/marks.py`
- Test: `services/server/tests/vision/test_page.py`, `tests/vision/test_marks.py`

**Interfaces:**
- Consumes: Task 1's `clip` fixture and `frame_at`. P3's scene (Task 6) puts the `dfa-demo` page landscape at 11:8.5, 86% of the frame height, centered and rotated −1.4°, with states of radius 0.055 page widths at y 0.55, and q3's inner circle at 0.8×.
- Produces:

```python
Quad = tuple[Pt, Pt, Pt, Pt]       # TL, TR, BR, BL in full-JPEG px (P3)
PAGE_LONG_SIDE = 1568; GATE_LONG_SIDE = 1024
@dataclass(frozen=True)
class FlatPage: rgb: np.ndarray; width: int; height: int; quad: Quad; found: bool
def decode_jpeg(data: bytes) -> np.ndarray                     # RGB; cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION
def encode_jpeg(rgb: np.ndarray, quality: int = 88) -> bytes
def page_size(quad: Quad, long_side: int = PAGE_LONG_SIDE) -> tuple[int, int]   # the aspect of the quad's mean opposite sides
def find_page_quad(rgb: np.ndarray) -> Quad | None             # P3's algorithm, server side
def usable_quad(q: Sequence[Pt] | None, w: int, h: int) -> Quad | None   # 4 points, convex, ≥ 20% of the frame
def flatten_page(full_jpeg: bytes, quad: Sequence[Pt] | None) -> FlatPage
def resized(rgb: np.ndarray, long_side: int) -> np.ndarray
def ink_mask(page: FlatPage) -> np.ndarray                     # uint8 0/255
@dataclass(frozen=True)
class CircleMark: mark: int; cx: float; cy: float; r: float; inner: bool       # flat-page px
@dataclass(frozen=True)
class LabelMark: mark: int; x: float; y: float; w: float; h: float
@dataclass(frozen=True)
class Candidates: circles: tuple[CircleMark, ...]; labels: tuple[LabelMark, ...]
MAX_MARKS = 40
def find_candidates(page: FlatPage, mask: np.ndarray | None = None) -> Candidates
def draw_marks(page: FlatPage, c: Candidates) -> np.ndarray     # the image Opus sees
```

- **Flattening** (P4-R5):
  - use P3's quad when `usable_quad` accepts it; else `find_page_quad`; else the central 80% of the frame, with `found=False`;
  - `cv2.getPerspectiveTransform` with float32 4×2 points, then `cv2.warpPerspective(..., (w, h), flags=cv2.INTER_AREA)`;
  - `page_size` keeps the long side at 1568, which costs about 2,464 visual tokens on Opus's high-resolution tier, under its 4,784 limit and long edge of 2576 ([vision][cl-vision]).
- **`find_page_quad`** follows P3 Task 8:
  1. Otsu threshold, then a 5×5 close;
  2. the largest external contour, with `approxPolyDP` at 0.02 × its arc length;
  3. exactly 4 convex vertices covering ≥ 20% of the frame;
  4. order them by min x+y (TL), max x−y (TR), max x+y (BR) and min x−y (BL).
- **`ink_mask`:** gray divided by its box blur (61 px at the 1568 side), then `< 0.78`, then a 2×2 open.
- **Candidates** (starting values, all scaled by the page width W):
  - **Hough circles:** `cv2.HoughCircles(blur5(gray), cv2.HOUGH_GRADIENT_ALT, dp=1.5, minDist=0.05·W, param1=300, param2=0.75, minRadius=0.025·W, maxRadius=0.09·W)`. With ALT, `param2` is the circle's "perfectness", below 1 ([OpenCV docs][cv-hough]).
  - **Contour circles:** external contours of the ink mask with area ≥ π(0.025W)², circularity 4πA/P² ≥ 0.55, and a fitted-ellipse axis ratio ≥ 0.6. They are merged with the Hough results, dropping any center within 0.5 r of one already kept.
  - **`inner`:** ink covers at least half of 72 angles on some radius in 0.6–0.9 r. Concentric circles can't both pass Hough's `minDist`, so this radial profile finds the accept ring.
  - **Labels:**
    1. erase each circle's ring, and the inner ring when there is one, from a copy of the mask, at a thickness of 0.012 W;
    2. dilate by 0.01 W, and take `cv2.connectedComponentsWithStats`;
    3. keep groups with a bounding-box side between 0.008 W and 0.12 W and an area of at least 12 px. This drops arrows and lines of printed text.
  - **Numbering:** circles first, then labels. Each is sorted into rows of 0.15 H, then by x; at most `MAX_MARKS`, keeping the largest labels.
- **`draw_marks`:** a white number on a filled `#1d4ed8` rounded tag, at `cv2.FONT_HERSHEY_SIMPLEX` scale 0.55·W/1568, thickness 2. A circle's tag sits outside its top-right, at (cx + 0.75r, cy − 0.95r); a label's tag at its box's top-right. No tag overlaps a circle's inner disk (0.9 r). This image is for the model only; the student never sees it.

- [ ] **Step 1: Write the failing tests.** They run on `dfa-demo` frames at 26700, 38500 and 47100 ms, from `clip("dfa-demo")`:
  - `test_find_page_quad_matches_the_scene`: every corner is within 4 px of the quad computed from P3's scene numbers.
  - `test_flatten_uses_a_given_quad_and_falls_back`: a given quad and `find_page_quad` give flat pages whose circle centers agree within 3 px; a degenerate quad falls back; a frame of plain desk gives `found=False`.
  - `test_page_size_stays_in_the_high_res_tier`: `ceil(w/28)·ceil(h/28) ≤ 4784` and `max(w, h) ≤ 2576`.
  - `test_four_circles_and_one_accept`: at 47.1 s, exactly 4 circles, each within 0.2 r of a truth center (truth page coordinates × the flat page size), with `inner` only on q3.
  - `test_labels_cover_every_transition`: at 47.1 s, every truth `labelAt` lies inside some label candidate grown by 0.02 W. At 26.7 s there are labels for the three edges, and none above q0 or q3.
  - `test_numbering_is_deterministic_and_capped`: two runs are identical, circles come first, and there are at most 40 marks.
  - `test_draw_marks_keeps_inner_disks_clear`: no pixel inside 0.9 r of any circle changes.
  - `test_noise_doesnt_add_circles`: the same with P3's default noise on.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_page.py tests/vision/test_marks.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write the starting values as module constants with one comment each, so tuning on real frames (Task 17, the milestone) changes only constants.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): server-side page flattening and Set-of-Mark circle and label candidates"`

### Task 8: The transcription schema and snapping

**Files:**
- Create: `services/server/src/tassel/vision/transcription.py`, `services/server/tests/vision/fixtures/transcription-demo.json`
- Test: `services/server/tests/vision/test_transcription.py`

**Interfaces:**
- Consumes: Task 1's contract; Task 7's `FlatPage` and `Candidates`.
- Produces:

```python
class TBox(BaseModel): x1: float; y1: float; x2: float; y2: float          # px of the marked page
class TState(BaseModel): label: str; circle_mark: int | None; box: TBox; accept: bool; start: bool; confidence: float
class TTransition(BaseModel): source: str; target: str; symbols: list[str]; label_mark: int | None
                              label_box: TBox | None; confidence: float     # source and target are state labels
class TLanguage(BaseModel): regex: str | None; confidence: float
class DfaTranscription(BaseModel):   # extra="forbid": exactly what Opus returns
    machine_kind: Literal["dfa", "nfa", "none"]; problem_kind: Literal["dfa", "nfa"] | None
    states: list[TState]; transitions: list[TTransition]; alphabet: list[str]
    problem_statement: str | None; language: TLanguage; intent: str | None; intent_confidence: float; unreadable: list[str]
TRANSCRIPTION_SCHEMA: dict           # hand-written JSON Schema mirroring DfaTranscription
CONFIDENCE_FLOOR = 0.6
def schema_problems(schema: dict) -> list[str]
def snap(t: DfaTranscription, page: FlatPage, cands: Candidates, *, frame_id: str | None) -> DfaReading
```

- **The schema obeys the structured-output limits** ([structured outputs][cl-so]):
  - every property is required (nullable instead of optional, since the API allows only 24 optional parameters);
  - boxes are objects, because `minItems` beyond 1 and `maxItems` are unsupported;
  - no numeric bounds; confidences are clamped to 0–1 in `snap`;
  - nullable fields count against the 16-union limit, and this schema has 6;
  - `problem_kind` is an enum that includes null.
- **`schema_problems`** checks exactly those rules. Task 1's `PREDICATE_SCHEMA` passes it too.
- **`snap`:**
  - **States:**
    - a valid `circle_mark` takes that candidate's center and radius (`snapped=True`), else Opus's box (`snapped=False`);
    - if Opus's `accept` disagrees with the candidate's `inner`, Opus's value is kept, the confidence is multiplied by 0.7, and the state is uncertain.
  - **Transitions:**
    - a valid `label_mark` takes that label's box, else `label_box`;
    - `source` and `target` are matched to state labels, and an unknown one is kept as dangling, for the verifier to report;
    - `"ε"`, `"λ"` and `"e"`, when `e` isn't in the alphabet, all become `EPSILON`.
  - **Ids:** a state's id is its label when the label is unique and non-empty, else `s<mark>` or `s<index>`. A transition's id is `<source>-<symbols joined by ,>-<target>`.
  - **Coordinates:** divided by the flat page's width and height; `r` divided by the width.
  - **`uncertain`:** the ids below `CONFIDENCE_FLOOR`, plus every unsnapped id.
  - **`kind`:** `nfa` when there is any ε or nondeterminism, else `dfa`. A `machine_kind` of `none` gives an empty reading.
  - **`language`, `problem` and `problem_kind`** are copied from the transcription.
- **`transcription-demo.json`** is the transcription of the 47.1 s `dfa-demo` frame, in the marks Task 7's tests produce: circles 1–4 for q0–q3, then the labels.

- [ ] **Step 1: Write the failing tests.**
  - `test_schema_obeys_the_limits`: `schema_problems(TRANSCRIPTION_SCHEMA) == []`. Then each forbidden thing (`maxItems`, `minimum`, an optional property, `additionalProperties: true`) gives a problem.
  - `test_schema_matches_the_model`: the property names and required lists at every level equal `DfaTranscription.model_json_schema()`'s, a drift guard.
  - `test_snap_takes_candidate_geometry`: from the fixture and the 47.1 s candidates, the reading equals `demo-wrong`'s machine, with centers within 0.01 and r within 10% of the truth.
  - **`test_unsnapped_and_low_confidence_are_uncertain`** (Review Focus 3): mark 99 falls back to the box and is unsnapped and uncertain; confidence 0.5 is uncertain; an accept disagreement lowers the confidence.
  - `test_duplicate_labels_get_ids`, `test_epsilon_spellings`, `test_none_is_empty`, `test_nfa_kind`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_transcription.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write the fixture by running Task 7's candidates on the 47.1 s frame once, and checking each mark by eye in the drawn image saved under `.cache/` (never committed).
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): Opus transcription schema within structured-output limits, and snapping to marks"`

### Task 9: The deep check: fixture fake, Opus live, and the membership call

**Files:**
- Create: `services/server/src/tassel/vision/deepcheck.py`, `vision/prompts.py`, `vision/fakes/__init__.py`, `vision/fakes/deepcheck.py`, `vision/fakes/problems.json`
- Create: `services/server/tests/vision/fixtures/opus-transcription.json`, `opus-refusal.json`, `opus-membership.json`
- Test: `services/server/tests/vision/test_deepcheck_fixture.py`, `tests/vision/test_deepcheck_opus.py`

**Interfaces:**
- Consumes:
  - Tasks 1, 7 and 8;
  - `anthropic.AsyncAnthropic`, `client.beta.messages.create(..., betas=[...], fallbacks="default", output_config={...})`, `response.stop_reason`, `stop_details` and `_request_id`;
  - `anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler))` for tests. Transports must come from `httpx2` in anthropic 1.x ([fallback][cl-fallback], [SDK][an-sdk]).
- Produces:

```python
@dataclass(frozen=True)
class ProblemContext: title: str | None; early_lines: tuple[str, ...]; recent: tuple[TranscriptLine, ...]; lang: Lang
@dataclass(frozen=True)
class PreparedPage: page: FlatPage; candidates: Candidates; marked_jpeg: bytes; crop_jpeg: bytes | None
def prepare(full_jpeg: bytes, quad, crop_jpeg: bytes | None) -> PreparedPage
@dataclass(frozen=True)
class TranscriptionResult: status: Literal["ok", "refused", "failed", "timeout"]; transcription: DfaTranscription | None
                           ms: int; detail: str | None = None
class DeepCheck(Protocol):
    name: str
    async def transcribe(self, prepared: PreparedPage, ctx: ProblemContext) -> TranscriptionResult
    async def membership(self, problem: str, alphabet: Sequence[str]) -> MembershipPredicate | None
class FixtureDeepCheck:      # fake: the clip's truth, checked against the pixels
    def __init__(self, truth_path: Path, *, delay_ms: int = 0)
class NamedFixtureDeepCheck: # fake without a truth: a Task 1 fixture reading by name, or "none"
    def __init__(self, name: str)
class OpusDeepCheck:
    def __init__(self, *, api_key: SecretStr, model: str = "claude-opus-5-5", effort: Literal["low", "medium"] = "low",
                 timeout_s: float = 45.0, client: anthropic.AsyncAnthropic | None = None)
def transcription_request(prepared: PreparedPage, ctx: ProblemContext, *, model: str, effort: str) -> dict
def membership_request(problem: str, alphabet: Sequence[str], *, model: str) -> dict
def parse_transcription_response(message) -> TranscriptionResult
def make_deepcheck(s: VisionSettings) -> DeepCheck
# prompts.py
TRANSCRIBE_SYSTEM: str; MEMBERSHIP_SYSTEM: str
def render_context(ctx: ProblemContext, prepared: PreparedPage) -> str
```

- **The request** (exact keys; P4-R4):
  - `model`, `max_tokens: 16000`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`;
  - `output_config: {"effort": effort, "format": {"type": "json_schema", "schema": TRANSCRIPTION_SCHEMA}}`;
  - `system: TRANSCRIBE_SYSTEM`;
  - one user message, images before text ([vision][cl-vision]):
    1. `"Image 1: her page, flattened, with numbered tags."`;
    2. the marked page, as `{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": …}, "transformations": {"oversized_image": "error"}}`;
    3. when there is a crop, `"Image 2: the part that just changed."` and the crop;
    4. `render_context(...)`.
  - no `thinking` key, no `temperature`.
  - The client is `AsyncAnthropic(api_key=…, timeout=timeout_s, max_retries=1)`.
- **`TRANSCRIBE_SYSTEM` must contain** (the tests check these phrases):
  - "You transcribe a student's hand-drawn finite automaton";
  - "Transcribe exactly what is drawn, including mistakes. Never fix, complete or judge it.";
  - "A double circle is an accepting state. An arrow that starts from no state points at the start state.";
  - "A label such as 0,1 on one arrow means one transition per symbol.";
  - "Write ε for an empty-string label (epsilon or lambda).";
  - "The numbered blue tags were added by software, not by the student";
  - "circle_mark" and "label_mark", with "null when no tag fits";
  - "Boxes are pixel coordinates in Image 1";
  - "Leave out arrows she didn't draw";
  - "use | for union, * for zero or more, + for one or more, ? for optional, parentheses and ε; never + for union";
  - "Confidence is your probability, from 0 to 1, that the item is read correctly".
- **`render_context`:**
  - `Problem title:` (or "none");
  - `What she said earlier:` her early lines;
  - `Last 20 seconds:`, as `Student:` / `Ada:` lines;
  - `Image 1 is {W}×{H} pixels with {n} tags.`
- **`parse_transcription_response`:**
  - `stop_reason == "refusal"` → `refused`, with `stop_details.category` in `detail`;
  - `max_tokens` → `failed`;
  - otherwise the first `text` block through `DfaTranscription.model_validate_json` (invalid JSON → `failed`).
  - **Errors:** `anthropic.APITimeoutError` → `timeout`; `RateLimitError`, `APIStatusError` and `APIConnectionError` → `failed`. Each is logged with `_request_id` and never the key.
- **Membership:**
  - text only, `effort: "low"`, `max_tokens: 4000`, `output_config.format` with Task 1's `PREDICATE_SCHEMA`, and the same fallback;
  - `MEMBERSHIP_SYSTEM` describes the atoms exactly as Task 6's table, and says "If the atoms can't express the language, set expressible to false". It never sees the regex, so it stays independent (P4-R11).
- **`FixtureDeepCheck`** (spec §7: "rule-based and fed from fixtures"):
  - it loads the truth and the variant's entry in `problems.json` (statement, regex and predicate per variant: `dfa-demo`, `dfa-demo-hold` and `dfa-short`, all "Binary strings that start with 010", `010(0|1)*`, `starts_with "010"`);
  - it samples `ink_mask(prepared.page)` at the truth geometry. Truth page coordinates are scaled by the flat page; `radius` is in page widths;
    - **a state is present** when ink covers ≥ 50% of 72 angles in the band r ± 0.15 r;
    - **accept** is the same test at 0.8 r;
    - **the start** is ink covering ≥ 50% of the segment from x 0.08 to the start state's left edge;
    - **a transition is present** when its label box (`labelAt` ± 0.02 W) holds ≥ 3% ink;
  - it answers with a `DfaTranscription`: the nearest circle mark within 0.5 r and the nearest label mark within 0.03 W, symbols from the label split on `,`, confidence 0.95, and the variant's statement and regex;
  - `membership` returns the variant's predicate;
  - `delay_ms` (for orchestrator tests) sleeps before answering.
- **`make_deepcheck`:** live gives `OpusDeepCheck`; fake with `fake_truth` gives `FixtureDeepCheck`; otherwise `NamedFixtureDeepCheck(fake_reading)`.
- **The fixtures** are constructed from the documented Messages response shape. A `thinking` block (empty text, the default "omitted" display) comes before the `text` block, which holds the JSON of `transcription-demo.json`. `opus-refusal.json` has `stop_reason: "refusal"` and `stop_details: {"type": "refusal", "category": null, "explanation": null}` ([refusals][cl-fallback]). Task 17 records real ones next to them.

- [ ] **Step 1: Write the failing tests.**
  - **fixture:**
    - at 26.7 s: q0–q3 with q3 accepting and q0 the start, and three transitions;
    - at 38.5 s: plus q3 -0,1-> q3;
    - at 47.1 s: plus q0 -1-> q0;
    - at 3.0 s: `machine_kind "none"`;
    - each `snap`s to a reading whose machine equals the matching Task 1 fixture's.
  - `test_fixture_marks_are_real_candidates`: every `circle_mark` and `label_mark` exists in `prepared.candidates`.
  - **`test_request_shape`:** the exact keys above; images before text; `transformations` on the page image; no `thinking`; `max_tokens` 16000; the betas and `fallbacks`; the system prompt's required phrases.
  - **`test_contract_against_the_documented_response`** (`httpx2.MockTransport`):
    - the handler checks the method, the path `/v1/messages`, the `anthropic-beta` header and the JSON body;
    - it returns `opus-transcription.json`;
    - the result is `ok`, with the fixture transcription.
  - **`test_refusal_timeout_and_errors`** (Review Focus 3): the refusal fixture gives `refused`; a `max_tokens` stop and invalid JSON give `failed`; a transport timeout gives `timeout`; a 500 with `max_retries=0` gives `failed`. `caplog` holds no key text.
  - `test_membership_request_and_parse`: `opus-membership.json` gives `starts_with "010"`.
  - `test_make_deepcheck_picks_by_settings`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_deepcheck_fixture.py tests/vision/test_deepcheck_opus.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Build the request as a dict and pass it as keyword arguments, so `test_request_shape` and the live call share it.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): deep check: fixture fake on the clip's pixels, Opus 5.5 with structured output, membership"`

### Task 10: The decision gate: fake, OpenAI Decisions and Clef on Vultr

**Files:**
- Create: `services/server/src/tassel/vision/gate.py`, `vision/gate_openai.py`, `vision/gate_clef.py`, `vision/gate_thresholds.json`
- Create: `services/server/tests/vision/fixtures/openai-decision.json`, `clef-systemone.json`
- Test: `services/server/tests/vision/test_gate.py`, `test_gate_openai.py`, `test_gate_clef.py`

**Interfaces:**
- Consumes:
  - Task 1's port and settings;
  - `openai.AsyncOpenAI(...).decisions.create(input=…, model=…, questions=…)`, which returns `answers[i]` as `{type: "predicate", name, probability}` or `{type: "refusal", name}`, in question order ([reference][oa-ref], [Python][oa-python]);
  - Vultr `POST /v1/systemone` with `Authorization: Bearer`, `TypeSafe-Danger-Zone-Images: true`, and the body `{model, state, questions: {id: {type: "noul", instructions}}, assets: {ref: {type: "image", format: "jpeg", data_base64}}}`, which answers `answers.<id>.noul` ([reference][vu-ref], [OpenAPI][vu-openapi], [errors][vu-errors]).
- Produces:

```python
GATE_MIN_INTERVAL_MS = 5000
def gate_text(gi: GateInput) -> str
class FakeGate:
    name = "fake"; DONE_PHRASES: dict[Lang, tuple[str, ...]]
    def __init__(self, *, stall_ms: int = STALL_MS)          # make_gate passes VisionSettings.vision_stall_ms
class OpenAIDecisionsGate:
    name = "openai"
    def __init__(self, *, api_key: SecretStr, model: str = "gpt-6-luna", timeout_s: float = 4.0, client: openai.AsyncOpenAI | None = None)
def openai_request(gi: GateInput, *, model: str) -> dict
def parse_openai_decision(body: dict) -> tuple[dict[Predicate, float], tuple[Predicate, ...]]
class ClefGate:
    name = "clef"
    def __init__(self, *, api_key: SecretStr, model: str = "clef-flash", timeout_s: float = 4.0, client: httpx2.AsyncClient | None = None)
VULTR_SYSTEMONE_URL = "https://api.vultrinference.com/v1/systemone"
def clef_request(gi: GateInput, *, model: str, ref: str) -> dict
def make_gate(s: VisionSettings) -> DecisionGate
def load_thresholds(path: Path, gate_name: str) -> dict[Predicate, float]
```

- **`gate_text`** (English; only the transcript is in her language). The lines, in order:
  - "A student is working on paper during a live tutoring session on automata (states drawn as circles, transitions as arrows)."
  - "Session language: {English|Spanish|Korean}. The transcript is in that language."
  - "Asked because: {new ink appeared | she just said something | no new ink and no speech for a while | she edited the board}."
  - "Seconds since new ink: {n or unknown}. Seconds since she last spoke: {n or unknown}. New ink since the last check: {yes|no}."
  - "Transcript, last 20 seconds, oldest first:", then `Student: …` / `Ada: …`.
- **`FakeGate`** (rule-based):
  - `diagram_attempt_complete` is 0.9 when a student line from the last 15 s contains one of `DONE_PHRASES[lang]` (casefolded), else 0.1;
  - `new_work_worth_checking` is 0.8 when `new_ink and changed_cells >= 2`, else 0.1;
  - `student_seems_stuck` is 0.85 when `quiet_ms >= stall_ms` and `silence_ms >= stall_ms`, else 0.1;
  - `not_schoolwork` is always 0.05;
  - it takes 0 ms.
- **`DONE_PHRASES`** (exact):
  - en: "i think i'm done", "i'm done", "i think that's it", "that's it", "i'm finished", "is it right", "is this right";
  - es: "creo que ya está", "ya está", "terminé", "he terminado", "listo", "está bien así", "¿está bien?";
  - ko: "다 했어요", "다 됐어요", "끝났어요", "이게 다예요", "맞아요?", "맞나요".

  These cover P2's scripted "I think that's it…" and "Creo que ya está…", and P4's `dfa-vision` lines.
- **`openai_request`:**
  - `model`;
  - `input: [{"role": "user", "content": [{"type": "input_text", "text": gate_text(gi)}, {"type": "input_image", "image_url": "data:image/jpeg;base64,…", "detail": "auto"}]}]`, without the image part when `image_jpeg` is None;
  - `questions: [{"type": "predicate", "name": p, "instructions": PREDICATE_QUESTIONS[p]} for p in PREDICATES]`.
  - The client is `AsyncOpenAI(api_key=…, timeout=timeout_s, max_retries=0)`. The gate is advisory, and a retry would overrun the 5 s interval.
- **`clef_request`:**
  - `{"model": model, "state": {"page": ref, "context": gate_text(gi)}, "questions": {p: {"type": "noul", "instructions": PREDICATE_QUESTIONS[p]}}, "assets": {ref: {"type": "image", "format": "jpeg", "data_base64": …}}}`;
  - `ref` is a fresh `uuid4` string that appears exactly once, as the value of `page`, never inside free text (each appearance counts the image again);
  - no image means no `assets`, no `page` and no header.
  - The headers are `Authorization: Bearer <key>`, `Content-Type: application/json` and `TypeSafe-Danger-Zone-Images: true`.
  - Any non-200 raises `GateError` with the status and the error body's `metadata.error_type`.
- **Images:** the gate image is the flat page resized to `GATE_LONG_SIDE` (1024 px), inside Vultr's 280–1568 px per side and 78,400–2,458,624 px total. The orchestrator prepares it.
- **`gate_thresholds.json`** (initial values; Task 12 rewrites them):

```json
{ "version": 1,
  "fake":   { "diagram_attempt_complete": 0.5, "new_work_worth_checking": 0.5, "student_seems_stuck": 0.5, "not_schoolwork": 0.5 },
  "openai": { "diagram_attempt_complete": 0.6, "new_work_worth_checking": 0.55, "student_seems_stuck": 0.7, "not_schoolwork": 0.8 },
  "clef":   { "diagram_attempt_complete": 0.6, "new_work_worth_checking": 0.55, "student_seems_stuck": 0.7, "not_schoolwork": 0.8 } }
```

  The live thresholds sit above 0.5, so a soft refusal near 0.5 never interrupts (P4-R1).
- **The fixtures** are the documented example shapes: `openai-decision.json` is `{answers: […], model: "gpt-6-luna", usage: {…}}` with one refusal answer; `clef-systemone.json` is `{model, answers: {id: {type: "noul", noul}}, usage}`. Task 17 records real ones.

- [ ] **Step 1: Write the failing tests.**
  - `test_gate_text`: the exact lines for one `GateInput` of each reason; Korean transcript text passes through unchanged.
  - **`test_fake_gate`:**
    - "I think I'm done." 3 s ago gives `complete` 0.9;
    - "다 했어요" with lang ko does too;
    - 16 s ago gives 0.1;
    - new ink with 40 changed cells gives `worth` 0.8;
    - 7 s quiet and 9 s silent gives `stuck` 0.85;
    - 7 s quiet and 2 s silent gives 0.1.
  - **`test_openai_request_shape`:** the exact keys above, with the data-URL prefix; four predicates in `PREDICATES` order with `name` set; no image part when `image_jpeg` is None.
  - **`test_openai_contract`** (`httpx2.MockTransport`, through `http_client=openai.DefaultAsyncHttpxClient(transport=…)`):
    - the handler checks `POST /v1/decisions` and the body;
    - the fixture's refusal on `not_schoolwork` gives `refused == ("not_schoolwork",)`, and that predicate is missing from `probs`;
    - a 500 raises `GateError`.
  - **`test_clef_request_shape_and_contract`:** the ref appears exactly once in `state` and once as the `assets` key; the three headers; the fixture parses; 400, 413, 422, 429 and 529 each raise `GateError` naming the status.
  - `test_make_gate_and_thresholds`: fake by default; live `openai` and `clef` by `gate_live`; `load_thresholds(path, "openai")["student_seems_stuck"] == 0.7`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_gate.py tests/vision/test_gate_openai.py tests/vision/test_gate_clef.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each gate times itself with `time.perf_counter()` into `GateResult.ms`.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): decision gate: rule-based fake, OpenAI Decisions predicates, Clef on Vultr System One"`

### Task 11: The "How I read your DFA" card

**Files:**
- Create: `apps/desktop/src/renderer/src/vision/readback/layout.ts`, `vision/readback/ReadBackCard.tsx`
- Modify: `packages/shared/src/i18n/{en,es,ko}.json` (the `vision.readback.*` keys below)
- Test: `apps/desktop/tests/unit/vision/readback/layout.test.ts`, `tests/unit/vision/readback/readback-card.test.tsx`

**Interfaces:**
- Consumes: `DfaReading`, `EPSILON` and the fixtures from `@tassel/shared/vision` (Task 1); P1's tokens and `cn`.
- Produces:

```ts
export interface CardState { id: string; label: string; x: number; y: number; r: number; accept: boolean; start: boolean; uncertain: boolean }
export interface CardEdge { id: string; d: string; head: Array<[number, number]>; label: string; lx: number; ly: number; uncertain: boolean }
export interface CardLayout { width: number; height: number; states: CardState[]; edges: CardEdge[];
  start: { d: string; head: Array<[number, number]> } | null; missingMoves: boolean }
export function layoutReading(reading: DfaReading): CardLayout;
export function ReadBackCard(props: { reading: DfaReading | null; lang: Lang }): JSX.Element | null;
```

- **`layoutReading`** (P4-R14; viewBox units):
  - **Ranks:** breadth-first from the start state (or the first state) over transitions that aren't self-loops, in reading order. States never reached go one rank further, in reading order.
  - **Positions:** a state is at `x = 20 + 28 + rank·92`, `y = 20 + row·72`, `r = 17`, where `row` is its discovery order within the rank.
  - **Merging:** arrows between the same pair merge into one edge, labelled with the symbols sorted and joined by `,`.
  - **Self-loops:** a cubic from (x − 0.5r, y − 0.85r) to (x + 0.5r, y − 0.85r), with controls at (x ∓ 1.4r, y − 3r); the label at (x, y − 3.1r).
  - **Next rank, same row, no reverse edge:** a straight line between the circle edges, labelled 8 above its middle.
  - **Otherwise:** a quadratic whose control point sits 0.35 × the distance off the line, above when going right and below when going left, so a two-way pair separates. The label goes at the control point.
  - **Heads:** a 7-unit triangle at the target's edge, along the tangent.
  - **Start arrow:** a 28-unit line into the start state from the left.
  - **`missingMoves`:** some state lacks a move on some alphabet symbol.
  - **`width` and `height`:** the bounds plus 20.
- **`ReadBackCard`:**
  - a paper card: `rounded-card`, a hairline ring, no shadow, a fixed width of 360 px (clipped, never reflowed), padding 16;
  - a title button, mono uppercase 11 `vision.readback.title`, with `aria-expanded`. It collapses the body so she can move it out of the way;
  - an SVG scaled to 328 px wide:
    - states are ink circles at stroke 1.6, with an inner ring at 0.82 r when accepting;
    - labels are Geist 13 ink, and edge labels Geist Mono 12;
    - uncertain elements are iris-ink and dashed `4 3`, with a "?" in iris-ink beside them;
  - `vision.readback.deadState` in smoke-text 12 when `missingMoves`;
  - `vision.readback.uncertain` when anything is uncertain;
  - a visually hidden list naming every state and transition, through `vision.readback.srState` and `srTransition`;
  - `role="figure"` with `aria-label` `vision.readback.title`;
  - 150 ms fade-in, instant under reduced motion;
  - `data-testid` hooks: `readback-card`, each state `readback-state-<id>` with `data-accept` and `data-uncertain`, each edge `readback-edge-<id>`;
  - all text in `lang` (the session's), through `t(key, { lng: lang })`.
- **Copy** (exact; Korean avoids particles after placeholders):

| Key | en | es | ko |
|---|---|---|---|
| `vision.readback.title` | How I read your DFA | Así leí tu AFD | 내가 읽은 DFA |
| `vision.readback.deadState` | Missing arrows go to a dead state. | Las flechas que faltan van a un estado muerto. | 없는 화살표는 죽은 상태로 가요. |
| `vision.readback.uncertain` | ? I'm not sure about this part. | ? No estoy segura de esta parte. | ? 이 부분은 확실하지 않아요. |
| `vision.readback.collapse` | Hide my reading | Ocultar mi lectura | 내 읽기 숨기기 |
| `vision.readback.expand` | Show my reading | Mostrar mi lectura | 내 읽기 보기 |
| `vision.readback.srState` | {state}{start, select, true {, start} other {}}{accept, select, true {, accepting} other {}} | {state}{start, select, true {, inicial} other {}}{accept, select, true {, de aceptación} other {}} | {state}{start, select, true {, 시작} other {}}{accept, select, true {, 수락} other {}} |
| `vision.readback.srTransition` | {from} to {to} on {symbols} | De {from} a {to} con {symbols} | {from} → {to}, 입력 {symbols} |

- [ ] **Step 1: Write the failing tests.**
  - **layout** (`demo-wrong`):
    - q0–q3 at ranks 0–3 on one row, x 48 apart by 92;
    - the q0 and q3 loops have their labels above their states;
    - `q0-0-q1` is a straight line;
    - ids map one to one;
    - `missingMoves` is true;
    - every point lies inside `width × height`.
  - `layout: a back edge curves and a two-way pair separates` (a custom reading).
  - `layout: unreachable states go last`.
  - **card** (jsdom):
    - renders 4 states with `data-accept` on q3 only, and 5 edges collapsed to 5 ids;
    - the footnote when `missingMoves`;
    - `uncertain` dashes q2 and shows the "?" line;
    - the title follows `lang`: ko shows "내가 읽은 DFA" with the UI in en;
    - collapse hides the SVG and flips `aria-expanded`;
    - the hidden list names "q0 to q0 on 1";
    - null renders nothing.
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm --filter @tassel/desktop test vision/readback`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before the UI, read `docs/design-system/DESIGN.md`, `.impeccable/mocks/decision/stage.html`, the session direction contract and the P1 design checklist §0 and §4.
- [ ] **Step 4: Run them and confirm they pass.** Run: `pnpm --filter @tassel/desktop test && pnpm check:i18n && pnpm --filter @tassel/desktop typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop packages/shared/src/i18n && git commit -m "feat(vision): the How I read your DFA card with a pure layered layout"`

### Task 12: The gate evaluation harness and thresholds

*Starts after Task 7 has merged into `claude/p4-automata-vision`; rebase first.*

**Files:**
- Create: `services/server/src/tassel/vision/evalset.py`, `vision/gate_eval.py`, `vision/evalsets/synthetic.json`
- Test: `services/server/tests/vision/test_eval_set.py`, `tests/vision/test_eval_gate.py`

**Interfaces:**
- Consumes: Task 1's `clips`; Task 7's `flatten_page`, `resized` and `encode_jpeg`; Task 10's gates and `load_thresholds`; P3's frames repo and `ObjectStore` (for `export`).
- Produces:

```python
@dataclass(frozen=True)
class LabeledMoment:
    id: str; variant: str; at_ms: int; lang: Lang; reason: GateReason; transcript: tuple[TranscriptLine, ...]
    quiet_ms: int | None; silence_ms: int | None; new_ink: bool; changed_cells: int; labels: dict[Predicate, bool | None]
def load_moments(path: Path) -> list[LabeledMoment]
def gate_input_for(m: LabeledMoment, clips_dir: Path) -> GateInput      # the frame at at_ms, flattened, at GATE_LONG_SIDE
@dataclass(frozen=True)
class PredicateScore: n: int; positives: int; accuracy: float; balanced_accuracy: float; brier: float
                      best_threshold: float; refusals: int
@dataclass(frozen=True)
class GateReport: gate: str; scores: dict[Predicate, PredicateScore]; p50_ms: int; p90_ms: int; errors: int
async def evaluate_gate(gate: DecisionGate, moments: Sequence[LabeledMoment], inputs: Sequence[GateInput],
                        thresholds: Mapping[Predicate, float]) -> GateReport
def best_threshold(pairs: Sequence[tuple[float, bool]]) -> float          # max balanced accuracy over 0.05 … 0.95; ties go higher
def main(argv: list[str] | None = None) -> int
#   python -m tassel.vision.gate_eval [--gates fake,openai,clef] [--set synthetic|<dir>] [--write-thresholds] [--json out.json]
#   python -m tassel.vision.gate_eval export --session <uuid> --out <dir>
```

- **`synthetic.json`** holds 24 moments on `dfa-demo`, `shadow-pass`, `hand-rests` and `erase`. The labels are written by hand from P3's timelines; null means "skip this predicate". Each predicate has at least 4 positives and 4 negatives, with at least one positive each in en, es and ko for `diagram_attempt_complete` and `student_seems_stuck`.
  - `dfa-demo` 3.0 s, blank page after the first line: all false.
  - 26.7 s, reason `frame`, narration of q0–q3: worth true, the others false.
  - 31.0 s, reason `stall`, quiet 7300, silent 9000: stuck true, worth false.
  - 38.5 s and 47.1 s, reason `frame`, narration: worth true.
  - 48.0 s, reason `speech`, "I think I'm done.": complete true, worth false.
  - The same in es ("Creo que ya está.") and ko ("다 했어요.").
  - 47.1 s, "Is it right?": complete true.
  - The 3.0 s frame with "Did you see the game last night? It was wild.": not schoolwork true.
  - `shadow-pass` 3.5 s and `hand-rests` 6.0 s: all false (a shadow or a resting hand isn't work).
  - `erase` 7.0 s, reason `frame`: worth true.
  - The rest are es and ko variants of the stall and narration moments.
- **The score:** a prediction is `prob ≥ threshold`, and a refusal counts as false. Balanced accuracy is the mean of the true-positive and true-negative rates. Brier is the mean of `(prob − label)²` over answered items.
- **`--write-thresholds`** writes each gate's best thresholds into `gate_thresholds.json`, and never drops below 0.5 for live gates.
- **The printed table:** gate, predicate, n, balanced accuracy at the current threshold, best threshold, Brier, refusals; then p50/p90 latency, and the recommendation: the higher mean balanced accuracy, with ties going to the lower p90 (spec §4.2).
- **`export`** writes a real session's frames from the object store as `frames/<seq>.jpg` under `--out`, which must be under `.cache/`. It writes a `labels.json` with one moment per frame, null labels and an empty transcript. (Task 17 fills the transcript and activity from the vision log, whose format Task 13 sets.) The owner labels it by hand. Real frames stay local (P3's privacy rules).

- [ ] **Step 1: Write the failing tests.**
  - `test_moments_load_and_cover_each_predicate`: the coverage rules above.
  - `test_gate_input_for_uses_the_flat_page`: a 1024-px-long JPEG; `quiet_ms`, `silence_ms` and the transcript pass through.
  - `test_best_threshold`: on `[(0.2, F), (0.4, F), (0.6, T), (0.9, T)]` it is 0.45; ties go to the higher threshold.
  - **`test_fake_gate_scores_perfectly`** (a sanity check of labels against rules): the fake gate's balanced accuracy is 1.0 on every predicate except `not_schoolwork`, which the fake never flags, so 0.5.
  - `test_refusals_count_false_and_are_counted`: a stub gate.
  - `test_cli_prints_the_table_and_writes_thresholds` (`tmp_path` copy of the thresholds file).
  - `test_export_refuses_paths_outside_cache`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_eval_set.py tests/vision/test_eval_gate.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run each gate's inputs concurrently, at most 4 at a time.
- [ ] **Step 4: Run them and confirm they pass,** then run `uv run --directory services/server python -m tassel.vision.gate_eval --gates fake`. Expected: PASS, and the table.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): gate evaluation on labeled synthetic moments, real-recording export, thresholds"`

### Task 13: The vision orchestrator, registry, frames hook and API

*Converge. Starts once Teams A and P, and Task 10, have merged.*

**Files:**
- Create: `services/server/src/tassel/vision/orchestrator.py`, `vision/registry.py`, `vision/api.py`, `vision/log.py`
- Modify:
  - `services/server/src/tassel/frames/api.py` (P3): after the frame row commits, `request.app.state.vision.on_frame(...)`, which never blocks the 201;
  - `services/server/src/tassel/app.py`: `create_app` gains `vision_settings: VisionSettings | None = None`, beside P2's `voice_settings` when P2 has merged. The lifespan builds `vision_settings or VisionSettings.load()`, raises `VisionConfigError` on `check_vision_settings` problems, puts `VisionRegistry` on `app.state.vision`, and shuts it down before the engine. `create_app` itself never reads `.env`. The vision router goes under `/v1`;
  - `packages/shared/src/api/{openapi.json,schema.d.ts}` (regenerated).
- Test: `services/server/tests/vision/test_orchestrator.py`, `tests/vision/test_registry.py`, `tests/vision/test_vision_api.py`

**Interfaces:**
- Consumes: Tasks 1–10; P3's `FrameOut`, `FrameMeta` and route; P1's `sessions_repo.get_for` and `current_learner`.
- Produces:

```python
class TutorChannel(Protocol):          # Task 15's BotChannel implements it; tests use a recorder
    lang: Lang
    async def append_note(self, text: str) -> None
    async def run_llm(self) -> None
    async def say(self, text: str) -> None
    async def send(self, event: BaseModel) -> None
FRESH_FRAME_WAIT_MS = 6000; MAX_RERUNS = 2; TICK_MS = 250
@dataclass(frozen=True)
class FrameIn: id: UUID; reason: Literal["ink", "page"]; received_ms: int; full_jpeg: bytes; crop_jpeg: bytes | None
               quad: list[Pt] | None; changed_cells: int
class VisionSnapshot(BaseModel):
    reading: DfaReading | None; verdict: DfaVerdict | None; rung: Rung | None; hints: int; frames_seen: int
    last_gate: GateDebug | None; last_decision: PolicyDebug | None; pen_busy: bool; pending_note: bool
class VisionSession:
    def __init__(self, *, session_id: UUID, lang: Lang, gate: DecisionGate, deepcheck: DeepCheck,
                 thresholds: Mapping[Predicate, float], title: Callable[[], Awaitable[str | None]],
                 clock: Callable[[], float] = time.monotonic, log: VisionLog | None = None,
                 etiquette: Etiquette = Etiquette(), stall_ms: int = STALL_MS)
    def on_frame(self, f: FrameIn) -> None
    def on_board_edit(self, reading: DfaReading, image_jpeg: bytes | None) -> None
    def on_user_text(self, text: str, *, typed: bool) -> None
    def on_user_speaking(self, speaking: bool, *, stopped_ms_ago: int = 0) -> None
    def on_bot(self, *, speaking: bool | None = None, reply: Literal["started", "ended"] | None = None) -> None
    def on_interruption(self) -> None
    def on_pen(self, busy: bool) -> None
    async def explain(self, level: Literal["walkthrough", "solution"]) -> dict     # {"ok": True} or {"ok": False, "reason": …}
    def attach(self, channel: TutorChannel) -> None; def detach(self) -> None
    async def tick(self) -> None        # one pass over timers and pending work
    async def idle(self) -> None        # tests: waits for in-flight gate and check tasks
    def snapshot(self) -> VisionSnapshot
    async def close(self) -> None
class VisionRegistry:
    def __init__(self, *, settings: VisionSettings, sessions: async_sessionmaker[AsyncSession],
                 gate: DecisionGate | None = None, deepcheck: DeepCheck | None = None, clock=time.monotonic)
    def session(self, *, learner_id: UUID, session_id: UUID, lang: Lang) -> VisionSession   # created on first use
    def get(self, session_id: UUID) -> VisionSession | None
    def on_frame(self, *, learner_id: UUID, session: TutoringSession, frame: FrameOut, full: bytes, crop: bytes | None) -> None
    async def shutdown(self) -> None
class VisionLog:
    def __init__(self, path: Path | None)
    def write(self, session_id: UUID, record: dict) -> None    # one JSON line; creates the directory; no images, no keys
# api.py, both routes need the device token; another learner's session is 404
#   GET  /v1/sessions/{session_id}/vision        -> VisionSnapshot (empty when nothing has happened yet)
#   POST /v1/sessions/{session_id}/vision/board  -> 202; body BoardEditIn
class BoardEditIn(BaseModel): reading: DfaReading; image_png: str | None   # base64 PNG ≤ 2 MiB decoded; 413 beyond, 422 when invalid
```

- **The rules** (pinned; `now` is `clock()` in ms):

| Event | What `VisionSession` does |
|---|---|
| `on_frame` ink | Keeps it as the latest frame. Requests a `frame` gate call. A pending fresh-frame wait is satisfied when `received_ms > pen_still_since` |
| `on_frame` page | Starts a new problem: a new `ProblemState`, the reading and verdict cleared, any pending note dropped, `ReadbackEvent(reading=None, verdict=None)` sent. Then as for ink |
| `on_user_text` | Adds a transcript line (kept 120 s), and adds it to `early_lines` if it has 3 words or more and there are fewer than 3. Typed lines set `user_stopped_at = now`. With a frame present, it requests a `speech` gate call (P4-R9) |
| `on_user_speaking` | Tracks VAD speech; on stop, `user_stopped_at = now − stopped_ms_ago` |
| `on_bot` | Tracks Ada's audio and her reply in flight. A reply is in flight from `reply="started"` until her audio stops, an interruption, or 1500 ms after `reply="ended"` with no audio (an empty reply). `bot_busy` is audio or a reply in flight. Her audio starting after a note's delivery marks the note spoken, applies the plan, and stamps `last_unprompted_at` when it was unprompted |
| `on_interruption` | A note delivered but not yet spoken is flagged for a rerun |
| `on_pen` | busy: drops a pending unprompted note. still: `pen_still_since = now` |
| `on_board_edit` | Verifies the board reading directly (no deep check, no read-back), then requests a `board` gate call whose result goes straight to `plan` |
| `tick` | Runs, in order: the stall check, gate scheduling, the holding line, delivery, note expiry |

- **Gate scheduling:**
  - one pending reason, with priority frame > board > speech > stall;
  - it runs when a frame or board edit exists, `now − last_gate_at ≥ 5000`, and, for `speech`, the latest frame is fresh or `FRESH_FRAME_WAIT_MS` has passed since the speech. A frame is fresh when it arrived after the pen last went still; with no pen events at all, every frame is fresh;
  - the stall check requests `stall` once per episode (until new ink or speech), when `now − pen_still_since ≥ stall_ms` and `now − user_stopped_at ≥ stall_ms`. A missing `user_stopped_at` counts as long ago; a missing `pen_still_since` counts from the latest frame's arrival;
  - a `GateError` logs, sends `CheckDebug(status="failed")` and nothing else.
- **Checks:**
  - after a gate result, `signals` decide;
  - if not schoolwork, nothing;
  - else, if complete, worth or stuck, ensure a reading for the latest frame: cached by frame id; one check in flight, coalescing to the newest frame; unprompted checks at least `UNPROMPTED_CHECK_INTERVAL_MS` apart.
  - A reading runs: `prepare` (page and marks) → `deepcheck.transcribe` → `snap` → reference resolution (cached per normalized problem and regex: `compile_regex` + `catalog_match`, else `deepcheck.membership` + `resolve_reference`) → `verify`. Then `plan(verdict, reading, signals, problem)` becomes the pending note, replacing an older one.
  - A failed, refused or timed-out transcription gives a `None` reading, so `plan` row 2 speaks only when invited (Review Focus 3).
- **The holding line:** when an invited check (complete) is still running `holding_after_ms` after it started, `may_speak(unprompted=False)` holds, and Ada hasn't spoken since the check started: `channel.say(HOLDING_LINES[lang])` once per check, and `PolicyDebug(action="holding-line")`.
- **Delivery:**
  1. With a pending note, a channel and `may_speak(moment, unprompted=…)`. When the note concerns a paper reading, send `ReadbackEvent(reading, verdict)` (if not sent since the reading changed) and `StageEvent(view="split")`, so the board shows the reading before Ada critiques it (spec §5.3); her pin still wins. Then `append_note(render_note(plan))` and `run_llm()`.
  2. Then wait for Ada's speech.
  3. After an interruption before she spoke, the next open moment calls `run_llm()` again, at most `MAX_RERUNS` times. The note is never appended twice.
  4. A note older than `NOTE_TTL_MS` is dropped, with `PolicyDebug(action="drop")`.
- **Debug and log:** every gate call, check and decision sends a `VisionDebugEvent` on the channel (when attached), and writes a record to `VisionLog`. A gate record holds `stage`, `frame_id`, `reason`, `quiet_ms`, `silence_ms`, `new_ink`, `changed_cells`, `transcript` (`[speaker, text, at_ms]` triples), `probs`, `refused`, `ms` and `provider`, which is what labeling real frames needs (Task 17).
- **Attaching** a channel re-sends the current readback.
- **`explain`:** `plan_request` → a pending invited note → `{"ok": True}`; None → `{"ok": False, "reason": "nothing to show"}` or `"no trusted reference"`.
- **The registry:**
  - creates sessions with `make_gate(settings)` and `make_deepcheck(settings)`, unless they're injected;
  - takes thresholds from `load_thresholds(settings.thresholds_path, gate.name)`;
  - runs one ticker task per session every `TICK_MS`;
  - drops sessions idle for 30 minutes;
  - `title` reads the session row through `sessions_repo.get_for`.
- **`frames/api.py`'s hook** passes the bytes already in memory; it never reads them back from S3.

- [ ] **Step 1: Write the failing tests.** A fake clock; `FakeGate` or a scripted gate; `FixtureDeepCheck` on `dfa-demo` frames, or a scripted deep check with controllable delay; a `RecordingChannel` that records calls in order. Tests drive `tick()` and `idle()`.
  - `test_ink_frame_runs_the_gate_and_a_silent_check`: one gate call, one transcribe, no note (the demo's 26.7 s frame).
  - `test_gate_is_called_at_most_every_5s`.
  - `test_one_check_in_flight_and_the_latest_frame_wins`.
  - `test_unprompted_checks_15s_apart`.
  - **`test_done_waits_for_a_fresh_frame`** (Review Focus 1):
    - the 38.5 s frame, then pen busy and still, then "I think I'm done.";
    - no gate call until the 47.1 s frame arrives; then a counterexample note naming 1010;
    - a variant with no new frame gates on the old one after 6 s.
  - **`test_stall_hint`:** the 26.7 s frame, with the pen still 6 s and no speech. One stall gate call, then a hint note with "after reading 010", delivered with `ReadbackEvent` first.
  - `test_hint_is_dropped_when_she_draws_again` (Review Focus 4).
  - `test_waits_for_her_pause_and_pen` (Review Focus 4): nothing while she speaks; delivery 600 ms after the VAD stop; nothing within 1500 ms of pen stillness.
  - `test_never_over_ada`: a reply in flight or audio playing holds delivery; an empty reply (`ended` with no audio) stops holding it after 1500 ms.
  - `test_holding_line_after_2s_for_an_invited_check`: once; not for an unprompted check; not when Ada spoke since the check began.
  - `test_delivery_order`: `send(Readback)`, `send(Stage split)`, `append_note`, `run_llm`.
  - **`test_barge_in_before_speech_reruns_once`** (Review Focus 2): an interruption before `BotStarted` gives exactly one more `run_llm` at the next pause and no second `append_note`. After `MAX_RERUNS` it stops.
  - `test_spoken_note_climbs_the_ladder`: after `BotStarted`, `snapshot().rung == "counterexample"`; a second failed attempt gives `walkthrough`.
  - `test_unprompted_rate_limit`: a second stall hint within 45 s waits.
  - **`test_page_frame_resets_the_problem`** (Review Focus 5).
  - `test_notes_expire` (Review Focus 4).
  - `test_not_schoolwork_skips_the_check`.
  - `test_failed_check_speaks_only_when_invited` (Review Focus 3): a refusing deep check. A `complete` gate gives the unreadable note; a `worth` gate gives nothing. Each gives `CheckDebug(status="refused")`.
  - `test_reference_resolution_is_cached`: `membership` runs once per problem, and never for the demo regex (catalog).
  - `test_explain`: walkthrough after a wrong verdict gives a note with "Trace:"; solution gives "Solution:"; with nothing to show, `{"ok": False, ...}`.
  - `test_board_edit_skips_the_deep_check`.
  - `test_attach_resends_the_readback`.
  - **API** (P3's `app` fixture):
    - `GET` gives a snapshot after one upload through P3's real `POST …/frames` with a `dfa-demo` frame (the hook fed the registry);
    - another learner gets 404;
    - `POST …/vision/board` gives 202, then 422 for a bad reading, then 413 for a 3 MiB image;
    - the app's lifespan with `VisionSettings(_env_file=None, gate_provider="live")` raises naming `OPENAI_API_KEY`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_orchestrator.py tests/vision/test_registry.py tests/vision/test_vision_api.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement, then regenerate the API types.**
  - Background work runs in tasks the session owns, cancelled by `close()`.
  - Exceptions are logged and never reach the upload route.
  - Run `pnpm gen:api`.
- [ ] **Step 4: Run them and confirm they pass.** Run: `uv run --directory services/server pytest -v && pnpm check:api`. Expected: PASS, then exit 0.
- [ ] **Step 5: Commit.** `git add services/server packages/shared/src/api && git commit -m "feat(vision): per-session orchestrator with etiquette, fresh-frame wait, holding line and the frames hook"`

### Task 14: Vision events in the app: contract, routing, HUD, pen activity and the card on the board

*Converge. Starts once P2 has merged into the integration branch.*

**Files:**
- Modify (P2's contract, additive):
  - `packages/shared/src/voice/messages.ts`: `ServerEvent` gains `ReadbackEvent | VisionDebugEvent`, checked by Task 1's guards; `ClientEvent` gains `PenEvent`;
  - `packages/shared/src/voice/fixtures.json`: one example of each new kind;
  - `services/server/src/tassel/voice/messages.py`: the same three in `SERVER_EVENTS` and `CLIENT_EVENTS`.
- Modify (renderer):
  - `tutor/types.ts`: `TutorEvent` gains `{ type: 'readback'; reading: DfaReading | null; verdict: DfaVerdict | null }` and `{ type: 'vision-debug'; debug: VisionDebug }`; `VoiceControls` gains `reportPen(busy: boolean): void`;
  - `tutor/live/rtvi-map.ts`: `readback` maps to that event, and `vision-debug` likewise;
  - `tutor/live/live-client.ts`: `voice.reportPen(busy)` sends `{ kind: 'pen', busy }` in the `tassel` envelope;
  - `tutor/use-tutor-session.ts`: the two events go to `useVisionStore`;
  - `tutor/create-client.ts`: `SCRIPTS['vision-readback']`;
  - `features/session/Stage.tsx`: the board `Panel` renders `<ReadBackCard reading={…} lang={sessionLang} />` after P5's `BoardPanel` (or P1's placeholder), absolutely positioned 14 px from the left and 202 px from the panel top, below Ada's 176-px tile with a 12-px gap, at `z-10`;
  - `features/session/SessionScreen.tsx`: `usePenActivity(tutor)` and `<VisionHud />`;
  - `packages/shared/src/i18n/{en,es,ko}.json`: the `vision.hud.*` keys.
- Create: `renderer/src/vision/vision-store.ts`, `use-pen-activity.ts`, `VisionHud.tsx`, `board-sink.ts`; `renderer/src/tutor/scripts/vision-readback.json`; `apps/desktop/tests/e2e/vision-readback.spec.ts`
- Test: `packages/shared/tests/voice-messages.test.ts` (extend), `services/server/tests/voice/test_voice_messages.py` (extend), `apps/desktop/tests/unit/vision/{vision-store,pen-activity,vision-hud,stage-readback,board-sink}.test.ts(x)`, `tests/unit/live/rtvi-map.test.ts` (extend), `tests/unit/live/live-client.test.ts` (extend), `tests/e2e/vision-readback.spec.ts`

**Interfaces:**
- Consumes: Task 1's TS contract; Task 11's `ReadBackCard`; Task 13's routes; P2's `parseServerEvent`, `mapRtvi`, `LiveTutorClient` and `useVoiceDebug`; P3's `usePaperStore`; P5's `BoardEditSink`, if merged.
- Produces:

```ts
// vision-store.ts
export const useVisionStore: UseBoundStore<StoreApi<{ reading: DfaReading | null; verdict: DfaVerdict | null;
  gate: VisionDebug | null; check: VisionDebug | null; policy: VisionDebug | null;
  setReadback(r: DfaReading | null, v: DfaVerdict | null): void; pushDebug(d: VisionDebug): void; reset(): void }>>;
// use-pen-activity.ts
export function usePenActivity(client: TutorClient, opts?: { quietAfterMs?: number }): void;   // 400 ms
// VisionHud.tsx: dev only; Ctrl+Shift+V (Cmd+Shift+V on macOS) toggles it
export function VisionHud(): JSX.Element | null;
// board-sink.ts
export function postBoardEdit(api: ApiClient, sessionId: string, edit: { reading: DfaReading; imagePng: Blob | null }): Promise<void>;
```

- **`usePenActivity`:**
  - it subscribes to `usePaperStore`'s `stats.busy`;
  - on a change to busy it calls `client.voice?.reportPen(true)` at once;
  - it sends `false` only after `quietAfterMs` with no busy sample;
  - it never repeats a value, and sends nothing without `voice`;
  - it resets on unmount.
- **`VisionHud`:**
  - shown only when `devTools` is true, read once on mount from `window.tassel.voice.getConfig()` (P2's bridge, which fake-tutor sessions have too); mono 11, on paper with a hairline;
  - stacked under P2's `LatencyHud` at the stage's top-left, overlapping nothing at 1024×680;
  - three lines with `data-testid` `vision-hud-gate` (`GATE · <reason> · c 0.90 w 0.10 s 0.10 n 0.05 · 3 ms · fake`), `vision-hud-check` (`CHECK · wrong · 1010 · q0 on 1 · 12 ms`) and `vision-hud-policy` (`POLICY · speak · counterexample · ok`).
- **`board-sink.ts`:** `postBoardEdit` posts to Task 13's route. If P5 has merged, `board-sink.ts` also exports `visionBoardSink(api, sessionId): BoardEditSink`, which converts P5's automaton (from `beats/automaton.ts`) to a `DfaReading` with `source: 'board'` and zero boxes. P5's live wiring uses it (P5-R13). If P5 hasn't merged, only `postBoardEdit` ships, and P5's converge task installs the sink.
- **`vision-readback.json`** is a P1 fake-tutor script:
  - at 300 ms, stage `split`;
  - at 600 ms, `readback` with Task 1's `demo-wrong` reading and its verdict;
  - at 700 ms, one `vision-debug` per stage;
  - at 900 ms, a tutor caption "Before you move on, try running 1010 through your DFA. Where does it end up?".
- **HUD copy:** `vision.hud.title` "Vision", `vision.hud.gate` "Gate", `vision.hud.check` "Check", `vision.hud.policy` "Policy" (es "Visión", "Filtro", "Revisión", "Política"; ko "비전", "게이트", "검사", "정책").

- [ ] **Step 1: Write the failing tests.**
  - **Contract:** both sides round-trip the new fixtures; `parseServerEvent` refuses a `readback` whose reading lacks `states`.
  - **rtvi-map:** rows for `readback` and `vision-debug`.
  - **live-client:** `reportPen` sends the envelope.
  - **use-tutor-session:** the events reach `useVisionStore`.
  - **pen-activity** (fake timers): busy is sent at once; still is sent after 400 ms, and not if busy returns at 300 ms; no duplicates; nothing without `voice`.
  - **vision-hud:** hidden unless dev; the shortcut toggles it; the lines read as above.
  - **stage-readback:** the card mounts in the board panel only with a reading; at 1024×680 its box doesn't intersect the tile (jsdom geometry stubs, then the E2E checks real boxes).
  - **board-sink:** posts JSON with the reading, and with the image base64-encoded.
  - **E2E `vision-readback.spec.ts`:**
    - `launchApp({ TASSEL_FAKE_SCRIPT: 'vision-readback' })` (P1's fake tutor), then `startPaperSession(page, { type: 'homework', language: 'en', uiLang: 'en' })`;
    - the stage goes split; `readback-card` sits inside the board panel; q0–q3 render with `data-accept` on q3 only; the q0 loop's edge exists; the footnote shows;
    - at 1440×900 and 1024×680 its box doesn't intersect the tile, the captions or the dock;
    - Ctrl/Cmd+Shift+V shows the three HUD lines;
    - a second run with `language: 'ko'` shows "내가 읽은 DFA", and one with `language: 'es'` shows "Así leí tu AFD";
    - `snap('p4-readback-1440')`, `snap('p4-readback-1024-ko')`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/shared test voice-messages && uv run --directory services/server pytest tests/voice/test_voice_messages.py -v && pnpm --filter @tassel/desktop test vision live/rtvi-map live/live-client use-tutor-session && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e vision-readback`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Hold the card and HUD to the session direction contract: iris stays Ada's, used for the card's uncertainty marks.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `pnpm check && pnpm e2e`.
  - Expected: PASS, and every P1, P2, P3 (and P5) spec still passes.
- [ ] **Step 5: Commit.** `git add packages/shared services/server apps/desktop && git commit -m "feat(vision): readback and vision-debug on the voice channel, pen activity, HUD, the card on the board"`

### Task 15: Injection into the voice loop

*Converge.*

**Files:**
- Create: `services/server/src/tassel/vision/bot_hooks.py`, `vision/tools.py`, `vision/prompt.py`, `services/server/src/tassel/voice/fakes/scenarios/dfa-vision.json`
- Modify (P2):
  - `voice/bot.py` (`build_bot`): with `ctx.vision`:
    - append `VISION_PROMPT` to the system prompt;
    - add `EXPLAIN_DFA` to the tools and register its handler;
    - `worker.add_observer(VisionSpeechObserver(ctx.vision))`;
    - attach a `BotChannel` on client ready, and detach in `on_pipeline_finished`;
    - route the `pen` client event to `ctx.vision.on_pen`;
  - `voice/registry.py`: `BotContext` gains `vision: VisionSession | None = None`. The registry takes `vision_registry`, and fills it with `vision_registry.session(learner_id=…, session_id=…, lang=…)`;
  - `app.py`: passes `app.state.vision` to `VoiceRegistry`;
  - `voice/fakes/scenario.py`: `ScriptTool.name` adds `"explain_dfa"`; `ScriptLang` gains `vision: dict[str, str] = {}`;
  - `packages/shared/src/voice/fixtures.json`: `scenario_lines["dfa-vision"]`, the student lines below, so P2's contract test covers the new scenario;
  - `voice/fakes/llm.py`: when the context's last message is a note (`is_note`, role `user` or `developer`) and `parse_note` reads it, stream `script.vision[template_key(n)].format(**template_slots(n))`. With no template, end the response empty.
- Test: `services/server/tests/vision/test_bot_hooks.py`, `tests/voice/test_fake_llm_vision.py`, `tests/vision/test_vision_pipeline.py`

**Interfaces:**
- Consumes: Task 13; P2's `Bot`, `BotContext`, `build_bot`, `ServerEvents`, `FakeLLMService`, `next_turn` and `run_test`; Pipecat 1.12.0's frames ([frames.py][pc-frames]):
  - `LLMMessagesAppendFrame(messages, run_llm=None)`, which sets `interruptible = False` after construction;
  - `LLMRunFrame()`;
  - `TTSSpeakFrame(text, append_to_context=True)`;
  - `VADUserStartedSpeakingFrame`, and `VADUserStoppedSpeakingFrame` (with `stop_secs`);
  - `UserStartedSpeakingFrame` and `UserStoppedSpeakingFrame`;
  - `BotStartedSpeakingFrame` and `BotStoppedSpeakingFrame`, pushed both ways;
  - `LLMFullResponseStartFrame` and `LLMFullResponseEndFrame`;
  - `InterruptionFrame`;
  - `TranscriptionFrame`;
  - `BaseObserver.on_push_frame(FramePushed)`, which sees first pushes only ([base_observer.py][pc-observer]).
- Produces:

```python
class BotChannel:                       # implements Task 13's TutorChannel
    def __init__(self, bot: Bot, lang: Lang)
    async def append_note(self, text: str) -> None   # LLMMessagesAppendFrame([{"role": "developer", "content": text}]), interruptible False
    async def run_llm(self) -> None                  # LLMRunFrame()
    async def say(self, text: str) -> None           # TTSSpeakFrame(text, append_to_context=True)
    async def send(self, event: BaseModel) -> None   # bot.events.send(event)
class VisionSpeechObserver(BaseObserver):
    def __init__(self, session: VisionSession)
EXPLAIN_DFA: FunctionSchema    # level: enum walkthrough|solution, required
VISION_PROMPT: str
async def explain_dfa_handler(params: FunctionCallParams, session: VisionSession) -> None   # result_callback(..., run_llm=False)
```

- **`VisionSpeechObserver`** counts downstream pushes only, once per `frame.id`:
  - VAD start and stop → `on_user_speaking(True)` and `on_user_speaking(False, stopped_ms_ago=int(stop_secs * 1000))`;
  - `BotStarted` and `BotStopped` → `on_bot(speaking=…)`;
  - `LLMFullResponseStartFrame` → `on_bot(reply="started")`, and `LLMFullResponseEndFrame` → `on_bot(reply="ended")`. The session decides when the reply is over (Task 13's table);
  - `InterruptionFrame` → `on_interruption()`;
  - `TranscriptionFrame` → `on_user_text(text, typed=False)`;
  - an `LLMMessagesAppendFrame` from RTVI whose user message isn't a note → `on_user_text(text, typed=True)`.
- **`VISION_PROMPT`** must contain:
  - "Messages that start with [vision] come from your vision system, which watches her paper. They are not from the student";
  - "Never read them out, quote them, or mention the vision system, tags or confidence";
  - "Follow the Escalation line", and one line for each rung's meaning;
  - "When a note says judged, say you think so";
  - "Call explain_dfa with level walkthrough when she says she doesn't understand her DFA's mistake, and with level solution only when she asks for the answer";
  - "Never give the solution unless she asked".
- **The `explain_dfa` handler** awaits `session.explain(level)`, then calls `result_callback(result, properties=FunctionCallResultProperties(run_llm=False))`. The note the session queues does the talking.
- **`dfa-vision.json`** (exact lines; titles as in `dfa-opening`):
  - **en:**
    - `student`: "Hi Ada, I'm working on a DFA for binary strings that start with 010." / "I think I'm done." / "I don't understand, can you show me?" / "I still don't get it, show me the answer.";
    - `turns`:
      1. `when` "start with 010", `say` "Great, draw it on paper and talk me through it. I'll watch.";
      2. `when` "i think i'm done", `say` "Okay, let me take a look.";
      3. `when` "don't understand", `say` "Let's go through it on your paper.", `tools` `[explain_dfa {level: walkthrough}]`;
      4. `when` "show me the answer", `say` "Okay.", `tools` `[explain_dfa {level: solution}]`.
  - **es:**
    - `student`: "Hola Ada, estoy haciendo un AFD para cadenas binarias que empiezan con 010." / "Creo que ya está." / "No lo entiendo, ¿me lo puedes mostrar?" / "Sigo sin entenderlo, muéstrame la respuesta.";
    - `when`: "empiezan con 010", "creo que ya está", "no lo entiendo", "muéstrame la respuesta".
  - **ko:**
    - `student`: "에이다, 010으로 시작하는 이진 문자열 DFA를 만들고 있어요." / "다 했어요." / "잘 모르겠어요, 보여 줄래요?" / "그래도 모르겠어요, 답을 보여 주세요.";
    - `when`: "010으로 시작", "다 했어요", "보여 줄래요", "답을 보여".
  - **`vision` templates** (exact; Korean avoids particles after slots):

| Key | en | es | ko |
|---|---|---|---|
| `counterexample` | Before you move on, try running {witness} through your DFA. Where does it end up? | Antes de seguir, prueba a pasar {witness} por tu AFD. ¿Dónde termina? | 넘어가기 전에, {witness} 입력을 DFA로 따라가 볼래요? 어디에서 끝나요? |
| `hint.missing_transition` | What should happen once you've already read {prefix}? | ¿Qué debería pasar cuando ya has leído {prefix}? | {prefix}까지 읽은 다음에는 어떻게 돼야 할까요? |
| `hint.missing_transition_start` | What should your DFA do with {symbol} at the very start? | ¿Qué debería hacer tu AFD con {symbol} al principio? | 맨 처음에 {symbol} 입력이 오면 DFA가 어떻게 해야 할까요? |
| `hint.transition` | Look again at what {state} does when it reads {symbol}. | Mira otra vez qué hace {state} cuando lee {symbol}. | {state}에서 {symbol} 입력을 읽으면 어디로 가는지 다시 볼래요? |
| `hint.accept_flag` | Should {state} be an accepting state? | ¿{state} debería ser un estado de aceptación? | {state} 상태는 수락 상태여야 할까요? |
| `hint.slip` | Can a DFA have two arrows for the same symbol leaving one state? | ¿Puede un AFD tener dos flechas con el mismo símbolo saliendo de un estado? | DFA에서 한 상태에서 같은 기호로 화살표가 두 개 나갈 수 있을까요? |
| `guiding_question` | Which state are you in after reading {prefix}? | ¿En qué estado estás después de leer {prefix}? | {prefix}까지 읽고 나면 어느 상태에 있어요? |
| `walkthrough.false_accept` | Let's run {witness} on your paper: {trace}. It ends in {end}, which accepts, but {witness} should be rejected. | Vamos a pasar {witness} por tu papel: {trace}. Termina en {end}, que acepta, pero {witness} debería rechazarse. | {witness} 입력을 종이에서 같이 따라가 볼게요: {trace}. {end}에서 끝나서 받아들여지지만, 이 입력은 거부돼야 해요. |
| `walkthrough.false_reject` | Let's run {witness} on your paper: {trace}. It ends in {end}, which rejects, but {witness} should be accepted. | Vamos a pasar {witness} por tu papel: {trace}. Termina en {end}, que rechaza, pero {witness} debería aceptarse. | {witness} 입력을 종이에서 같이 따라가 볼게요: {trace}. {end}에서 끝나서 거부되지만, 이 입력은 받아들여져야 해요. |
| `solution` | Here's a DFA that works: {solution}. | Aquí tienes un AFD que funciona: {solution}. | 이렇게 하면 돼요: {solution}. |
| `correct` | That works. Can you tell me why? | Funciona. ¿Me explicas por qué? | 잘 됐어요. 왜 그런지 설명해 줄래요? |
| `unreadable` | I can't quite read your DFA. Could you hold the page still for a moment? | No consigo leer bien tu AFD. ¿Puedes dejar la hoja quieta un momento? | DFA가 잘 안 보여요. 종이를 잠깐 가만히 둘래요? |
| `unknown` | Which strings should your DFA accept? | ¿Qué cadenas debería aceptar tu AFD? | DFA가 어떤 문자열을 받아들여야 해요? |

  The greeting, `after_switch` and `fallback` come from `dfa-opening`.

- [ ] **Step 1: Write the failing tests.**
  - **`test_bot_channel_appends_then_runs`:** the worker's queued frames are an `LLMMessagesAppendFrame` (role `developer`, `interruptible is False`, `run_llm` None), then an `LLMRunFrame`. `say` queues `TTSSpeakFrame` with `append_to_context=True`.
  - **`test_observer_maps_frames`:**
    - each frame above, pushed downstream, calls the session method;
    - upstream copies and repeated ids are ignored;
    - a note in an `LLMMessagesAppendFrame` isn't user text;
    - `LLMFullResponseStartFrame` and `LLMFullResponseEndFrame` report `reply="started"` and `reply="ended"`.
  - `test_prompt_keeps_p2s_rules_and_adds_the_vision_rules`.
  - `test_explain_tool_is_registered_and_never_reruns_the_llm`.
  - `test_pen_client_message_reaches_the_session`.
  - **`test_fake_llm_vision`:**
    - a context ending in Task 5's demo counterexample note streams exactly "Before you move on, try running 1010 through your DFA. Where does it end up?";
    - es and ko give their rows;
    - the stall note gives "What should happen once you've already read 010?";
    - the walkthrough note fills `{trace}` with "q0, q0, q1, q2, q3" and `{end}` with q3;
    - an unknown note streams nothing;
    - a user line still follows P2's turns.
  - `test_dfa_vision_scenario`: loads in three languages; its `student` lines hit turns 1–4 in order; turns 3 and 4 call `explain_dfa`.
  - **`test_vision_pipeline`** (P2's `build_bot` harness with fakes, a real `VisionSession` with `FakeGate` and `FixtureDeepCheck`, and a fake clock):
    1. `client-ready`, then the first student line by `send-text`;
    2. `session.on_frame` with the `dfa-demo` 47.1 s frame, then "I think I'm done." by `send-text`, then ticks;
    3. the output has "Okay, let me take a look.", then a `readback` server message whose reading has q0–q3, then the counterexample text;
    4. "I don't understand, can you show me?" brings the walkthrough text, and the context holds exactly one copy of each note.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_bot_hooks.py tests/voice/test_fake_llm_vision.py tests/vision/test_vision_pipeline.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Re-check `may_speak` in the same coroutine that queues the frames: observers run asynchronously, so a stale check could inject mid-turn.
- [ ] **Step 4: Run them and confirm they pass.** Run: `uv run --directory services/server pytest -v`. Expected: PASS, with P2's voice tests unchanged.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(vision): barge-in-safe notes, holding line, speech observer and explain_dfa in the voice loop"`

### Task 16: The demo on fakes, end to end

*Converge.*

**Files:**
- Modify (P3):
  - `packages/paper-synth/src/variants.ts` (and its `VariantName` union): the variant `dfa-demo-hold` (P4-R19);
  - `apps/desktop/tests/e2e/global-setup.ts`: generate `dfa-demo-hold` into `.cache/paper-clips` and set `process.env.TASSEL_E2E_CLIP_DFA_DEMO_HOLD`. The server's env (through P2's `e2eServerEnv`) gains `TASSEL_GATE_PROVIDER=fake`, `TASSEL_DEEPCHECK_PROVIDER=fake`, `TASSEL_FAKE_TRUTH=<its .truth.json>` and `TASSEL_VISION_LOG=<apps/desktop/test-results/vision-log.jsonl>`, and loses `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and `VULTR_INFERENCE_API_KEY`;
  - `apps/desktop/tests/e2e/fixtures.ts`: `launchVision` and `visionSnapshot`;
  - `scripts/dev.mjs`: unless set, `TASSEL_FAKE_CLIP` becomes the `dfa-demo-hold` clip (generated if missing), the server gets `TASSEL_FAKE_TRUTH`, and `TASSEL_FAKE_SCRIPT` becomes `dfa-vision`.
- Create: `apps/desktop/tests/unit/paper/detector/dfa-demo-hold.test.ts`, `apps/desktop/tests/e2e/vision-demo.spec.ts`, `apps/desktop/tests/e2e/vision-languages.spec.ts`
- Test: those, plus `packages/paper-synth/tests/truth.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 13–15; P3's harness, `startPaperSession`, `launchApp`, paper-synth; P2's `launchVoice`, `DevConsole` and `e2eServerEnv`.
- Produces:

```ts
export function launchVision(opts?: { lang?: Lang; uiLang?: Lang }): Promise<{ app: ElectronApplication; page: Page }>;
  // launchVoice({ mic: 'silence', env: { TASSEL_FAKE_CLIP: process.env.TASSEL_E2E_CLIP_DFA_DEMO_HOLD,
  //   TASSEL_FAKE_SCRIPT: 'dfa-vision', TASSEL_PAPER_DEBUG: '1', TASSEL_UI_LANG: uiLang ?? lang ?? 'en' } })
export function visionSnapshot(page: Page, sessionId: string): Promise<VisionSnapshot>;
```

- **`dfa-demo-hold`** (times in seconds; the strokes as in `dfa-demo`):
  - blank to 6.0; start arrow 6.0–7.0; q0 7.2–9.2; edge `0` 9.6–11.2; q1 11.6–13.6; edge `1` 14.0–15.6; q2 16.0–18.0; edge `0` 18.4–20.0; q3 (double) 20.4–23.2;
  - retract to 23.7, then **still to 40.0**;
  - loop `0,1` on q3 40.0–43.0 (the hand enters at 39.6), retract to 43.5, still to 50.0;
  - loop `1` on q0 50.0–52.6 (the hand enters at 49.6), retract to 53.1, still to **120.0**.
  - Expected triggers: ink at 26.7, 46.5 and 56.1, each ±0.7 s.
  - The truth's DFA equals `dfa-demo`'s.
- **The demo run** (clip time `t`; `t0` is when `paper-video` first has `videoWidth > 0`):

| Clip time | What happens | The spec asserts |
|---|---|---|
| ~1 | The dev console types the first student line | Ada's turn 1 caption; the title "Strings that start with 010" |
| 26.7 | First trigger: a silent check (wrong, incomplete) | the snapshot's `frames_seen ≥ 1` and `verdict.status == "wrong"`; no Ada caption between `t0+20` and `t0+29` |
| ~31.8 | Stall: the gate (stuck), then the hint | by `t0+40`: the caption "What should happen once you've already read 010?"; the stage is split; `readback-card` shows q0–q3 and no loops |
| 46.5 | Loop q3: a silent check (correct) | no new Ada caption by `t0+52` |
| 54.0 | Typed: "I think I'm done." (before the last trigger: Review Focus 1) | "Okay, let me take a look." |
| 56.1 | Fresh frame: gate (complete), then check, then the note | by `t0+66`: "Before you move on, try running 1010 through your DFA. Where does it end up?"; the card adds the q0 loop labelled `1`; the snapshot has `counterexample.input == "1010"`, `blame.state == "q0"` and `rung == "counterexample"` |
| after that caption ends | Typed: "I don't understand, can you show me?" | a caption starting "Let's run 1010 on your paper: q0, q0, q1, q2, q3." |
| after that one | Typed: "I still don't get it, show me the answer." | a caption starting "Here's a DFA that works: q0 -0-> q1"; the snapshot's rung is `solution` |

- [ ] **Step 1: Write the failing tests.**
  - `dfa-demo-hold.test.ts`: through P3's detector harness, exactly three ink triggers, at 26.7, 46.5 and 56.1 ± 0.7 s.
  - `truth.test.ts`: `dfa-demo-hold`'s truth DFA equals `dfa-demo`'s.
  - **`vision-demo.spec.ts`** (en, timeout 150 s):
    - `launchVision()`, then `startPaperSession(page, { type: 'homework', language: 'en', uiLang: 'en' })`, then the table above;
    - the HUD (Ctrl/Cmd+Shift+V) shows `vision-hud-policy` reading `speak · counterexample`;
    - at 1024×680 the card, tile, captions and dock don't intersect;
    - `snap('p4-hint')`, `snap('p4-counterexample-readback')`, `snap('p4-walkthrough')`, `snap('p4-1024')`.
  - **`vision-languages.spec.ts`** (es, then ko; 120 s each):
    - the same run in each language, through the counterexample: the hint and counterexample captions are that language's template rows, with `lang` set;
    - the card's title is "Así leí tu AFD" or "내가 읽은 DFA";
    - `snap('p4-counterexample-es')`, `snap('p4-counterexample-ko')`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test paper/detector/dfa-demo-hold && pnpm --filter @tassel/paper-synth test && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e vision-`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** A failure in a spec is a bug in Tasks 5–15: fix it test-first in the owning module, and keep the spec.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `docker compose up -d db s3 && pnpm test && pnpm e2e`.
  - Expected: PASS: every P1–P3 (and P5) spec, and the six P4 screenshots in `apps/desktop/test-results/screens/`.
- [ ] **Step 5: Exercise it by hand.** Run `pnpm dev` (its defaults are now the held clip and `dfa-vision`) and type the four lines in the dev console. Watch the hint, the read-back, the counterexample, the walkthrough and the solution, with the HUD on. Write in the task report what you saw, and anything that felt rude or slow.
- [ ] **Step 6: Commit.** `git add packages/paper-synth apps/desktop scripts/dev.mjs && git commit -m "test(e2e): the demo's hint, read-back and counterexample on fakes in en, es and ko"`

### Task 17: Live checks, the reading evaluation and docs

*Converge.*

**Files:**
- Create: `services/server/src/tassel/vision/smoke.py`, `vision/read_eval.py`, `scripts/vision-live-check.mjs`
- Modify:
  - `vision/gate_eval.py` (Task 12's `export`): with `--log <TASSEL_VISION_LOG file>`, each exported frame takes `reason`, `quiet_ms`, `silence_ms`, `new_ink`, `changed_cells` and `transcript` from the gate record with its `frame_id` (Task 13's format). Test: `test_export_joins_the_vision_log` in `tests/vision/test_eval_gate.py`;
  - `services/server/.env.example` (P2's file): `OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `VULTR_INFERENCE_API_KEY=`, and comments for `TASSEL_GATE_PROVIDER`, `TASSEL_GATE_LIVE`, `TASSEL_DEEPCHECK_PROVIDER` and `TASSEL_DEEPCHECK_EFFORT`;
  - root `package.json`: `vision:live-check` = `node scripts/vision-live-check.mjs`;
  - `README.md` (a "Vision brain" section) and `CLAUDE.md` (the vision rules).
- Test: `services/server/tests/vision/test_smoke.py`, `tests/vision/test_read_eval.py`

**Interfaces:**
- Produces:
  - `python -m tassel.vision.smoke [--preflight] [--only gate-openai,gate-clef,deepcheck]`. It prints one line per check, and exits 0 when each check passes or is skipped for a missing key.
  - `python -m tassel.vision.read_eval --deepcheck fake|live [--clips .cache/paper-clips] [--real <dir>] [--strict]`. For each trigger frame of `dfa-demo` (26.7, 38.5 and 47.1 s, with and without noise) it prints:
    - state F1, where a match is the same label within 0.3 r;
    - transition F1, matching (source, target, symbol set);
    - start and accept exactness;
    - verdict agreement: the status and counterexample of the reading's verdict against the truth DFA's, both against `starts-with-010`.

    `--strict` exits 1 below P4-R18's thresholds.

| Check | What it does | Pass |
|---|---|---|
| `gate-openai` | `OpenAIDecisionsGate` on three synthetic moments (stall, done, narration) | each answers four predicates or a refusal; prints the probabilities and ms; saves the raw body as `tests/vision/fixtures/openai-decision.recorded.json` |
| `gate-clef` | `ClefGate` on the same | four `noul` numbers; saves `clef-systemone.recorded.json` |
| `deepcheck` | `OpusDeepCheck` on the 47.1 s frame, then snap and verify | the verdict is `wrong` with witness `1010` and blame q0; prints the latency and token usage; saves `opus-transcription.recorded.json` |

- **`vision-live-check.mjs`** (cross-platform, `cross-spawn`) stops at the first failure:
  1. `smoke --preflight`;
  2. `smoke`;
  3. `read_eval --deepcheck live --strict`;
  4. `gate_eval --gates openai,clef`, whose table it prints.

- [ ] **Step 1: Write the failing tests** (no keys, no network).
  - `every check is skipped without its key`: exit 0, with `skipped: OPENAI_API_KEY not set`.
  - `preflight lists every missing key`.
  - `read_eval on the fake scores 1.0`: the fixture deep check against its own truth, as a harness check.
  - `strict fails below the thresholds`: a stub reader.
  - `test_export_joins_the_vision_log`: a two-line log and two stored frames give two moments with their transcripts and activity; a frame with no gate record keeps an empty transcript.
- [ ] **Step 2: Run them and confirm they fail.** Run: `uv run --directory services/server pytest tests/vision/test_smoke.py tests/vision/test_read_eval.py tests/vision/test_eval_gate.py -v`. Expected: FAIL for the new tests.
- [ ] **Step 3: Implement, then write the docs.**
  - **README:**
    - the three keys go in `services/server/.env`, and `TASSEL_PROVIDERS=auto` turns each provider live as its key appears;
    - `pnpm vision:live-check`;
    - the HUD shortcut, the vision log, `TASSEL_VISION_STALL_MS`;
    - how to record and label real frames: run a session with `TASSEL_VISION_LOG` set, then `gate_eval export --session <id> --out .cache/gate-eval/real/<name> --log <that file>`;
    - that live vision sends real frames to the providers (P4-R20).
  - **`CLAUDE.md`:** `pnpm e2e` never reaches a live provider; real frames never leave `.cache/` and are never committed or posted; keys never go in the app.
- [ ] **Step 4: Run them and confirm they pass.** Run: `uv run --directory services/server pytest -v && pnpm check && pnpm test && pnpm e2e`. Expected: PASS, with no live call.
- [ ] **Step 5: Commit, then push.** `git add services/server scripts package.json README.md CLAUDE.md && git commit -m "feat(vision): live smoke checks, reading evaluation, one-command live check and docs"`, then `git push -u origin claude/p4-automata-vision`.

**When the keys arrive** (owner or agent):
1. Add `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and `VULTR_INFERENCE_API_KEY` to `services/server/.env`, and keep `TASSEL_PROVIDERS=auto`.
2. Run `pnpm vision:live-check`.
   - Expected: every step passes.
   - A failed smoke check names its provider. A reading below the P4-R18 thresholds becomes a tuning task, for Task 7's constants or the prompt.
3. Commit the `.recorded.json` fixtures with a test run that parses them (`uv run --directory services/server pytest tests/vision -v`).
4. Record the gate table in the P4 ledger. Set `TASSEL_GATE_LIVE` to the winner (P4-R3), and run `gate_eval --write-thresholds`.

---

## P4 milestone (R30)

Once Task 17 is committed:
- **App QA:** the app tester runs every `vision-*` spec plus exploratory sessions on fakes:
  - en, es and ko, at 1440×900 and 1024×680, keyboard alone;
  - barging in on Ada's hint, saying "done" mid-stroke, flipping to a new page, typing quickly;
  - reviewing the `p4-*` screenshots.
- **Design pass:** the design reviewer checks the read-back card (over P5's board if it has merged), the HUD, and the stage's split timing against the direction contract. One round of fixes, each with its regression test.
- **Owner at the Mac:**
  - `pnpm dev` on fakes: watch the whole demo flow.
  - With keys, a real Desk View session on the demo worksheet, in each language:
    - the real circles snap (Task 7's constants);
    - the read-back matches her drawing;
    - Ada's timing feels like a tutor's, not an alarm's.
  - Record 20 or more real frames and label them (`gate_eval export`); rerun Task 17's evaluations with `--real`.
- **Post the milestone screenshots** (synthetic clip only) and the evaluation tables to the team's Discord.

---

## Sources

Read on 2026-10-17 by the planner and three research helpers. Pipecat paths are at tag `v1.12.0`.

[oa-guide]: https://developers.openai.com/api/docs/guides/decisions
[oa-ref]: https://developers.openai.com/api/reference/resources/decisions/methods/create
[oa-python]: https://developers.openai.com/api/reference/python/resources/decisions/methods/create
[oa-changelog]: https://developers.openai.com/api/docs/changelog
[oa-forum]: https://community.openai.com/t/decisions-api-is-now-available-in-public-beta/1403877
[oa-refusal]: https://community.openai.com/t/unexpected-refusal-in-gpt-6-luna-decisions-api-during-content-classification/1406979
[vu-ref]: https://api.vultrinference.com/docs/reference/create-systemone
[vu-openapi]: https://api.vultrinference.com/docs/openapi.json
[vu-errors]: https://api.vultrinference.com/docs/concepts/errors
[vu-models]: https://api.vultrinference.com/v1/models
[cf-clef]: https://huggingface.co/Cloudflare/clef-flash
[cl-vision]: https://platform.claude.com/docs/en/build-with-claude/vision
[cl-coords]: https://platform.claude.com/docs/en/build-with-claude/vision-coordinates
[cl-so]: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
[cl-fallback]: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
[cl-models]: https://platform.claude.com/docs/en/about-claude/models/overview
[an-sdk]: https://github.com/anthropics/anthropic-sdk-python
[al-dfa]: https://github.com/caleb531/automata/blob/v9.2.0/automata/fa/dfa.py
[al-parser]: https://github.com/caleb531/automata/blob/v9.2.0/automata/regex/parser.py
[al-regex]: https://caleb531.github.io/automata/api/regular-expressions/
[al-exc]: https://github.com/caleb531/automata/blob/v9.2.0/automata/base/exceptions.py
[cv-hough]: https://docs.opencv.org/4.x/dd/d1a/group__imgproc__feature.html
[pc-frames]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/frames/frames.py
[pc-frame-processor]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frame_processor.py
[pc-frame-queue]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/utils/frame_queue.py
[pc-observer]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/observers/base_observer.py
[pc-openrouter]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/openrouter/llm.py
[pc-oa-adapter]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/adapters/services/open_ai_adapter.py
[pc-rtvi-obs]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frameworks/rtvi/observer.py
[pc-changelog]: https://github.com/pipecat-ai/pipecat/blob/v1.12.0/CHANGELOG.md
