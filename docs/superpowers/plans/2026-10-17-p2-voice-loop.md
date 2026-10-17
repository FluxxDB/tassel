# P2 Voice Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The student talks with Ada in real time. A per-session Pipecat bot on the server, reached over WebRTC from the app, runs on fake providers with no keys and switches each provider to live (Deepgram, OpenRouter→Cerebras, ElevenLabs) as its key appears. It brings barge-in with backchannel filtering, AI titles, device pickers, presenter mode, push-to-talk, and latency measured against the spec's budgets.

**Architecture:**
- **Server (`services/server/src/tassel/voice`):** one Pipecat 1.12.0 `PipelineWorker` per live session, behind the SmallWebRTC transport. The pipeline runs:
  1. STT: Flux for en/es, Nova-3 for ko, or a scripted fake;
  2. a session-activity processor (titles, last activity);
  3. the user aggregator, with Tassel's turn strategies;
  4. the LLM: Qwen3.8 on Cerebras through OpenRouter, or a scripted fake;
  5. TTS: ElevenLabs Flash v2.5, or a tone/`say` fake;
  6. the transport.

  RTVI, which the worker adds itself, carries events; Tassel's own events ride inside RTVI server messages. FastAPI routes on the existing app do the offer/answer with the device token. A registry keeps one bot per learner and remembers the conversation across reconnects.
- **Client (`apps/desktop/src/renderer/src/tutor/live`, `features/voice`):** `LiveTutorClient` implements P1's `TutorClient` on `@pipecat-ai/client-js` and `@pipecat-ai/small-webrtc-transport`, with Tassel's own media manager over two objects:
  - a `Mic`: a Web Audio graph for device switching, mute, the push-to-talk gate and the level meter;
  - a `Speaker`: primary sink, presenter sink, ducking and level.

  A latency meter measures what she actually hears. A HUD and a developer console make it testable without keys.
- **Contract:** `packages/shared/src/voice` holds the event types, budgets, endpoints and JSON fixtures that both sides test against. `TutorEvent` gains additive variants.

**Tech Stack:**
- **Server:** `pipecat-ai[webrtc,deepgram]==1.12.0` ([pyproject][pc-pyproject], [PyPI, 2026-09-26, Python ≥ 3.11][pc-pypi]). It pulls in aiortc 1.15.0 and onnxruntime 1.24.x (wheels for macOS 14+ arm64, Windows x64 and Linux on Python 3.12). Add `httpx>=0.28` for the titler.
- **Client:** `@pipecat-ai/client-js` `1.14.0` ([npm][npm-cj], [d.ts][cj-dts]) and `@pipecat-ai/small-webrtc-transport` `1.11.0` (peer `client-js ~1.14.0`, dependency `@daily-co/daily-js ^0.94.0`; [npm][npm-swt], [source][swt-src]). UI primitives: `@radix-ui/react-popover` `1.3.1`, `@radix-ui/react-select` `2.4.1`, `@radix-ui/react-switch` `1.4.1` ([npm][npm-radix]).
- **Unchanged from P1:** Electron exactly 44.9.0 (Chromium 152.0.7977.167, [release][el-releases]), React 19, Zustand 5, Vitest, Playwright `_electron`, FastAPI, SQLAlchemy 2, pytest.

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md`, especially:
- §2 (budgets), §4.1 (audio devices and presenter mode), §4.2 (voice loop), §5.1 (titles);
- §5.5 (persona and voice), §5.9 (languages), §6 (session states and shortcuts), §7 (fakes and tests), §10 (keys).

Also read `PRODUCT.md`, the roadmap, the P1 plan (Task 14's `TutorClient` contract), and `docs/research/07-p2-provider-verification.md` (the provider facts this plan relies on), `01-voice-loop-and-models.md` and `00-flagged-items.md`.

## Global Constraints

**Carried from P1, unchanged**
- **Electron:** exactly `44.9.0`. `contextIsolation`, `sandbox` and no Node in renderers; `window.tassel` is the only IPC surface; the origins are `app://tassel` and `http://localhost:5173`.
- **Cross-platform:** every script runs on macOS and Windows, and Node scripts use `cross-spawn`.
- **UI:** every UI string goes through i18next in en, es and ko (`pnpm check:i18n`), and the design tokens and styling rules apply.
- **Ports:** 8787 for dev and 8799 for E2E (`TASSEL_E2E_PORT`); the E2E database is `tassel_e2e`.
- **Commits:** the trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Keys and providers**
- **Keys live only in `services/server/.env`,** which is git-ignored by `.env`: `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, and the voice ids `TASSEL_VOICE_EN`, `TASSEL_VOICE_ES` and `TASSEL_VOICE_KO`. They never appear in the app, in `requestData`, in client messages or in logs.
- **Provider mode:** `TASSEL_PROVIDERS=fake|live|auto` (default `fake`), with per-provider overrides `TASSEL_STT_PROVIDER`, `TASSEL_LLM_PROVIDER`, `TASSEL_TTS_PROVIDER` and `TASSEL_TITLES_PROVIDER`.
  - `auto` is live exactly when that provider's key is set.
  - `live` without its key fails at startup with `"<VAR>=live needs <KEY> in services/server/.env"`.
- **No keys needed:** unit, server and E2E tests all run on fakes. Live checks run only once keys exist (Task 20).

**Budgets** (spec §2)
- First tutor audio, after she stops talking: ≤ 1200 ms in en and es, ≤ 1400 ms in ko.
- On barge-in, Ada yields within ~300 ms (P2-R5).

**Voice route per session language** (P2-R2)

| Language | STT | Turn end | TTS language | Budget |
|---|---|---|---|---|
| en | Flux `flux-general-multi`, `language_hints=[en]` | Flux EndOfTurn | `en` | 1200 ms |
| es | Flux `flux-general-multi`, `language_hints=[es]` | Flux EndOfTurn | `es` | 1200 ms |
| ko | Nova-3 `nova-3-general`, `language=ko`, interim results on | Silero VAD (stop 0.2 s) + Smart Turn v3.2 | `ko` | 1400 ms |

Silero VAD (`confidence 0.7, start_secs 0.2, stop_secs 0.2, min_volume 0.6`) runs on every route. On Flux routes it only feeds ducking and metrics ([07][res07]).

**LLM and TTS**
- **Live LLM:** `qwen/qwen3.8-27b` on OpenRouter ([model][or-model], [routing][or-routing]).
  - Every call sends `provider = {"only": ["cerebras"], "allow_fallbacks": false, "require_parameters": true}` and `reasoning = {"effort": "none"}`.
  - `max_tokens` is 400 for replies and 128 for titles; Cerebras caps output at 32,768.
  - No `response_format`: Cerebras rejects it.
- **Live TTS:** ElevenLabs `eleven_flash_v2_5`, with `language` pinned to the session language ([models][el-models]). Text normalization is off, so the prompt makes Ada spell out symbols.
- **Titles:** at most 6 words, plus a subject of at most 3 words, in the session language (P2-R4).
  - They are written on the server with `title_source = 'ai'`, and never over a title the student set.
  - Clamp the title to 80 characters and the subject to 40, the P1 API's limits.

**Client audio**
- **Capture:** mono, with `echoCancellation`, `noiseSuppression` and `autoGainControl` on. Only the E2E fake mic turns them off, because Chromium distorts a fake file otherwise ([media_switches.cc][cr-switches]).
- **Presenter mode:** one `<audio>` element on the primary output, plus one `AudioContext({ sinkId })` on the second output (P2-R6).
- **Push-to-talk:** hold Space. It ignores Space with modifiers, on key repeat, and while typing in an editable field. It releases on window blur and when the document hides.
- **Shortcuts:** M, B and C work as in P1. Space acts only while push-to-talk is on. Ctrl+Shift+L (Cmd+Shift+L on macOS) toggles the latency HUD in unpackaged builds.

**E2E**
- **It drives the built app.** For the microphone, `TASSEL_FAKE_MIC=<absolute .wav>` makes main append `use-fake-device-for-media-stream` and `use-file-for-fake-audio-capture=<wav>%noloop`, never in a packaged app.
- **Fixture WAVs** are 16-bit PCM, mono, 16 kHz, and end with at least 1 s of silence: after a `%noloop` file ends, Chromium's file source returns no frames and the fake input stream resends its last buffer ([fake_audio_input_stream.cc][cr-fake-input], [simple_sources.cc][cr-file-source]).
- **Server:** the E2E server runs `TASSEL_PROVIDERS=${TASSEL_E2E_PROVIDERS:-fake}` with `TASSEL_FAKE_TTS=tone`.
- **Typed student lines** go in through the developer console (P2-R9).

**Dependencies**
- **pnpm's release-age gate:** pnpm 12 hides versions younger than 1440 minutes. In its default non-strict mode it still installs an exact pin, and writes it into `minimumReleaseAgeExclude` ([pnpm][pnpm-age]).
  - Keep any entries this adds (`@pipecat-ai/client-js@1.14.0`, `@pipecat-ai/small-webrtc-transport@1.11.0`, `@daily-co/daily-js@0.94.0`), with a comment like the electron one.
  - Remove them once those versions are a day old, after 2026-10-18 UTC.
- **No `local-smart-turn` extra:** it pulls torch, transformers and coremltools, which has no Windows wheel. Smart Turn v3.2 runs on the core `onnxruntime` and needs no extra ([pyproject][pc-pyproject]).

**Git:** the integration branch `claude/p2-voice-loop` is cut from `claude/p1-foundation` once P1 is complete. Team branches are listed under "Parallel tracks". Push only `claude/*` branches.

## Review Focus

1. **A saved microphone or speaker gets unplugged**, at launch or mid-session.
   - Expected: the app falls back to the system default, says so in the audio panel, and the session carries on.
   - Tests: Task 14 (`resolveDevice`), Task 11 (the open mic vanishes, so the default reopens and `device-lost` fires), Task 12 (`setSinkId` fails, so the default plays).
2. **Space is held when the window loses focus** (Cmd-Tab, a system dialog) or auto-repeats.
   - Expected: push-to-talk releases on blur and when the window hides, and repeats are ignored. Space in a text field types a space, and Space never clicks a focused button while push-to-talk is on.
   - Tests: Task 14.
3. **Microphone permission is denied**, in macOS or Windows privacy settings.
   - Expected: the session still connects, Ada still speaks, typed lines still work, and a notice offers "Open settings".
   - Tests:
     - Task 11: a denied mic resolves and the connection proceeds;
     - Task 13: the `mic denied` event;
     - Task 16: the settings links and `TASSEL_FAKE_MIC_ACCESS=denied`;
     - Task 18: the notice;
     - Task 19: E2E.
4. **The bot dies, or the learner connects twice** (a crash, a server restart, a second window).
   - Expected on the client: it shows Reconnecting, retries 3 times with backoff, then offers Retry.
   - Expected on the server: one bot per learner. A stale restart offer gets a 409, and the conversation resumes without a second greeting.
   - Tests: Task 8 (registry), Task 13 (backoff), Task 7 (resume), Task 19 (E2E `/drop`).
5. **The student renames the session while the AI title is in flight**, or the model returns a long, quoted or punctuated title.
   - Expected: the AI never overwrites her title. Titles clamp to 6 words and 80 characters, subjects to 3 words and 40, in Spanish and Korean too.
   - Tests: Task 9.

## Rulings (spec conflicts and gaps)

The owner pre-authorized self-approval of plans, so these stand unless the owner overrides them. Each gives the ruling, why, and the cost if it's wrong.

- **P2-R1. Pin Pipecat 1.12.0, not the spec's 1.6.x (§4.2).**
  - Why: 1.12.0 is current (2026-09-26).
    - `PipelineTask`/`PipelineRunner` became `PipelineWorker`/`WorkerRunner` in 1.3.0.
    - Flux turn signalling changed in 1.8.
    - Flux stopped emitting interim transcription frames in 1.9 ([CHANGELOG][pc-changelog]).
  - Cost if wrong: a re-pin and some import changes.
- **P2-R2. English and Spanish on Flux, Korean on Nova-3.**
  - en/es use Flux `flux-general-multi` with one language hint, and Flux alone ends turns: no Smart Turn on top, which would take turns away from Flux.
  - ko uses Nova-3 `ko` with Silero VAD and Smart Turn v3.2.
  - Why: Flux Multilingual has no Korean ([07][res07]).
  - Cost if wrong: one route table.
- **P2-R3. Tassel writes its own media manager.**
  - Why: the default `DailyMediaManager` downloads Daily's call-machine bundle and runs it with `Function()`, which the `app://` CSP (no `unsafe-eval`) blocks, and it fails offline.
  - `MediaManager` isn't exported by any public package, so Tassel implements its 1.11.0 shape and casts it, as the transport's own test helper does ([mediaManager.ts][mm-src], [fakeMediaManager.ts][fake-mm]).
  - The mic runs through a Web Audio graph, so device switches and push-to-talk never need `replaceTrack`, which the transport only does for Daily's manager.
  - Cost if wrong: one adapter file.
- **P2-R4. Titles are written on the server with a forced tool call, and `title_source = 'ai'`.**
  - This replaces P1 ruling R16's client PATCH, which recorded `student`.
  - The tool is `set_session_title`: Cerebras rejects `response_format` and `structured_outputs` ([07][res07]). If OpenRouter refuses the named `tool_choice`, the titler retries once with `"required"`.
  - Spec §4.3 lists titles under Vultr Serverless Inference, while §4.2 and §5.1 say "fast model". P2 uses OpenRouter→Cerebras behind a `Titler` interface; P10 may add a Vultr titler.
  - Cost if wrong: one implementation behind `Titler`.
- **P2-R5. The barge-in budget, with a backchannel filter.** Spec §2 ("silent within ~300 ms") and §4.2 (a minimum-words filter) pull against each other: words arrive about 250 ms after speech starts ([Flux state machine][dg-flux-state]).
  - Ruling: Ada yields (ducks to 25%) within ~300 ms of speech onset, on server VAD. She falls silent once the filter confirms a real interruption; the target is ≤ 600 ms.
  - The "Instant" sensitivity skips the filter, for ≤ 300 ms silence.
  - The filter uses a per-language backchannel lexicon, not a word count alone, because Korean "잠깐만요" ("wait") is one word.
  - Cost if wrong: one threshold table.
- **P2-R6. Presenter mode uses one `<audio>` element plus one `AudioContext({ sinkId })`.**
  - Why: Chromium shares one WebRTC audio renderer per page, so with two elements the last `setSinkId` wins ([07][res07]).
  - The element stays attached because remote WebRTC audio is silent in Web Audio unless a media element plays it ([crbug 40094084, open][crbug-webaudio]).
  - Turning presenter mode on also turns on push-to-talk and "Fewer" interruptions, because room speakers are likely outside the echo canceller's reference (UNVERIFIED).
  - Cost if wrong: a default.
- **P2-R7. Switching language restarts the voice loop.** Spec §5.9 lets her switch with the language pill or with `set_language`.
  - The client reconnects (about 1 s), and the server builds the new route and replays the remembered conversation with a switch note.
  - A seamless `ServiceSwitcher` swap waits for a live test of the Flux→Nova-3 path, which 07 flags as UNVERIFIED.
  - Cost if wrong: a 1 s gap in the Korean demo segment.
- **P2-R8. Push-to-talk is fixed per connection, and toggling it reconnects.** Holding Space means an instant barge-in; releasing it ends the turn as soon as VAD and the transcript allow. Pipecat has no server-side push-to-talk, and a mute strategy that drops VAD stop frames can wedge a turn ([07][res07]).
  - Cost if wrong: a reconnect when she toggles it.
- **P2-R9. Typed lines go through RTVI `send-text`, from a developer console.** Spec §7 says the fake STT takes typed lines.
  - This works with any STT ([processor.py][pc-rtvi-proc]).
  - The fake STT instead maps utterances found by VAD (from Chromium's fake mic) to scripted lines, so the audio path runs with no keys.
  - Cost if wrong: none.
- **P2-R10. Provider settings move to `VoiceSettings`.** `TASSEL_PROVIDERS` gains `auto` and per-provider overrides, and moves out of P1's `Settings`, where nothing used it.
  - Cost if wrong: one settings field.
- **P2-R11. `TASSEL_TUTOR=live` means the WebRTC client talking to the server's voice loop,** whose providers may still be fake.
  - The default stays `fake`, so P1's specs hold; `pnpm dev` defaults to `live`.
  - Cost if wrong: one default.
- **P2-R12. The owner supplies the ElevenLabs voice ids** (`TASSEL_VOICE_EN|ES|KO`). Tassel ships no default, because spec §5.5 asks for listen-tested native voices; P6 adds the accent picker.
  - Cost if wrong: none.
- **P2-R13. `TutorEvent` grows additively,** with `connection`, `mic`, `language`, `word` and `voice-debug`, and `TutorClient` gains an optional `voice`. P5 and P6 may consume `word`.
  - Cost if wrong: renames.
- **P2-R14. Pipecat 1.12.0's event quirks.**
  - A 1.12.0 server sends `user-transcription`, which client 1.14.0 surfaces as the deprecated `UserTranscript`, never as `UserInput`. The mapping accepts both ([client d.ts][cj-dts]).
  - Flux emits no interim frames in 1.12.0. `TasselFluxSTTService` re-emits StartOfTurn and Update transcripts as `InterimTranscriptionFrame`, by overriding two private hooks of 1.12.0 ([stt_base.py L800, L938][pc-flux-base]). Re-check them on any Pipecat bump.
  - Cost if wrong: the Flux backchannel filter only sees final transcripts.
- **P2-R15. One live bot per learner.**
  - A restart offer for an unknown or ended `pc_id` gets 409, so the client reconnects cleanly instead of reviving a dead bot.
  - Cost if wrong: one rule.

**Not in P2,** with the plan that owns each:
- **P10:** TURN (coturn, including TURN over TCP 443) and the WebSocket fallback transport (spec §4.2). P2 exposes `TASSEL_ICE_SERVERS` (a JSON list) through `GET /v1/voice/ice-servers`, so P10 only fills it in.
- **P4:** vision notes injected into the loop, and holding lines. They will queue `LLMMessagesAppendFrame(run_llm=True)` on `Bot.worker`.
- **P5 and P6:** beat cue documents and lip-sync. P2 emits the playback-synced `word` events they start from.
- **P6:** the voice accent picker and its preview.
- **P8:** the session event log.
- **P9:** bilingual captions and per-language prompt tuning.
- **No plan yet:** the Settings screen's device section (spec §6) can reuse `AudioSettings` when one exists.

---

## Parallel tracks

**Task 1** (the contract) runs first, on `claude/p2-voice-loop`. Then three teams work at once, each in its own worktree, branched from `claude/p2-voice-loop` after Task 1:

| Team | Tasks, in order | Worktree and branch | Owns (nobody else edits these) |
|---|---|---|---|
| **S: server** | 2 → {3, 4, 5, 6 in any order} → 7 → 8 → 9 → 10 | `.claude/worktrees/p2-server`, `claude/p2-server` | `services/server/**` (including `config.py`, `app.py`, `sessions_repo.py`, `tests/conftest.py`, `pyproject.toml`, `uv.lock`, `.env.example`), and the generated `packages/shared/src/api/*` (Task 8) |
| **C: client** | 11 → 12 → 13 → 14 → 15 | `.claude/worktrees/p2-client`, `claude/p2-client` | `apps/desktop/src/renderer/src/tutor/live/**`, `apps/desktop/src/renderer/src/features/voice/**`, `apps/desktop/tests/unit/live/**`, `apps/desktop/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the `voice.*` keys in `packages/shared/src/i18n/*.json` |
| **D: desktop media** | 16 | `.claude/worktrees/p2-desktop`, `claude/p2-desktop` | `apps/desktop/src/main/voice/**`, `apps/desktop/src/shared/voice-bridge.ts`, `apps/desktop/tests/unit/voice-main/**`, `apps/desktop/tests/fixtures/audio/**`, `apps/desktop/tests/e2e/fake-mic.spec.ts`; one-line hooks in `main/index.ts`, `main/windows.ts`, `preload/index.ts`, `shared/bridge.ts`, `tests/e2e/fixtures.ts` and `tests/e2e/global-setup.ts` |

**Integration:** merge D, C and S into `claude/p2-voice-loop`, in any order, since no two teams edit the same file. Then build Tasks 17 → 18 → 19 → 20 there, one builder at a time. They own:
- `tutor/types.ts`, `tutor/create-client.ts`, `tutor/use-tutor-session.ts`;
- `features/session/**`;
- the remaining i18n keys;
- `scripts/dev.mjs`, the README, `CLAUDE.md`;
- the `tests/e2e/voice-*.spec.ts` files.

**Team rules:**
- Teams meet only at Task 1's contract. A change to it goes to `main` as a `QUESTION:` first.
- The client team never imports the generated `/v1/voice/*` API types; Task 17 wires the ICE-server fetch.
- E2E runs only in Team D's worktree before integration, on its own `TASSEL_E2E_PORT` and database if another checkout is running E2E.

**Merging with P3** (`2026-10-17-p3-paper-view.md`, built in parallel):
- **Additive edits on both sides:** `config.py`, `pyproject.toml` and `uv.lock` (keep both, then run `uv lock`); `shared/bridge.ts`, `preload/index.ts` and `main/index.ts` (adjacent lines; keep both); the E2E setup and fixtures, `scripts/dev.mjs`, CI, the README and `CLAUDE.md`.
- **Generated API files:** never hand-merge `packages/shared/src/api/*`. Merge, then run `pnpm gen:api`.
- **Fake devices:** Chromium's `use-fake-device-for-media-stream` fakes the camera *and* the microphone, and the default fake mic beeps (P3-R5). After both merge, when P3's fake clip is on and `TASSEL_FAKE_MIC` is unset, point the fake mic at `apps/desktop/tests/fixtures/audio/silence.wav` (looping). This is one line in `main/index.ts`, so the live voice loop hears silence instead.
- **Migrations:** P2 adds none.

## File map

| Area | New files |
|---|---|
| Contract (Task 1) | `packages/shared/src/voice/{messages.ts,fixtures.json}`, `services/server/src/tassel/voice/{__init__,messages}.py` |
| Server (S) | `voice/{settings,routes,turns,flux,providers,prompts,tools,memory,events,bot,api,registry,titles,metrics,latency_report,smoke}.py`, `voice/fakes/{__init__,tts,scenario,llm,stt}.py`, `voice/fakes/scenarios/{dfa-opening,barge-in,ptt}.json`, `services/server/.env.example`, `tests/voice/**` |
| Client (C) | `tutor/live/{mic,speaker,media-manager,rtvi-map,live-client,push-to-talk,latency}.ts`, `features/voice/{audio-prefs,devices,voice-debug}.ts`, `features/voice/{AudioSettings,LatencyHud,DevConsole}.tsx`, `tests/unit/live/**` |
| Desktop media (D) | `src/main/voice/{switches,mic-access,ipc}.ts`, `src/shared/voice-bridge.ts`, `tests/fixtures/audio/{timelines.json,make-fixtures.mjs,*.wav}`, `tests/unit/voice-main/**`, `tests/e2e/fake-mic.spec.ts` |
| Integration | `features/voice/{use-voice-session.ts,LanguageMenu.tsx,MicNotice.tsx}`, `tests/e2e/voice-{conversation,barge-in,ptt,devices,language,reconnect,live}.spec.ts`, `tests/unit/fixture-sync.test.ts` |

Renderer paths are under `apps/desktop/src/renderer/src/` and server paths under `services/server/src/tassel/`, unless a path says otherwise.

---

### Task 1: Voice event contract

**Files:**
- Create: `packages/shared/src/voice/messages.ts`, `packages/shared/src/voice/fixtures.json`
- Modify: `packages/shared/package.json` (exports `"./voice": "./src/voice/messages.ts"` and `"./voice/fixtures.json": "./src/voice/fixtures.json"`)
- Create: `services/server/src/tassel/voice/__init__.py` (a docstring only, so importing the contract never loads Pipecat), `services/server/src/tassel/voice/messages.py`
- Modify: `apps/desktop/src/renderer/src/tutor/types.ts` (the additive variants below), `tutor/use-tutor-session.ts` (ignore the new variants until Task 17)
- Test: `packages/shared/tests/voice-messages.test.ts`, `services/server/tests/voice/test_voice_messages.py`, `apps/desktop/tests/unit/tutor-contract.test.ts`

**Interfaces:**
- Produces (TypeScript, `@tassel/shared/voice`). Wire keys are snake_case, like the REST API's.

```ts
export const ENVELOPE = 'tassel';  // server: RTVI server-message data is { tassel: ServerEvent }; client: sendClientMessage('tassel', ClientEvent)
export type Sensitivity = 'low' | 'normal' | 'high';
export type SttKind = 'flux' | 'nova-3' | 'fake';
export type RouteEvent = { kind: 'route'; lang: Lang; stt: SttKind; llm: 'openrouter' | 'fake'; tts: 'elevenlabs' | 'fake' };
export interface TurnMetrics { turn: number; lang: Lang; input: 'voice' | 'typed'; stt_ms: number | null; llm_ttfb_ms: number | null;
  tts_ttfb_ms: number | null; server_ttfa_ms: number | null; interrupted: boolean; budget_ms: number }
export type TurnMetricsEvent = { kind: 'turn-metrics'; metrics: TurnMetrics };
export type BackchannelEvent = { kind: 'backchannel'; text: string };
export type ServerEvent = RouteEvent | TurnMetricsEvent | BackchannelEvent
  | { kind: 'title'; title: string; subject: string | null }
  | { kind: 'stage'; view: 'paper' | 'board' | 'split' }
  | { kind: 'language'; lang: Lang }
  | { kind: 'vad'; speaking: boolean };
export interface ClientMetrics { ttfa_ms: number | null; barge_in_ms: number | null; yield_ms: number | null }
export type ClientEvent =
  | { kind: 'ptt'; enabled: boolean; held: boolean }
  | { kind: 'sensitivity'; level: Sensitivity }
  | ({ kind: 'client-metrics' } & ClientMetrics);
export interface OfferRequestData { scenario?: string; sensitivity: Sensitivity; ptt: boolean }
export const VOICE_BUDGETS: { ttfa_ms: Record<Lang, number>; barge_in_ms: number };  // { en: 1200, es: 1200, ko: 1400 }, 300
export function parseServerEvent(data: unknown): ServerEvent | null;   // validates { tassel: {...} } field by field
export function voiceOfferPath(sessionId: string): string;             // `/v1/sessions/${sessionId}/voice/offer`
export const ICE_SERVERS_PATH = '/v1/voice/ice-servers';
```

- Produces (Python, `tassel.voice.messages`):
  - the literals `Sensitivity = Literal["low", "normal", "high"]` and `SttKind = Literal["flux", "nova-3", "fake"]`, which later tasks import rather than redefine;
  - one Pydantic model per kind: `RouteEvent`, `TitleEvent`, `StageEvent`, `LanguageEvent`, `VadEvent`, `BackchannelEvent`, `TurnMetrics`, `TurnMetricsEvent`, `PushToTalkEvent`, `SensitivityEvent`, `ClientMetricsEvent`, `OfferRequestData` (defaults `scenario=None`, `sensitivity="normal"`, `ptt=False`);
  - `TypeAdapter`s `SERVER_EVENTS` and `CLIENT_EVENTS` over unions discriminated on `kind`;
  - the constants `ENVELOPE = "tassel"`, `VOICE_BUDGETS` (same values), and the router-relative paths `OFFER_PATH = "/sessions/{session_id}/voice/offer"` and `ICE_SERVERS_PATH = "/voice/ice-servers"`;
  - `def envelope(event: BaseModel) -> dict`, which returns `{"tassel": event.model_dump(mode="json")}`.
- Produces (renderer, `tutor/types.ts`, additive):

```ts
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';
export type MicStatus = 'off' | 'live' | 'denied' | 'unavailable';
export type VoiceDebugEvent = RouteEvent | TurnMetricsEvent | BackchannelEvent | ({ kind: 'client-metrics' } & ClientMetrics);
// TutorEvent gains:
  | { type: 'connection'; status: ConnectionStatus; attempt?: number }
  | { type: 'mic'; status: MicStatus }
  | { type: 'language'; lang: Lang }
  | { type: 'word'; text: string; lang: Lang }          // a tutor word as she says it (playback-synced); for P5/P6
  | { type: 'voice-debug'; event: VoiceDebugEvent };
export interface VoiceControls {
  setTalking(held: boolean): void; setSensitivity(level: Sensitivity): void;
  reportClientMetrics(m: ClientMetrics): void; reconnect(): Promise<void>; readonly connectionCount: number;
}
export interface TutorClient { /* P1 members unchanged */ readonly voice?: VoiceControls }
```

- `fixtures.json` holds:
  - `budgets`;
  - `endpoints`: `offer` = `/v1/sessions/{session_id}/voice/offer` and `ice_servers`;
  - one `server` example per kind, including a `title` of "Strings that start with 010" / "Automata · DFA" and a `backchannel` of "네";
  - one `client` example per kind;
  - an `offer_request_data` example.

  It is the contract the server and client teams build against.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shared/tests/voice-messages.test.ts
it.each(fixtures.server)('parses the $kind server event', (event) => {
  expect(parseServerEvent({ tassel: event })).toEqual(event);
});
it.each([null, 'x', {}, { tassel: { kind: 'nope' } }, { tassel: { kind: 'title' } }, { tassel: { kind: 'vad', speaking: 'yes' } }])(
  'rejects %j', (data) => expect(parseServerEvent(data)).toBeNull());
it('keeps the spec §2 budgets', () => {
  expect(VOICE_BUDGETS).toEqual({ ttfa_ms: { en: 1200, es: 1200, ko: 1400 }, barge_in_ms: 300 });
  expect(fixtures.budgets).toEqual(VOICE_BUDGETS);
});
it('builds endpoint paths', () => {
  expect(voiceOfferPath('abc')).toBe('/v1/sessions/abc/voice/offer');
  expect(fixtures.endpoints).toEqual({ offer: '/v1/sessions/{session_id}/voice/offer', ice_servers: ICE_SERVERS_PATH });
});
```

```python
# services/server/tests/voice/test_voice_messages.py  (REPO = Path(__file__).resolve().parents[4])
@pytest.mark.parametrize("event", FIXTURES["server"], ids=lambda e: e["kind"])
def test_server_events_round_trip(event):
    assert SERVER_EVENTS.dump_python(SERVER_EVENTS.validate_python(event), mode="json") == event
@pytest.mark.parametrize("event", FIXTURES["client"], ids=lambda e: e["kind"])
def test_client_events_round_trip(event):
    assert CLIENT_EVENTS.dump_python(CLIENT_EVENTS.validate_python(event), mode="json") == event
def test_budgets_and_paths_match_the_fixture():
    assert VOICE_BUDGETS == FIXTURES["budgets"]
    assert "/v1" + OFFER_PATH == FIXTURES["endpoints"]["offer"]
    assert "/v1" + ICE_SERVERS_PATH == FIXTURES["endpoints"]["ice_servers"]
def test_offer_request_data_defaults():
    d = OfferRequestData.model_validate({})
    assert (d.scenario, d.sensitivity, d.ptt) == (None, "normal", False)
def test_envelope():
    assert envelope(StageEvent(kind="stage", view="split")) == {"tassel": {"kind": "stage", "view": "split"}}
```

  In `tutor-contract.test.ts`: `useTutorSession ignores a word event`. The FakeTutorClient emits `{ type: 'word', text: 'hi', lang: 'en' }`; nothing throws and the stage store is unchanged.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/shared test voice-messages && uv run --directory services/server pytest tests/voice/test_voice_messages.py -v`
  - Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Hand-write `parseServerEvent` guards (no new dependency). Keep the Python models with `extra="forbid"`.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `pnpm --filter @tassel/desktop test tutor-contract && pnpm --filter @tassel/desktop typecheck`.
  - Expected: PASS, and P1's tutor tests still pass.
- [ ] **Step 5: Commit.** `git add packages/shared services/server/src/tassel/voice services/server/tests/voice apps/desktop/src/renderer/src/tutor apps/desktop/tests/unit/tutor-contract.test.ts && git commit -m "feat(shared): voice event contract and additive TutorEvent variants"`

### Task 2: Pipecat dependency, voice settings and routes

**Files:**
- Modify: `services/server/pyproject.toml`, adding the runtime dependencies `"pipecat-ai[webrtc,deepgram]==1.12.0"` and `"httpx>=0.28"`; `services/server/uv.lock`
- Modify: `services/server/src/tassel/config.py` (remove `providers`, which moves to `VoiceSettings`; P2-R10)
- Create: `services/server/.env.example`, `services/server/src/tassel/voice/settings.py`, `services/server/src/tassel/voice/routes.py`
- Test: `services/server/tests/voice/test_voice_settings.py`, `services/server/tests/voice/test_voice_routes.py`

**Interfaces:**
- Produces:

```python
Mode = Literal["fake", "live", "auto"]
ProviderKind = Literal["stt", "llm", "tts", "titles"]
SERVER_DIR: Path  # services/server
class VoiceSettings(BaseSettings):  # env_prefix TASSEL_, env_file SERVER_DIR/".env", extra ignore, populate_by_name
    providers: Mode = "fake"
    stt_provider: Mode | None = None; llm_provider: Mode | None = None; tts_provider: Mode | None = None; titles_provider: Mode | None = None
    deepgram_api_key: SecretStr | None = Field(None, validation_alias="DEEPGRAM_API_KEY")   # same for OPENROUTER_API_KEY, ELEVENLABS_API_KEY
    voice_en: str | None = None; voice_es: str | None = None; voice_ko: str | None = None
    llm_model: str = "qwen/qwen3.8-27b"; llm_max_tokens: int = 400
    fake_tts: Literal["auto", "say", "tone"] = "auto"; fake_scenario: str = "dfa-opening"
    ice_servers: list[str] = []; voice_metrics_log: Path | None = None
class VoiceConfigError(RuntimeError): ...
def resolve_mode(kind: ProviderKind, s: VoiceSettings) -> Literal["fake", "live"]  # raises VoiceConfigError for live without key
def check_voice_settings(s: VoiceSettings) -> list[str]                          # every problem, one line each

@dataclass(frozen=True)
class VoiceRoute:
    lang: Lang; stt: Literal["flux", "nova-3"]; stt_model: str; language_hints: tuple[str, ...]
    keyterms: tuple[str, ...]; smart_turn: bool; tts_language: str; ttfa_budget_ms: int
KEYTERMS: dict[Lang, tuple[str, ...]]
def route_for(lang: Lang) -> VoiceRoute
```

- Keyterms (exact):
  - en: `("DFA", "NFA", "automaton", "accept state", "dead state", "transition", "q zero")`
  - es: `("DFA", "AFD", "autómata", "estado de aceptación", "estado muerto", "transición")`
  - ko: `("DFA", "상태", "전이", "수락 상태", "죽은 상태", "오토마타")`
- Error lines read `"<VAR>=live needs <KEY> in services/server/.env"`. `<VAR>` is `TASSEL_PROVIDERS` when the global mode decided, else `TASSEL_<KIND>_PROVIDER`. Live TTS also needs one voice per language: `"TASSEL_TTS_PROVIDER=live needs TASSEL_VOICE_KO in services/server/.env"`. Titles use `OPENROUTER_API_KEY`.
- `.env.example` lists `TASSEL_PROVIDERS=fake`, the four override names in a comment, the three keys and the three voice ids, all empty. Its first comment line says the file is never shipped in the app.

- [ ] **Step 1: Write the failing tests.**
  - `test_defaults_are_fake`: with `VoiceSettings(_env_file=None)`, every kind resolves to `fake` and `check_voice_settings` returns `[]`.
  - `test_auto_is_live_only_with_its_key`: with `providers="auto"` and only `deepgram_api_key`, stt is live, and llm, tts and titles are fake.
  - `test_live_without_key_is_reported`: with `llm_provider="live"`, the problems are `["TASSEL_LLM_PROVIDER=live needs OPENROUTER_API_KEY in services/server/.env"]`, and `resolve_mode("llm", s)` raises with that text.
  - `test_live_tts_needs_a_voice_per_language`: with a key and only `voice_en`, the problems name `TASSEL_VOICE_ES` and `TASSEL_VOICE_KO`.
  - `test_reads_the_env_file(tmp_path)`: a file holding `DEEPGRAM_API_KEY=dg1` and `TASSEL_PROVIDERS=auto` gives `providers == "auto"` and the key `dg1`.
  - `test_secrets_never_print`: `repr()` contains no key text.
  - Routes:

```python
def test_english_and_spanish_ride_flux_multilingual():
    for lang in ("en", "es"):
        r = route_for(lang)
        assert (r.stt, r.stt_model, r.language_hints, r.smart_turn, r.tts_language, r.ttfa_budget_ms) == \
               ("flux", "flux-general-multi", (lang,), False, lang, 1200)
def test_korean_rides_nova3_with_smart_turn():
    r = route_for("ko")
    assert (r.stt, r.stt_model, r.language_hints, r.smart_turn, r.tts_language, r.ttfa_budget_ms) == \
           ("nova-3", "nova-3-general", (), True, "ko", 1400)
    assert {"DFA", "상태", "전이", "수락 상태"} <= set(r.keyterms)
def test_budgets_come_from_the_contract():
    assert {l: route_for(l).ttfa_budget_ms for l in ("en", "es", "ko")} == VOICE_BUDGETS["ttfa_ms"]
```

- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_voice_settings.py tests/voice/test_voice_routes.py -v`
  - Expected: FAIL (import error).
- [ ] **Step 3: Implement.**
  - Run `uv add --directory services/server "pipecat-ai[webrtc,deepgram]==1.12.0" "httpx>=0.28"`.
  - The `elevenlabs`, `openrouter` and `silero` extras are empty in 1.12.0, and `local-smart-turn` is excluded (Global Constraints) ([pyproject][pc-pyproject]).
  - Check: `uv run --directory services/server python -c "import pipecat, aiortc; from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3"` exits 0.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `uv run --directory services/server pytest -v && uv run --directory services/server ruff check`
  - Expected: PASS (P1's tests too), then clean.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(server): pin Pipecat 1.12.0, voice settings and per-language routes"`

### Task 3: Fake TTS

**Files:**
- Create: `services/server/src/tassel/voice/fakes/__init__.py`, `services/server/src/tassel/voice/fakes/tts.py`
- Test: `services/server/tests/voice/test_fake_tts.py`

**Interfaces:**
- Consumes: `TTSService` and the frames from Pipecat ([tts_service.py][pc-tts], [frames.py][pc-frames]):
  - `run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]`;
  - the constructor flags `push_text_frames`, `push_start_frame` and `push_stop_frames`;
  - `TTSAudioRawFrame(audio, sample_rate, num_channels, context_id=None)`;
  - `await self.add_word_timestamps([(word, secs)], context_id)`. This makes the base emit a `TTSTextFrame` with a `pts` for each word, and the output transport releases each one in sync with its audio.
- Produces:

```python
TtsEngine = Literal["say", "tone"]
SAY_VOICES: dict[Lang, str] = {"en": "Samantha", "es": "Paulina", "ko": "Yuna"}   # female voices, `say -v '?'` on macOS 26.6
def pick_engine(setting: Literal["auto", "say", "tone"], *, platform: str = sys.platform,
                which: Callable[[str], str | None] = shutil.which) -> TtsEngine
def tone_clip(text: str, sample_rate: int, *, ms_per_char: int = 55, gap_ms: int = 60) -> tuple[bytes, list[tuple[str, float]]]
def spread_words(text: str, duration_s: float) -> list[tuple[str, float]]
async def say_clip(text: str, lang: Lang, sample_rate: int, *, exec=asyncio.create_subprocess_exec) -> tuple[bytes, float]
class FakeTTSService(TTSService):
    def __init__(self, *, lang: Lang, engine: TtsEngine, ttfb_ms: int = 150, **kwargs)  # push_text_frames=False, push_start_frame=True, push_stop_frames=True
    def can_generate_metrics(self) -> bool  # True: every Pipecat base returns False, which would hide TTFB
```

- **Tone:** each word is a 220 Hz tone of `len(word) * ms_per_char`, with 10 ms fades, followed by `gap_ms` of silence. The clip is int16 mono PCM.
- **`say`:** runs `say -v <voice> -o <tmp.wav> --file-format=WAVE --data-format=LEI16@<sample_rate> -- <text>` (`man say`), in a temporary directory. Word starts are spread in proportion to word length. Any failure falls back to the tone, logging once.
- **`run_tts`:** sleeps `ttfb_ms` between `start_ttfb_metrics` and the first chunk, and yields 20 ms chunks. It keeps a running time offset per `context_id`, because one LLM turn reuses its context across sentences.

- [ ] **Step 1: Write the failing tests.**
  - `test_tone_clip_timing`: `tone_clip("try 1010", 24000)` gives 505 ms of audio (165 + 60 + 220 + 60), so `len(pcm) == 2 * 12120`, and the words are `[("try", 0.0), ("1010", 0.225)]`.
  - `test_spread_words`: `spread_words("ab cdef", 1.2) == [("ab", 0.0), ("cdef", 0.4)]`.
  - `test_pick_engine`:
    - `("auto", platform="linux")` gives `"tone"`;
    - `("auto", platform="darwin", which=lambda _: "/usr/bin/say")` gives `"say"`;
    - `("auto", "darwin", which=lambda _: None)` gives `"tone"`;
    - `("say", "win32")` gives `"tone"`;
    - `("tone", "darwin")` gives `"tone"`.
  - `test_speaks_with_word_timings`: through `run_test` ([tests/utils.py][pc-test-utils]), `FakeTTSService(lang="en", engine="tone", ttfb_ms=0)` fed `TTSSpeakFrame("Try running 1010.")` yields, in order:
    - `TTSStartedFrame`;
    - at least one `TTSAudioRawFrame` at 24000 Hz with 1 channel;
    - a `TTSTextFrame` each for "Try", "running" and "1010.", in that order;
    - `TTSStoppedFrame`.
  - `test_say_uses_the_language_voice`: with a fake `exec` recording argv, `say_clip("안녕하세요", "ko", 24000)` passes `-v Yuna`, `--file-format=WAVE` and `--data-format=LEI16@24000`.
  - `test_say_really_speaks`: skipped unless darwin with `say` on PATH. The duration is over 0.3 s.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_fake_tts.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement `FakeTTSService` and the helpers in `voice/fakes/tts.py`.**
- [ ] **Step 4: Run them and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): fake TTS with tone and say engines and synthetic word timings"`

### Task 4: Fake scenarios, fake LLM and fake STT

**Files:**
- Create: `services/server/src/tassel/voice/fakes/scenario.py`, `fakes/llm.py`, `fakes/stt.py`, `fakes/scenarios/dfa-opening.json`, `fakes/scenarios/barge-in.json`, `fakes/scenarios/ptt.json`
- Test: `services/server/tests/voice/test_fake_scenarios.py`, `tests/voice/test_fake_llm.py`, `tests/voice/test_fake_stt.py`

**Interfaces:**
- Consumes ([llm_service.py][pc-llm], [openai base_llm.py][pc-openai-llm], [stt_service.py][pc-stt], [frames.py][pc-frames]):
  - `LLMService.process_frame`, handling `LLMContextFrame(context)`, then pushing `LLMFullResponseStartFrame`, `LLMTextFrame(text)` and `LLMFullResponseEndFrame`, and forwarding every other frame;
  - `run_function_calls([FunctionCallFromLLM(function_name, tool_call_id, arguments, context)])`;
  - `STTService(ttfs_p99_latency=...)`, `run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]`;
  - `TranscriptionFrame(text, user_id, timestamp, language=None, result=None, finalized=False)`, `InterimTranscriptionFrame(text, user_id, timestamp, language=None)`, `time_now_iso8601()` ([utils/time.py][pc-time]);
  - `CancelWorkerFrame(reason)`.
  - VAD frames reach the STT because the user aggregator broadcasts them in both directions; this is how Nova-3 sends `Finalize` ([llm_response_universal.py L741–779][pc-aggregator], [deepgram stt.py L804][pc-nova]).
- Produces:

```python
class ScriptTool(BaseModel): name: Literal["show_stage", "set_language"]; arguments: dict[str, str]
class ScriptTurn(BaseModel): when: str | None = None; say: str; tools: list[ScriptTool] = []
class ScriptLang(BaseModel): greeting: str; after_switch: str; fallback: str; turns: list[ScriptTurn]; student: list[str] = []
class FakeScenario(BaseModel): name: str; title: str | None = None; subject: str | None = None; langs: dict[Lang, ScriptLang]
SCENARIOS_DIR: Path
DROP_DIRECTIVE = "/drop"
def load_scenario(name: str) -> FakeScenario   # ValueError unless name matches ^[a-z0-9-]{1,40}$ and the file exists
def next_turn(script: ScriptLang, user_text: str | None, said: Sequence[str]) -> ScriptTurn
class FakeLLMService(LLMService):
    def __init__(self, *, scenario: FakeScenario, lang: Lang, ttfb_ms: int = 250, chunk_words: int = 3, **kwargs)
class FakeSTTService(STTService):
    def __init__(self, *, lines: Sequence[str], lang: Lang, interim_after_ms: int = 150, **kwargs)   # ttfs_p99_latency=0.2
```

- **`next_turn`** picks the first rule that applies:
  1. `user_text is None`: the greeting, unless it's already in `said`.
  2. Text starting with `"[language switch]"`: `after_switch`.
  3. Otherwise, the first turn whose `say` isn't in `said` and whose `when` is a casefolded substring of the text.
  4. Else, the first unused turn with no `when`.
  5. Else, the fallback.
- **The fake LLM:**
  - `said` is the assistant messages in the context.
  - It streams `say` in `chunk_words`-word `LLMTextFrame`s, 30 ms apart, after `ttfb_ms`, inside the TTFB metrics. `can_generate_metrics()` returns True.
  - It then runs the turn's tools as function calls.
  - A user text of exactly `/drop` pushes `CancelWorkerFrame(reason="scripted drop")` upstream instead. This simulates a crash.
- **The fake STT:** `run_stt` yields nothing.
  - On `VADUserStartedSpeakingFrame`, after `interim_after_ms`, it pushes `InterimTranscriptionFrame` with the first two words of the next line.
  - On `VADUserStoppedSpeakingFrame`, it pushes the full line as a finalized `TranscriptionFrame` and moves to the next line.
  - It is silent once the lines run out. VAD frames are handled in either direction and always forwarded.
- **`dfa-opening.json`**, en (es and ko carry the same structure in natural Spanish and polite 해요체 Korean):
  - `title` is "Strings that start with 010" and `subject` is "Automata · DFA".
  - `greeting`: "Hi, I'm Ada. What are we working on today?"
  - `after_switch`: "Okay, we'll keep going in English."
  - `fallback`: "Tell me more about what you're trying."
  - `turns`:
    1. `when` "start with 010", `say` "Great, draw it on paper and talk me through it. I'll watch."
    2. `when` "I think that's it", `say` "Before you move on, try running 1010 through your DFA. Where does it end up?", `tools` `[show_stage {view: split}]`
    3. `when` "continue in Korean", `say` "Sure, let's switch to Korean.", `tools` `[set_language {language: ko}]`
  - `student`: "Hi Ada, I'm working on a DFA for binary strings that start with 010.", then "I think that's it. If it starts with a 1, I just wait on q0 until I see a 0."
  - ko: `student` is "에이다, 010으로 시작하는 이진 문자열 DFA를 만들고 있어요." and "왜 죽은 상태가 필요해요?". One turn has `when` "죽은 상태" and a short Korean explanation of the dead state, and `after_switch` is "좋아요, 이제 한국어로 계속할게요."
- **`barge-in.json`**:
  - en `greeting` (about 190 characters, so about 12 s of tone): "Hi, I'm Ada. Before we start, here's how this works: I'll watch your paper while you work, and I'll only step in when something is worth a closer look. You can interrupt me any time."
    - `student`: "uh-huh", then "Wait, can I ask something?"
    - `turns`: `when` "ask something", `say` "Of course. What's your question?"
  - ko: a similarly long greeting.
    - `student`: "네", then "잠깐만요, 질문이 있어요."
    - `turns`: `when` "질문", `say` "네, 말씀하세요."
- **`ptt.json`**, en:
  - `greeting`: "Hi, I'm Ada. Hold Space when you want to talk."
  - `student`: "Can you hear me now?"
  - `turns`: `when` "hear me", `say` "Yes, I can hear you clearly."
- Every scenario defines en, es and ko.

- [ ] **Step 1: Write the failing tests.**
  - `test_every_scenario_loads`: each file in `SCENARIOS_DIR` loads with en, es and ko, and non-empty greeting, after_switch and fallback.
  - `test_load_rejects_bad_names`: `"../x"`, `"DFA"` and `""` each raise `ValueError`.
  - `test_next_turn_follows_the_demo` (en):
    - no text gives the greeting;
    - the first student line gives turn 1's `say`;
    - "I think that's it…" gives turn 2, with `show_stage` `{"view": "split"}`;
    - the first line again, after turn 1 is said, gives the fallback.
  - `test_language_switch_note_uses_after_switch`: for ko, `next_turn(script, "[language switch] …", [...]).say` is ko's `after_switch`.
  - `test_fake_llm_streams_the_reply_and_calls_the_tool`:
    - Setup: `FakeLLMService(scenario=dfa, lang="en", ttfb_ms=0)` with a registered `show_stage` handler, fed an `LLMContextFrame` whose last user message is "I think that's it. …".
    - The downstream frames run Start, then `LLMTextFrame`s whose joined text equals turn 2's `say`, then End.
    - The handler receives `{"view": "split"}`.
  - `test_fake_llm_drop_cancels_the_worker`: a `/drop` user message gives a `CancelWorkerFrame` upstream and no `LLMTextFrame`.
  - `test_fake_stt_maps_utterances_to_lines`:
    - Setup: `FakeSTTService(lines=["uh-huh", "Wait, can I ask something?"], lang="en", interim_after_ms=0)`, fed VAD start, stop, start, stop, start, stop.
    - Output: interim "uh-huh", final "uh-huh", interim "Wait, can", final "Wait, can I ask something?", and nothing for the third pair.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_fake_scenarios.py tests/voice/test_fake_llm.py tests/voice/test_fake_stt.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): scripted fake LLM and VAD-driven fake STT with demo scenarios"`

### Task 5: Turn-taking: backchannel filter, sensitivity and push-to-talk

**Files:**
- Create: `services/server/src/tassel/voice/turns.py`
- Test: `services/server/tests/voice/test_turns.py`

**Interfaces:**
- Consumes ([base_user_turn_start_strategy.py][pc-user-start], [min_words_user_turn_start_strategy.py][pc-min-words], [base_user_turn_stop_strategy.py][pc-user-stop], [external_user_turn_stop_strategy.py][pc-ext-stop], [user_turn_strategies.py][pc-strategies], [turn_analyzer_user_turn_stop_strategy.py][pc-ta-stop], [silero.py][pc-silero], [vad_analyzer.py][pc-vad], [local_smart_turn_v3.py][pc-smart-turn]):
  - `BaseUserTurnStartStrategy(enable_interruptions=True)`, with the overrides:
    - `process_frame(frame) -> ProcessFrameResult | None`;
    - `resolves_proposed_turn_start_frames` (a property);
    - `handle_user_turn_started()`.
  - Its triggers: `trigger_user_turn_started()` (which broadcasts the interruption) and `trigger_reset_aggregation()`.
  - `BaseUserTurnStopStrategy`, with `trigger_user_turn_stopped()`.
  - `ProcessFrameResult.CONTINUE|STOP`.
  - `UserTurnStrategies(start, stop)`, `ExternalUserTurnStopStrategy(timeout=0.5)`, `TurnAnalyzerUserTurnStopStrategy(turn_analyzer=...)`.
  - `SileroVADAnalyzer(params=VADParams(...))`, `LocalSmartTurnAnalyzerV3()`.
  - The bot-speaking state comes only from `BotStartedSpeakingFrame`/`BotStoppedSpeakingFrame`; strategies track it themselves.
  - Flux's StartOfTurn arrives as `ProposedUserStartedSpeakingFrame`.
- Produces:

```python
# Sensitivity and SttKind come from tassel.voice.messages (Task 1)
@dataclass
class TurnTuning: sensitivity: Sensitivity = "normal"; ptt: bool = False; ptt_held: bool = False
@dataclass
class PushToTalkFrame(SystemFrame): held: bool                  # queued by the bot when the client's ptt message arrives
BACKCHANNELS: dict[Lang, frozenset[str]]
MIN_WORDS: dict[Sensitivity, int] = {"high": 1, "normal": 1, "low": 2}
def normalize(text: str) -> str
def is_backchannel(text: str, lang: Lang) -> bool
class BackchannelGuard(BaseUserTurnStartStrategy):
    def __init__(self, *, tuning: TurnTuning, lang: Lang, on_ignored: Callable[[str], Awaitable[None]] | None = None)
class PushToTalkStop(BaseUserTurnStopStrategy):
    def __init__(self, *, tuning: TurnTuning)
def make_vad() -> SileroVADAnalyzer          # VADParams(confidence=0.7, start_secs=0.2, stop_secs=0.2, min_volume=0.6)
def make_turn_strategies(stt: SttKind, tuning: TurnTuning, lang: Lang,
                         on_ignored: Callable[[str], Awaitable[None]] | None = None) -> UserTurnStrategies
```

- **Lexicon (exact):**
  - en: `uh-huh, uh huh, mhm, mm-hmm, mm hmm, mm, hmm, yeah, yep, yes, ok, okay, right, sure, uh, um, oh, ah, i see, got it`
  - es: `ajá, aja, sí, si, mhm, vale, ok, okey, claro, ya, eh, ah, oh, bueno, entiendo, de acuerdo`
  - ko: `네, 넵, 예, 응, 어, 음, 아, 오, 아하, 그렇구나, 그래요, 맞아요, 알겠어요`
- **`normalize`:** NFC, casefold, strip `.,!?…~'"“”‘’`, collapse whitespace.
- **`is_backchannel`:** the normalized text is in the set, or it's one set entry repeated with or without spaces ("네 네", "네네", "yeah yeah"). Empty text is not a backchannel.
- **`BackchannelGuard`:**
  - `resolves_proposed_turn_start_frames` returns True.
  - It tracks bot speech, and starts or holds the turn as below.

  | Condition | What it does |
  |---|---|
  | `tuning.ptt` is on | Starts on VAD start or a proposed start only while `ptt_held` |
  | Start signal (VAD start or a proposed start) while the bot is quiet, or sensitivity `high` | Starts the turn, returns STOP |
  | Interim or final transcription while the bot is quiet | Starts the turn, returns STOP |
  | Transcription while the bot speaks, with a non-backchannel and at least `MIN_WORDS[sensitivity]` words | Starts the turn (which interrupts), returns STOP |
  | A final backchannel while the bot speaks | Calls `trigger_reset_aggregation()` (keeping "uh-huh" out of the context), then `on_ignored(text)` |

  `handle_user_turn_started` clears the bot-speaking flag, as `MinWordsUserTurnStartStrategy` does.
- **`PushToTalkStop`** tracks four things:
  - VAD speaking;
  - a counter that bumps on each VAD start;
  - the counter value at the last final transcript;
  - `held`, from `PushToTalkFrame`.

  It calls `trigger_user_turn_stopped()` once all three hold:
  1. Space is released;
  2. VAD isn't speaking;
  3. a final transcript came after the last VAD start.

  If no transcript comes, the aggregator's `user_turn_stop_timeout` (5 s) still ends the turn.
- **`make_turn_strategies`:**

  | Case | Start | Stop |
  |---|---|---|
  | `tuning.ptt` | `[BackchannelGuard]` | `[PushToTalkStop]` |
  | `"flux"` | `[BackchannelGuard]` | `[ExternalUserTurnStopStrategy()]` |
  | `"nova-3"` and `"fake"` | `[BackchannelGuard]` | `[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())]` |

- [ ] **Step 1: Write the failing tests.** The lexicon:

```python
@pytest.mark.parametrize("lang,text", [("en", "Uh-huh."), ("en", "Mm-hmm"), ("en", "yeah yeah"), ("es", "Ajá"),
                                       ("es", "sí, sí"), ("ko", "네"), ("ko", "네네"), ("ko", "네 네!"), ("ko", "아하")])
def test_backchannels(lang, text): assert is_backchannel(text, lang)
@pytest.mark.parametrize("lang,text", [("en", "wait"), ("en", "yeah but"), ("es", "espera"),
                                       ("ko", "잠깐만요"), ("ko", "네 근데요"), ("en", "")])
def test_not_backchannels(lang, text): assert not is_backchannel(text, lang)
```

  The strategies run inside a real user aggregator: `user, _ = LLMContextAggregatorPair(LLMContext(), user_params=LLMUserAggregatorParams(user_turn_strategies=...))`, then `run_test(user, frames_to_send=[...])`. "Starts" means a `UserStartedSpeakingFrame` (and an `InterruptionFrame`) appears downstream.
  - `test_backchannel_while_tutor_speaks_does_not_interrupt`:
    - Frames: `BotStartedSpeakingFrame`, `ProposedUserStartedSpeakingFrame`, interim "uh huh", final "uh huh".
    - Result: no start, and `on_ignored("uh huh")` is awaited once.
  - `test_a_real_word_interrupts`: the same frames with "wait" start a turn.
  - `test_korean_ne_is_ignored_and_jamkkanmanyo_interrupts` (lang ko).
  - `test_low_sensitivity_needs_two_words`: "wait" doesn't start; "wait what" does.
  - `test_instant_sensitivity_interrupts_on_speech_start`: the bot is speaking, and a `VADUserStartedSpeakingFrame` starts the turn.
  - `test_idle_tutor_any_speech_starts_a_turn`: a VAD start or a final "네" starts a turn while the bot is quiet.
  - `test_ptt_released_never_starts` and `test_ptt_held_starts_on_vad`.
  - `test_ptt_stop_waits_for_release_and_transcript`:
    - With tuning `ptt=True, ptt_held=True`, the frames are VAD start, final "Can you hear me now?", VAD stop, then `PushToTalkFrame(held=False)`.
    - `UserStoppedSpeakingFrame` appears only after the last frame.
  - `test_strategy_sets_per_route`: the start and stop classes for `flux`, `nova-3`, `fake` and `ptt` match the table above.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_turns.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement `turns.py`.** If a strategy never sees `PushToTalkFrame`, the aggregator isn't feeding system frames to strategies. Then have `PushToTalkStop` re-check `tuning.ptt_held` on every frame (audio frames arrive every 20 ms), and keep the test.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): backchannel-aware barge-in, sensitivity and push-to-talk turn strategies"`

### Task 6: Live providers, persona prompt and tools

**Files:**
- Create: `services/server/src/tassel/voice/flux.py`, `voice/providers.py`, `voice/prompts.py`, `voice/tools.py`
- Test: `services/server/tests/voice/test_providers.py`, `tests/voice/test_prompts.py`

**Interfaces:**
- Consumes:
  - `DeepgramFluxSTTService` (constructor `api_key, should_interrupt, settings`, and `Settings(model, language_hints, keyterm, eot_threshold, ...)`) ([flux stt.py][pc-flux], [stt_base.py][pc-flux-base]);
  - `DeepgramSTTService.Settings(model, language, interim_results, keyterm, smart_format, punctuate, ...)` ([stt.py][pc-nova]);
  - `OpenRouterLLMService(api_key, settings=Settings(model, max_tokens, temperature, extra))`. `extra` is passed into `chat.completions.create`, so body fields go in `extra={"extra_body": {...}}`, and a top-level `provider` raises ([openrouter llm.py][pc-openrouter], [07][res07]);
  - `ElevenLabsTTSService(api_key, settings=Settings(model, voice, language, ...))` ([elevenlabs tts.py][pc-elevenlabs]);
  - `FunctionSchema(name, description, properties, required)` and `ToolsSchema(standard_tools)` ([function_schema.py][pc-fn-schema], [tools_schema.py][pc-tools-schema]);
  - `Language` ([language.py][pc-language]);
  - the fakes from Tasks 3–4, and `VoiceSettings`, `VoiceRoute` and `resolve_mode` from Task 2.
- Produces:

```python
class TasselFluxSTTService(DeepgramFluxSTTService)
    # overrides _handle_start_of_turn(transcript) and _handle_update(transcript) (1.12.0 private hooks):
    # calls super(), then pushes InterimTranscriptionFrame(transcript, self._user_id, time_now_iso8601()) when non-empty
OPENROUTER_PROVIDER = {"only": ["cerebras"], "allow_fallbacks": False, "require_parameters": True}
REASONING_OFF = {"effort": "none"}
def flux_settings(route: VoiceRoute) -> DeepgramFluxSTTService.Settings
def nova_settings(route: VoiceRoute) -> DeepgramSTTService.Settings
def openrouter_settings(s: VoiceSettings) -> OpenRouterLLMService.Settings
def elevenlabs_settings(route: VoiceRoute, voice_id: str) -> ElevenLabsTTSService.Settings
def stt_kind(route: VoiceRoute, s: VoiceSettings) -> SttKind
def make_stt(route, s, scenario) -> STTService
def make_llm(route, s, scenario) -> LLMService
def make_tts(route, s) -> TTSService
LANGUAGE_NAMES = {"en": "English", "es": "Spanish", "ko": "Korean"}
LANGUAGE_SWITCH_PREFIX = "[language switch]"
def system_prompt(lang: Lang, tutor_name: str = "Ada") -> str
def language_switch_note(lang: Lang) -> str
SHOW_STAGE: FunctionSchema    # view: enum paper|board|split, required
SET_LANGUAGE: FunctionSchema  # language: enum en|es|ko, required
TOOLS = ToolsSchema(standard_tools=[SHOW_STAGE, SET_LANGUAGE])
```

- **`system_prompt`** is written in English, with an explicit output language (spec §5.9). It must contain:
  - "Reply only in {language}";
  - Ada's persona from spec §5.5: warm, patient and Socratic; asks before telling; no filler praise; "one or two short sentences" per turn;
  - "Never give the full solution unless the student asks";
  - the escalation ladder, climbed only when she asks or after a failed attempt;
  - "spell out" symbols, digits and state names as spoken words ("q zero", "one zero one zero");
  - no markdown, lists, emoji or links;
  - for ko: "polite 해요체";
  - when to call `show_stage` and `set_language`;
  - "greet briefly when the conversation starts";
  - and, on a message starting `[language switch]`, a short acknowledgement in the new language.
- **`language_switch_note(lang)`** is `"[language switch] The student switched the session language to {Language}. Reply only in {Language} from now on, starting with one short acknowledgement."`
- **Captions in live mode show the spoken form** ("one zero one zero"). Pairs of display and spoken text wait for P5's beats.

- [ ] **Step 1: Write the failing tests.**
  - `test_flux_settings`: for es, model `flux-general-multi`, `language_hints == [Language.ES]`, and `keyterm == list(route.keyterms)`.
  - `test_nova_settings_for_korean`: model `nova-3-general`, `language == Language.KO`, `interim_results is True`, and "수락 상태" in `keyterm`.
  - `test_openrouter_settings_pin_cerebras_and_turn_reasoning_off`:
    - model `qwen/qwen3.8-27b` and `max_tokens == 400`;
    - `extra == {"extra_body": {"provider": OPENROUTER_PROVIDER, "reasoning": {"effort": "none"}}}`;
    - no `response_format` anywhere in its dump.
  - `test_elevenlabs_settings`: model `eleven_flash_v2_5`, voice "v-ko", `language == Language.KO`.
  - `test_factories_pick_fake_or_live`: constructors only, so no network.
    - With default settings: `FakeSTTService`, `FakeLLMService`, `FakeTTSService`.
    - With every provider live and dummy keys and voices: `TasselFluxSTTService` for en, `DeepgramSTTService` for ko, `OpenRouterLLMService`, `ElevenLabsTTSService`.
  - `test_stt_kind`: fake gives `"fake"`; live gives `"flux"` for en and `"nova-3"` for ko.
  - `test_flux_bridge_pushes_interims`: with `push_frame` and `broadcast_frame` monkeypatched to record, `await stt._handle_update("wait")` and `await stt._handle_start_of_turn("uh")` each record one `InterimTranscriptionFrame` with that text; an empty transcript records none.
  - `test_prompt_rules[en|es|ko]`: the required phrases above, with `LANGUAGE_NAMES[lang]`; ko also contains "해요체".
  - `test_language_switch_note`: it starts with `LANGUAGE_SWITCH_PREFIX` and contains "Korean" for ko.
  - `test_tools`: the names are `["show_stage", "set_language"]`, with the enums above.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_providers.py tests/voice/test_prompts.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): live provider factories, Flux interim bridge, Ada's prompt and tools"`

### Task 7: The bot pipeline

**Files:**
- Create: `services/server/src/tassel/voice/memory.py`, `voice/events.py`, `voice/bot.py`
- Test: `services/server/tests/voice/test_memory.py`, `tests/voice/test_bot_pipeline.py`

**Interfaces:**
- Consumes:
  - `Pipeline([...])` ([pipeline.py][pc-pipeline]);
  - `PipelineWorker(pipeline, params=PipelineParams(...), observers=[...], idle_timeout_secs=...)`. It prepends `RTVIProcessor` itself (`enable_rtvi=None`) and wires `on_client_ready → set_bot_ready()`; it exposes `worker.rtvi`, and has `queue_frame`, `queue_frames` and `cancel(reason=)` ([worker.py][pc-worker]);
  - `WorkerRunner(handle_sigint=False)`, with `await runner.add_workers(worker); await runner.run()` ([runner.py][pc-runner]);
  - the RTVI processor's `on_client_ready(rtvi)` and `on_client_message(rtvi, msg)` (fields `msg_id`, `type`, `data`), and `send_server_message(data)`, which sends `server-message` ([processor.py][pc-rtvi-proc]). Its `send-text` handler interrupts the bot, flushes the pipeline and pushes `LLMMessagesAppendFrame([{"role": "user", ...}], run_llm=True)`;
  - client messages arrive as `InputTransportMessageFrame(message={"label": "rtvi-ai", "type", "id", "data"})` ([models.py][pc-rtvi-models]);
  - `RTVIServerMessageFrame(data=...)` ([rtvi frames.py][pc-rtvi-frames]);
  - `LLMContext(messages, tools)` and `LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(vad_analyzer, user_turn_strategies))` ([llm_context.py][pc-context], [llm_response_universal.py][pc-aggregator]);
  - `llm.register_function(name, handler)`, with handlers taking `FunctionCallParams` and returning through `result_callback(result, properties=FunctionCallResultProperties(run_llm=False))` ([llm_service.py][pc-llm]). A falsy result never re-runs the LLM, so return `{"ok": True}`;
  - `BaseObserver.on_push_frame(FramePushed)` ([base_observer.py][pc-observer]);
  - Tasks 2–6, and `sessions_repo.patch_for` from P1.
- Produces:

```python
class ConversationMemory:
    def __init__(self, *, ttl_s: float = 1800, max_messages: int = 40, clock: Callable[[], float] = time.monotonic)
    def recall(self, session_id: UUID) -> tuple[list[dict], Lang | None]       # ([], None) when absent or expired
    def remember(self, session_id: UUID, messages: list[dict], lang: Lang) -> None  # drops system messages, keeps the last max
class ServerEvents:
    def __init__(self, worker: PipelineWorker)
    async def send(self, event: BaseModel) -> None                             # worker.rtvi.send_server_message(envelope(event))
class VadForwarder(BaseObserver):  # first push of each VAD frame -> worker.queue_frame(RTVIServerMessageFrame(envelope(VadEvent)))
@dataclass
class BotContext:
    learner_id: UUID; session_id: UUID; lang: Lang; titled: bool; request: OfferRequestData
    settings: VoiceSettings; memory: ConversationMemory; sessions: async_sessionmaker[AsyncSession]
@dataclass
class Bot: worker: PipelineWorker; context: LLMContext; tuning: TurnTuning; events: ServerEvents; route: VoiceRoute; stt: SttKind
def build_bot(input: FrameProcessor, output: FrameProcessor, ctx: BotContext) -> Bot
async def run_bot(connection: SmallWebRTCConnection, ctx: BotContext) -> None
```

- **Pipeline:** `[input, stt, user_aggregator, llm, tts, output, assistant_aggregator]`. Task 9 inserts the activity processor after `stt`.
  - The services come from `make_stt`, `make_llm` and `make_tts` for `route_for(ctx.lang)`, with the tools registered on the LLM.
  - The user aggregator gets `LLMUserAggregatorParams(vad_analyzer=make_vad(), user_turn_strategies=make_turn_strategies(stt_kind, tuning, ctx.lang, on_ignored))`, with VAD on every route (P2-R2).
- **Worker:** `PipelineWorker(params=PipelineParams(enable_metrics=True, enable_usage_metrics=True, report_only_initial_ttfb=True), observers=[VadForwarder], idle_timeout_secs=1800)`. The scenario is `request.scenario` when it loads and the LLM is fake, else `settings.fake_scenario`. Tuning comes from `request.sensitivity` and `request.ptt`.
- **Context:** `[system_prompt(ctx.lang)]` plus the recalled messages, with `tools=TOOLS`.
- **On client ready:**
  - send `RouteEvent`;
  - with no memory, queue `LLMRunFrame()` (the greeting);
  - with memory in another language, queue `LLMMessagesAppendFrame([{"role": "user", "content": language_switch_note(ctx.lang)}], run_llm=True)`;
  - with memory in the same language, nothing: a resume doesn't re-greet.
- **On a client message** of type `ENVELOPE`, validate with `CLIENT_EVENTS`; invalid messages are logged and dropped.
  - `ptt`: set `tuning.ptt_held` and queue `PushToTalkFrame(held)`. Changing `enabled` mid-connection is ignored, per P2-R8.
  - `sensitivity`: set `tuning.sensitivity`.
  - `client-metrics`: handed to Task 10.
- **Tools:**
  - `show_stage` sends `StageEvent`.
  - `set_language` with a new language runs `sessions_repo.patch_for(db, learner_id, session_id, SessionPatch(language=...))`, then sends `LanguageEvent`.
  - Both return `{"ok": True}` with `run_llm=False`.
- **`on_ignored`** sends `BackchannelEvent`.
- **`run_bot`:**
  - builds `SmallWebRTCTransport(webrtc_connection=connection, params=TransportParams(audio_in_enabled=True, audio_out_enabled=True))` ([transport.py][pc-swrtc-transport], [base_transport.py][pc-transport-params]);
  - cancels the worker on the transport's `on_client_disconnected`;
  - runs it;
  - and in `finally`, remembers `context.messages` and calls `connection.disconnect()`.

- [ ] **Step 1: Write the failing tests.**
  - **memory:** `recall is empty for an unknown session`; `remember drops system messages and keeps the last 40`; `entries expire after the TTL` (fake clock); `recall returns the language they were spoken in`.
  - **pipeline:** these run `build_bot` with a pass-through input and an output recorder that keeps every frame, under `WorkerRunner`. The test drives RTVI by queueing `InputTransportMessageFrame`s: `client-ready` with `{"version": "2.1.0"}`, then `send-text` with `{"content": …, "options": {"run_immediately": true, "audio_response": true}}`. The recorder reads `server-message` payloads from the outgoing transport message frames. Then:
    - `test_greets_on_client_ready`: a `route` event `{lang en, stt fake, llm fake, tts fake}`, then `TTSAudioRawFrame`s and the greeting's text.
    - `test_typed_line_gets_the_scripted_reply`: the first student line gets turn 1's text.
    - `test_show_stage_sends_a_stage_event`: after turn 1, "I think that's it. …" sends `{"tassel": {"kind": "stage", "view": "split"}}`.
    - `test_set_language_patches_the_session_and_tells_the_client` (`db` fixture): "Can we continue in Korean?" leaves the row's language `ko` and sends a `language` event.
    - `test_ptt_message_updates_tuning`: a `client-message` of type `tassel` with data `{"kind": "ptt", "enabled": true, "held": true}` sets `bot.tuning.ptt_held`.
    - `test_bad_client_message_is_ignored`.
    - `test_memory_is_saved_when_the_bot_ends`: after `worker.cancel()`, recall holds the user line and the reply, and no system message.
    - `test_resume_does_not_greet_again`: a second bot on the same memory sends `route` but no greeting text.
    - `test_language_change_after_reconnect_acknowledges`: memory in en and the new bot in ko; the first reply is ko's `after_switch`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_memory.py tests/voice/test_bot_pipeline.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): per-session Pipecat pipeline with RTVI events, tools and conversation memory"`

### Task 8: Signaling API and the bot registry

**Files:**
- Create: `services/server/src/tassel/voice/api.py`, `voice/registry.py`
- Modify:
  - `services/server/src/tassel/app.py`: `create_app(settings=None, voice_settings=None)`; the lifespan checks the voice settings, builds the registry on `app.state.voice`, and shuts it down before disposing the engine; the router is included under `/v1`;
  - `services/server/tests/conftest.py`: the `client` fixture passes `voice_settings=VoiceSettings(_env_file=None)`, so a developer's `.env` never reaches tests;
  - `packages/shared/src/api/openapi.json` and `schema.d.ts` (regenerated).
- Test: `services/server/tests/voice/test_voice_api.py`, `tests/voice/test_voice_registry.py`

**Interfaces:**
- Consumes ([request_handler.py][pc-swrtc-handler], [connection.py][pc-swrtc-conn], [runner run.py][pc-run], [transport index.module.js L2941–2961][swt-js]):
  - `SmallWebRTCRequestHandler(ice_servers: list[IceServer] | None)`;
  - `await handle_web_request(SmallWebRTCRequest(sdp, type, pc_id, restart_pc, request_data), webrtc_connection_callback)`, which returns `{"sdp", "type", "pc_id"}`. A known `pc_id` renegotiates; `restart_pc=True` builds a new peer connection with a new `pc_id`; callback errors are only logged;
  - `await handle_patch_request(SmallWebRTCPatchRequest(pc_id, candidates=[IceCandidate(candidate, sdp_mid, sdp_mline_index)]))`, which raises 404 for an unknown `pc_id`;
  - `close()`;
  - `IceServer` (aiortc `RTCIceServer`).
  - The client sends `{sdp, type, pc_id, restart_pc, requestData}`. It PATCHes the same URL with the same `Headers`, as `{pc_id, candidates: [{candidate, sdp_mid, sdp_mline_index}]}`, every 200 ms.
  - `current_learner` and `sessions_repo.get_for` from P1; `run_bot` and `BotContext` from Task 7.
- Produces:

```python
class OfferBody(BaseModel):   # populate_by_name
    sdp: str; type: Literal["offer"]; pc_id: str | None = None; restart_pc: bool | None = None
    request_data: OfferRequestData | None = Field(None, alias="requestData")
class OfferAnswer(BaseModel): sdp: str; type: str; pc_id: str
class IceCandidateIn(BaseModel): candidate: str; sdp_mid: str; sdp_mline_index: int
class IcePatch(BaseModel): pc_id: str; candidates: list[IceCandidateIn]
class IceServerOut(BaseModel): urls: list[str]
class IceServersOut(BaseModel): ice_servers: list[IceServerOut]
# routes (all need the device token):
#   POST  /v1/sessions/{session_id}/voice/offer -> 200 OfferAnswer | 404 (missing or another learner's) | 409 (unknown or ended pc_id)
#   PATCH /v1/sessions/{session_id}/voice/offer -> 204 | 404
#   GET   /v1/voice/ice-servers                 -> IceServersOut from VoiceSettings.ice_servers
class VoiceConflict(Exception): ...
@dataclass
class LiveBot: session_id: UUID; pc_ids: set[str]; task: asyncio.Task
class VoiceRegistry:
    def __init__(self, *, settings: VoiceSettings, sessions: async_sessionmaker[AsyncSession], memory: ConversationMemory | None = None,
                 start_bot: Callable[[SmallWebRTCConnection, BotContext], Awaitable[None]] = run_bot)
    async def offer(self, *, learner_id: UUID, session: TutoringSession, body: OfferBody) -> OfferAnswer
    async def patch(self, *, learner_id: UUID, session_id: UUID, patch: IcePatch) -> None
    def live_bot(self, learner_id: UUID) -> LiveBot | None
    async def shutdown(self) -> None
```

- **`offer`** cases:
  - No `pc_id`: cancel the learner's live bot first (P2-R15), awaiting it for up to 5 s, then start a new one through the handler callback.
  - A `pc_id` that belongs to this learner's live bot: pass it to the handler (renegotiation, or an ICE restart on the same bot), and add the answer's `pc_id` to `pc_ids`.
  - Any other `pc_id`: `VoiceConflict` (409).
- **`patch`:** forwards only `pc_id`s owned by that learner and session; anything else is a 404.
- **`titled`** is `session.title is not None`.

- [ ] **Step 1: Write the failing tests.**
  - `test_offer_needs_a_device_token` (401).
  - `test_offer_for_another_learners_session_is_404`.
  - `test_offer_answers_and_starts_a_bot`:
    - An aiortc client: `pc = RTCPeerConnection(); pc.addTransceiver("audio", direction="sendrecv")`, then create an offer and set it as the local description.
    - POST `{sdp, type, requestData: {"sensitivity": "normal", "ptt": false}}`. The answer has type `answer` and a `pc_id`.
    - The injected `start_bot` received a `BotContext` with lang `en` and `titled is False`.
  - `test_real_bot_starts_and_stops_with_the_peer`: the default `start_bot` on fakes. The bot goes live within 5 s; after `pc.close()`, its task finishes within 5 s.
  - `test_second_offer_replaces_the_learners_bot`: the first task is cancelled, and `live_bot` points at the second session.
  - `test_restart_with_an_unknown_pc_is_409`.
  - `test_patch_unknown_pc_is_404` and `test_patch_forwards_candidates` (204).
  - `test_cors_preflight_allows_patch_from_the_app`: OPTIONS with `Origin: app://tassel`, `Access-Control-Request-Method: PATCH` and `Access-Control-Request-Headers: authorization,content-type` echoes the origin.
  - `test_ice_servers_from_settings`: `ice_servers=["stun:stun.l.google.com:19302"]` gives `{"ice_servers": [{"urls": ["stun:stun.l.google.com:19302"]}]}`.
  - `test_shutdown_cancels_bots`.
  - `test_startup_refuses_misconfigured_live_providers`: the lifespan with `VoiceSettings(_env_file=None, llm_provider="live")` raises `VoiceConfigError` naming `OPENROUTER_API_KEY`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_voice_api.py tests/voice/test_voice_registry.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement, then regenerate the API types.** Parse the body with `OfferBody` and convert it to `SmallWebRTCRequest`: FastAPI parsing the dataclass directly would expect `request_data` ([run.py][pc-run]). Run `pnpm gen:api`.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `uv run --directory services/server pytest -v && pnpm check:api`
  - Expected: PASS, then exit 0.
- [ ] **Step 5: Commit.** `git add services/server packages/shared/src/api && git commit -m "feat(voice): WebRTC offer and ICE routes with one live bot per learner"`

### Task 9: AI titles

**Files:**
- Create: `services/server/src/tassel/voice/titles.py`, `services/server/tests/voice/fixtures/openrouter-title.json`
- Modify: `services/server/src/tassel/storage/sessions_repo.py` (add `set_ai_title` and `touch`), `voice/bot.py` (insert `SessionActivity` after STT)
- Test: `services/server/tests/voice/test_titles.py`

**Interfaces:**
- Consumes: OpenRouter chat completions (`POST https://openrouter.ai/api/v1/chat/completions`). A forced named `tool_choice` is accepted by OpenRouter ([parameters][or-params]) and by Cerebras ([chat completions][cb-chat], [tool use][cb-tools]); whether OpenRouter forwards it to Cerebras unchanged is UNVERIFIED until Task 20. Tool-call arguments arrive as a JSON string in `choices[0].message.tool_calls[0].function.arguments`. Mid-stream and routing errors are documented in [errors][or-errors]. Also consumes `FakeScenario` (Task 4), `is_backchannel` (Task 5) and `ServerEvents` and `BotContext` (Task 7).
- Produces:

```python
@dataclass(frozen=True)
class TitleSuggestion: title: str; subject: str | None
class Titler(Protocol):
    async def suggest(self, text: str, lang: Lang) -> TitleSuggestion | None
TITLE_TOOL: dict   # {"type": "function", "function": {"name": "set_session_title", "parameters": {title: string, subject: string; both required}}}
def title_request(text: str, lang: Lang, *, model: str, tool_choice: Literal["named", "required"] = "named") -> dict
def parse_title_response(body: dict) -> TitleSuggestion | None
def clamp_suggestion(title: str, subject: str | None) -> TitleSuggestion | None
def is_substantive(text: str, lang: Lang) -> bool
class OpenRouterTitler:
    def __init__(self, *, api_key: SecretStr, model: str, client: httpx.AsyncClient | None = None, timeout_s: float = 8.0)
class FakeTitler:
    def __init__(self, scenario: FakeScenario)   # the scenario's title/subject, else the first 6 words, subject None
def make_titler(s: VoiceSettings, scenario: FakeScenario) -> Titler
class SessionActivity(FrameProcessor):
    def __init__(self, *, titler: Titler, ctx: BotContext, events: ServerEvents, max_attempts: int = 3,
                 touch_every_s: float = 30.0, clock: Callable[[], float] = time.monotonic)
# sessions_repo
async def set_ai_title(db, session_id: UUID, title: str, subject: str | None) -> TutoringSession | None
    # UPDATE … SET title, title_source='ai', subject=COALESCE(subject, :subject), last_activity_at=now() WHERE id=:id AND title IS NULL
async def touch(db, session_id: UUID) -> None
```

- **The request body:**
  - `model`;
  - `messages`: a system line in English ("Write a title of at most 6 words and a subject of at most 3 words for this tutoring session, in {Language}. No quotes, no final period.") and the student's words as the user message;
  - `tools: [TITLE_TOOL]`, and `tool_choice`: `{"type": "function", "function": {"name": "set_session_title"}}` or `"required"`;
  - `provider: OPENROUTER_PROVIDER`, `reasoning: {"effort": "none"}`, `max_tokens: 128`, `temperature: 0.2`;
  - no `response_format`.
- **The HTTP call:** headers `Authorization: Bearer …` and `X-OpenRouter-Title: Tassel`. A 400 or 404 whose body mentions "provider" or "parameter" retries once with `"required"`. Any other error or timeout returns None, and is logged without the key.
- **`clamp_suggestion`:**
  - strip whitespace, quotes and final `.,!?。`, and collapse spaces;
  - keep at most 6 words, then at most 80 characters, cut at a word boundary when there is one;
  - the subject keeps at most 3 words and 40 characters;
  - an empty title gives None, and an empty subject gives None.
- **`is_substantive`:** at least 3 words after stripping punctuation, not a backchannel, and not only greetings and her name (`hi, hello, hey, hola, buenas, 안녕하세요, 안녕, ada, 에이다`).
- **`SessionActivity`** watches final `TranscriptionFrame`s and user messages in `LLMMessagesAppendFrame` (typed lines).
  - On the first substantive one, while the session is untitled, it starts a background task: `suggest` → `set_ai_title` → send `TitleEvent` only if the row changed.
  - After a failure it tries again on the next substantive line, up to `max_attempts`.
  - It calls `touch` at most every `touch_every_s`.
  - It forwards every frame and never blocks the pipeline.
- **The fixture** is a non-streaming response whose `function.arguments` is `"{\"title\": \"Strings that start with 010\", \"subject\": \"Automata · DFA\"}"`, with `finish_reason: "tool_calls"`. It is built from OpenRouter's documented response shape, and Task 20 replaces it with a recorded response.

- [ ] **Step 1: Write the failing tests.**
  - `test_request_pins_cerebras_and_forces_the_tool`: the exact keys above; the named `tool_choice`; and `"response_format" not in body`.
  - `test_parse_the_fixture`: `TitleSuggestion("Strings that start with 010", "Automata · DFA")`.
  - `test_clamp`:
    - `clamp_suggestion('"Strings That Start With 010 And End Anywhere."', "Automata theory and DFAs")` gives `("Strings That Start With 010 And", "Automata theory and")`;
    - a 90-character Spanish title ends at or under 80 characters on a word boundary;
    - a Korean title of 7 eojeol keeps 6;
    - `clamp_suggestion("  ", None)` is None.
  - `test_substantive` is a table:
    - en: "Hi Ada" is False; the first demo line is True.
    - es: "Hola Ada" is False; "Estoy haciendo un AFD" is True.
    - ko: "네" is False; "DFA 문제 풀고 있어요" is True.
  - `test_titler_retries_with_required_when_named_is_refused`:
    - An `httpx.MockTransport` first answers 404 `{"error": {"code": 404, "message": "No allowed providers are available for the selected model"}}`, then the fixture.
    - The result is the suggestion, and the second request has `tool_choice == "required"`.
  - `test_titler_never_logs_the_key` (`caplog`, after a 500).
  - `test_set_ai_title_respects_a_student_title` (`db`):
    - A row with `title_source='student'` is unchanged, and the call returns None.
    - An untitled row gets `title_source='ai'` and the subject.
  - `test_titles_once_on_the_first_substantive_turn`:
    - `run_test(SessionActivity(FakeTitler(dfa-opening), …))` with final transcripts "Hi Ada", then the first demo line, then another long line.
    - One `TitleEvent` is sent, and the database row is titled.
  - `test_typed_lines_count_too`: an `LLMMessagesAppendFrame` with the demo line titles the session.
  - `test_gives_up_after_three_failures`: a titler that returns None is called exactly 3 times.
  - `test_touches_last_activity_at_most_every_30s` (fake clock).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_titles.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement, and insert `SessionActivity` into the pipeline in `bot.py`.**
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `uv run --directory services/server pytest -v`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): server-side AI titles through a forced tool call (title_source=ai)"`

### Task 10: Turn metrics and the latency report

**Files:**
- Create: `services/server/src/tassel/voice/metrics.py`, `voice/latency_report.py`
- Modify: `voice/bot.py` (add the observer; log `client-metrics` messages)
- Test: `services/server/tests/voice/test_metrics.py`, `tests/voice/test_latency_report.py`

**Interfaces:**
- Consumes: `FramePushed(source, destination, frame, direction, timestamp)`, where `timestamp` is pipeline-clock nanoseconds ([base_observer.py][pc-observer]); `VADUserStoppedSpeakingFrame.stop_secs` ([frames.py][pc-frames]). Pipecat's `UserBotLatencyObserver` covers only voice turns and is added only with tracing ([user_bot_latency_observer.py][pc-latency-obs]), so Tassel measures both kinds of turn in one place.
- Produces:

```python
class TurnMetricsObserver(BaseObserver):
    def __init__(self, *, lang: Lang, budget_ms: int, emit: Callable[[TurnMetrics], Awaitable[None]])
class MetricsLog:
    def __init__(self, path: Path | None)     # None: off; else one JSON line per record, appended
    def turn(self, session_id: UUID, m: TurnMetrics) -> None
    def client(self, session_id: UUID, lang: Lang, m: ClientMetricsEvent) -> None
@dataclass
class LangSummary:
    turns: int; client_ttfa_p50: int | None; client_ttfa_p90: int | None; server_ttfa_p50: int | None
    server_ttfa_p90: int | None; barge_in_p50: int | None; barge_in_p90: int | None; ttfa_budget_ms: int; within_budget: bool
def summarize(records: Iterable[dict]) -> dict[Lang, LangSummary]
def main(argv: list[str] | None = None) -> int   # python -m tassel.voice.latency_report <jsonl> [--strict]
```

- **A turn starts** at speech end, for a voice turn (the VAD stop push time minus `stop_secs`), or at an `LLMMessagesAppendFrame` with a user message, for a typed turn.
- **The fields:**
  - `stt_ms`: to the first finalized `TranscriptionFrame`.
  - `llm_ttfb_ms`: from the next `LLMContextFrame` to the first `LLMTextFrame`.
  - `tts_ttfb_ms`: from that first `LLMTextFrame` to the first `TTSAudioRawFrame`.
  - `server_ttfa_ms`: to `BotStartedSpeakingFrame`.
  - `interrupted`: an `InterruptionFrame` between `BotStartedSpeakingFrame` and `BotStoppedSpeakingFrame`.
- **It emits** at `BotStoppedSpeakingFrame`, or when the next turn starts.
- **Each frame counts once** (by `frame.id`), however many hops it crosses.
- **`summarize`:**
  - percentiles use the nearest rank;
  - `within_budget` means the client p90 of first audio (or the server p90, when no client data exists) is at or under the budget, and the barge-in p90 is at or under 300 when there is any.
  - `--strict` exits 1 when any language misses.
- **The log path** is `VoiceSettings.voice_metrics_log` (`TASSEL_VOICE_METRICS_LOG`).

- [ ] **Step 1: Write the failing tests.** Synthetic `FramePushed` sequences, in seconds:
  - `test_voice_turn`:
    - Timeline: VAD stop at 1.00 (`stop_secs` 0.2, so speech ended at 0.80), final transcript 1.05, context 1.06, first LLM text 1.30, first audio 1.45, bot started 1.50, bot stopped 3.0.
    - Result: `TurnMetrics(turn=1, lang="en", input="voice", stt_ms=250, llm_ttfb_ms=240, tts_ttfb_ms=150, server_ttfa_ms=700, interrupted=False, budget_ms=1200)`.
  - `test_typed_turn`: append at 5.0 and bot started at 5.6 give `input="typed"`, `server_ttfa_ms=600` and `stt_ms=None`.
  - `test_interrupted_turn`.
  - `test_duplicate_pushes_count_once`.
  - `test_summarize`: client first-audio values [800, 900, 1000, 1300, 1100] give p50 1000, p90 1300, and `within_budget` False for en (budget 1200).
  - `test_strict_exit_code`: 1 when over budget, 0 when within.
  - `test_log_writes_json_lines` (`tmp_path`).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_metrics.py tests/voice/test_latency_report.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement, and wire the observer.** In `bot.py`, the observer emits a `TurnMetricsEvent` through `ServerEvents` and to `MetricsLog.turn`; `client-metrics` messages go to `MetricsLog.client`.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `uv run --directory services/server pytest -v && uv run --directory services/server ruff check`
  - Expected: PASS, then clean.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): per-turn latency metrics, JSONL log and budget report"`

### Task 11: Mic capture and Tassel's media manager

**Files:**
- Modify:
  - `apps/desktop/package.json`: devDependencies `"@pipecat-ai/client-js": "1.14.0"` and `"@pipecat-ai/small-webrtc-transport": "1.11.0"`, exact, bundled like every renderer dependency;
  - `pnpm-lock.yaml`;
  - `pnpm-workspace.yaml`: release-age exclusions, if pnpm writes them (Global Constraints).
- Create: `apps/desktop/src/renderer/src/tutor/live/mic.ts`, `tutor/live/media-manager.ts`
- Test: `apps/desktop/tests/unit/live/mic.test.ts`, `tests/unit/live/media-manager.test.ts` (jsdom, with fake `MediaDevices` and Web Audio)

**Interfaces:**
- Consumes: the `MediaManager` shape of small-webrtc-transport 1.11.0 ([mediaManager.ts][mm-src]). The transport ([source][swt-src]) behaves like this:
  - `initialize()` runs from `initDevices()`, and `connect()` before every new peer connection.
  - After `connect()`, it reads `tracks().local.audio` and calls `getTransceivers()[0].sender.replaceTrack(track)`.
  - It reads `isMicEnabled`, `isCamEnabled`, `supportsScreenShare` and `isSharingScreen`.
  - `enableMic(b)` also sends a `trackStatus` signalling message.
  - `stop()` stops every sender track, then calls `disconnect()`.
  - It never calls `setUserAudioCallback`, `bufferBotAudio` or `interruptBotAudio`.
  - The client marks the mic as granted only once `initialize()` reports `onMicUpdated(info)` with a real `deviceId`.
  - Also consumes `MicStatus` (Task 1).
- Produces:

```ts
export interface MicOptions { deviceId: string | null; processing: boolean }   // processing=false only for the E2E fake mic
export interface MicDeps {
  media: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices' | 'addEventListener' | 'removeEventListener'>;
  createContext(): AudioContext;
}
export type MicChange = { type: 'status'; status: MicStatus } | { type: 'device-lost'; deviceId: string };
export class Mic {
  constructor(deps: MicDeps);
  open(opts: MicOptions): Promise<MicStatus>;
  sendTrack(): MediaStreamTrack | null;            // MediaStreamAudioDestinationNode track; a fresh one once the last was stopped
  setDevice(deviceId: string | null): Promise<MicStatus>;   // swaps the source node; the sent track stays the same object
  setEnabled(on: boolean): void;                   // dock mute
  setGate(open: boolean): void;                    // push-to-talk; sent gain = enabled && gate
  level(): number;                                 // RMS 0..1 before the gains (meter, latency)
  readonly status: MicStatus; readonly deviceId: string | null; readonly openedAt: number | null;  // performance.now() at first open
  on(listener: (e: MicChange) => void): () => void;
  close(): void;
}
export interface MediaManagerShape { /* every member of mediaManager.ts at small-webrtc-transport-v1.11.0 */ }
export interface SpeakerLike { setSinks(s: { primary: string | null; presenter: string | null }): Promise<unknown>; readonly presenterSinkId: string | null }
export class TasselMediaManager implements MediaManagerShape {
  constructor(mic: Mic, speaker: SpeakerLike, options: () => MicOptions);   // Task 12's Speaker satisfies SpeakerLike
}
export function asTransportMediaManager(m: TasselMediaManager): unknown;   // the cast, documented (P2-R3)
```

- **The graph:** capture source → analyser (level) → enabled gain → gate gain → destination (the sent track).
- **`open`** calls `getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: p, noiseSuppression: p, autoGainControl: p, channelCount: 1 } })`.
  - `NotAllowedError` gives `denied`.
  - `NotFoundError` or `OverconstrainedError` on a saved id retries the default once, then gives `unavailable`.
- **On `devicechange`,** if the open device is gone, it reopens the default and emits `device-lost`.
- **The manager:**
  - `initialize()` opens the mic (idempotent) and reports `onMicUpdated`.
  - `connect()` makes sure `sendTrack()` is live.
  - `tracks()` returns `{ local: { audio: mic.sendTrack() ?? undefined } }`.
  - It reports no cameras and no screen share.
  - `updateMic` goes to `mic.setDevice`, and `updateSpeaker` to `speaker.setSinks({ primary: id, presenter: speaker.presenterSinkId })`.
  - A denied mic still lets `connect()` resolve: the transport then sends no audio, receive-only.

- [ ] **Step 1: Write the failing tests.**
  - `opens with echo cancellation, noise suppression and auto gain`, and `deviceId: { exact: 'mic-2' }` when one is given.
  - `the fake mic turns processing off`.
  - `denied permission resolves to denied, not a throw`.
  - `a missing saved device falls back to the default once`.
  - `switching devices keeps the same sent track and stops the old capture` (Review Focus 1).
  - `gates multiply`: the enabled gain × the gate gives 0 or 1 on the fake `GainNode`.
  - `unplugging the open mic reopens the default and reports device-lost` (Review Focus 1).
  - `a stopped sent track is replaced on the next sendTrack()`.
  - `the manager implements every member the 1.11.0 transport reads`: a fixed list of names, each a function or getter.
  - `tracks().local.audio is the mic's sent track`.
  - `initialize reports onMicUpdated with the device id`.
  - `enableMic(false) mutes`.
  - `updateSpeaker sets the primary sink`.
  - `no cameras, no screen share`.
  - `a denied mic still lets connect() resolve` (Review Focus 3).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm install && pnpm --filter @tassel/desktop test live/mic live/media-manager`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror the shape of the transport's own test helper ([fakeMediaManager.ts][fake-mm]).
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop pnpm-lock.yaml pnpm-workspace.yaml && git commit -m "feat(voice-client): Web Audio mic and Tassel's media manager for SmallWebRTC"`

### Task 12: Bot audio output: primary and presenter sinks, ducking, level

**Files:**
- Create: `apps/desktop/src/renderer/src/tutor/live/speaker.ts`
- Test: `apps/desktop/tests/unit/live/speaker.test.ts`

**Interfaces:**
- Consumes: `HTMLMediaElement.setSinkId` (Chrome 49) and `new AudioContext({ sinkId })` (Chrome 110) ([MDN setSinkId][mdn-setsinkid], [MDN AudioContext][mdn-ac]). Electron routes a non-default output through `setPermissionCheckHandler`, as `'media'` and as `'speaker-selection'`. P1's handler already allows both for the app's origin.
- Produces:

```ts
export interface Sinks { primary: string | null; presenter: string | null }   // primary null = system default; presenter null = off
export interface SpeakerDeps { createAudio(): HTMLAudioElement; createContext(opts?: { sinkId?: string }): AudioContext }
export class Speaker {
  constructor(deps: SpeakerDeps);
  attach(track: MediaStreamTrack): void;
  setSinks(s: Sinks): Promise<{ primary: 'ok' | 'fallback'; presenter: 'ok' | 'fallback' | 'off' }>;
  duck(on: boolean): void;            // 0.25 on the element and the presenter gain (60 ms ramp); 1 when off
  onDuck(listener: (on: boolean, atMs: number) => void): () => void;   // atMs = performance.now(), for LatencyMeter.markDuck
  level(): number;                    // bot RMS 0..1
  readonly element: HTMLAudioElement; // data-testid="tutor-audio", data-presenter-sink="<id or empty>", hidden in document.body
  readonly presenterSinkId: string | null;
  dispose(): void;
}
```

- `attach` sets `element.srcObject = new MediaStream([track])` and plays it. When presenter is on, it also feeds `createMediaStreamSource(stream)` → gain → the presenter context's destination.
- The element stays attached and playing, because remote WebRTC audio is silent in Web Audio otherwise ([crbug 40094084][crbug-webaudio]).
- A presenter sink equal to the primary is refused, as `off`.

- [ ] **Step 1: Write the failing tests.**
  - `plays the bot track on the primary sink`.
  - `presenter mode adds an AudioContext on the second sink and keeps the element playing`.
  - `a failing setSinkId falls back to the default` (Review Focus 1).
  - `turning presenter off closes its context`.
  - `the same device for both is refused`.
  - `duck lowers both outputs and restores them`.
  - `duck notifies listeners once per change, with the time`.
  - `dispose stops playback and closes every context`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test live/speaker`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(voice-client): speaker with presenter sink, ducking and level"`

### Task 13: RTVI mapping and the live tutor client

**Files:**
- Create: `apps/desktop/src/renderer/src/tutor/live/rtvi-map.ts`, `tutor/live/live-client.ts`
- Test: `apps/desktop/tests/unit/live/rtvi-map.test.ts`, `tests/unit/live/live-client.test.ts`

**Interfaces:**
- Consumes ([client-js d.ts][cj-dts], [client-js js][cj-js], [transport source][swt-src]):
  - `new PipecatClient({ transport, enableMic: true, enableCam: false })`;
  - `connect({ webrtcRequestParams: { endpoint, headers: Headers, requestData, timeout } })`, which resolves on bot-ready;
  - `disconnect()`;
  - `sendText(content, { run_immediately, audio_response })`, which returns `Promise<string>`;
  - `sendClientMessage(type, data)`;
  - `on(RTVIEvent.X, handler)`;
  - `new SmallWebRTCTransport({ mediaManager, iceServers, waitForICEGathering: false })`;
  - the events:
    - `TransportStateChanged(state)`, `BotReady`, `Disconnected`, `Error(message)`;
    - `UserStartedSpeaking`, `UserStoppedSpeaking`, `BotStartedSpeaking`, `BotStoppedSpeaking`;
    - `UserTranscript({ text, final })` (deprecated, but what a 1.12.0 server produces) and `UserInput({ text, final })`;
    - `BotOutput({ text, spoken_status?, spoken_progress?: { accumulated_text } })`;
    - `ServerMessage(data)`;
    - `TrackStarted(track, participant?)`, which fires for the bot's remote track on unmute, with no participant.
  - The transport rebuilds the peer connection itself on ICE failure, does a full rebuild 5 s after `disconnected`, and retries a failed offer after 2 s, stopping at once on a 4xx. When it gives up, it ends in state `error` and fires `Disconnected`; there is no reconnecting event.
  - Also consumes `parseServerEvent`, `voiceOfferPath`, `OfferRequestData` and `ClientMetrics` (Task 1); `Mic` and `TasselMediaManager` (Task 11); `Speaker` (Task 12); and `TutorClient`, `TutorEvent` and `VoiceControls` (P1 and Task 1).
- Produces:

```ts
export type RtviInput =
  | { kind: 'transport'; state: TransportState } | { kind: 'bot-ready' }
  | { kind: 'user-started' } | { kind: 'user-stopped' } | { kind: 'bot-started' } | { kind: 'bot-stopped' }
  | { kind: 'user-text'; text: string; final: boolean }
  | { kind: 'bot-output'; text: string; accumulated?: string }
  | { kind: 'server'; data: unknown };
export type Effect = { type: 'duck'; on: boolean } | { type: 'reconnect' };
export interface MapState { lang: Lang; botSpeaking: boolean; tutorLine: string }
export function initialMapState(lang: Lang): MapState;
export function mapRtvi(state: MapState, input: RtviInput): { state: MapState; events: TutorEvent[]; effects: Effect[] };
export interface PipecatLike { connect(p: unknown): Promise<unknown>; disconnect(): Promise<void>; on(e: string, h: (...a: any[]) => void): unknown;
  sendText(t: string, o?: object): Promise<string>; sendClientMessage(t: string, d?: unknown): void }
export interface LiveClientDeps {
  serverUrl: string; getToken(): Promise<string>; getIceServers(): Promise<RTCIceServer[]>;
  mic: Mic; speaker: Speaker; micOptions(): MicOptions; offerData(): OfferRequestData; lang(): Lang;
  createPipecat?(transport: unknown): PipecatLike; backoffMs?: number[]; clock?: Clock;   // backoff default [1000, 2000, 4000]
}
export class LiveTutorClient implements TutorClient {
  constructor(deps: LiveClientDeps);
  connect(sessionId: string): Promise<void>; disconnect(): Promise<void>;
  on(listener: (e: TutorEvent) => void): () => void; sendText(text: string): void;
  readonly voice: VoiceControls;
}
```

- **`mapRtvi` rules** (exact):

  | Input | Output |
  |---|---|
  | `transport` before ready | `connection connecting`, `state connecting` |
  | `bot-ready` | `connection connected`, `state listening` |
  | `user-started` | `state listening` |
  | `user-stopped` | `state thinking` |
  | `bot-started` | `state speaking`; clears `tutorLine` |
  | `bot-stopped` | `state listening`; a non-empty `tutorLine` becomes a final tutor caption; `duck off` |
  | `user-text` | a student caption with its `final` and `lang` |
  | `bot-output` | uses `accumulated ?? text` as an interim tutor caption; each word added since the last update becomes a `word` event |

  `server` data goes through `parseServerEvent`:

  | Server event | Output |
  |---|---|
  | `title` | `title` |
  | `stage` | `stage` with `mode = view` |
  | `language` | `language`, then effect `reconnect` (state lang updated) |
  | `vad` speaking while the bot speaks | `duck on` |
  | `vad` not speaking | `duck off` |
  | `backchannel` | `voice-debug`, then `duck off` |
  | `route`, `turn-metrics` | `voice-debug` |

  Anything else maps to nothing.
- **`LiveTutorClient`:**
  - **`connect(id)`:**
    1. emit `connection connecting`;
    2. `mic.open(micOptions())`, then emit `mic <status>`;
    3. fetch the ICE servers;
    4. build the transport and client;
    5. `connect` with endpoint `serverUrl + voiceOfferPath(id)`, `headers: new Headers({ Authorization: 'Bearer ' + token })`, `requestData: offerData()` and `timeout: 15000`.
  - **Reconnect:** an unrequested `Disconnected`, or the state `error`, gives `connection reconnecting` with `attempt`. After the backoff it does a full new connect, with a new transport and client. After 3 failures it emits `connection failed`; `voice.reconnect()` resets the count.
  - **`disconnect()`** never reconnects and emits `connection closed`. The mic and speaker belong to the caller.
  - **`sendText`** emits a final student caption at once (P1's contract), then calls `sendText(text, { run_immediately: true, audio_response: true })`.
  - **`voice.setTalking(held)`:** `mic.setGate(held)`, then `sendClientMessage('tassel', { kind: 'ptt', enabled: true, held })`.
  - **`voice.setSensitivity` and `voice.reportClientMetrics`** send their `ClientEvent`s.
  - **`voice.connectionCount`** counts successful connects.
  - **Audio:** a `TrackStarted` of kind audio goes to `speaker.attach`; `duck` effects go to `speaker.duck`.

- [ ] **Step 1: Write the failing tests.**
  - **rtvi-map:**
    - `a turn runs listening → thinking → speaking → listening`;
    - `interim tutor captions grow and end final on bot-stopped`;
    - `spoken progress becomes word events, one per new word`;
    - `a UserTranscript and a UserInput both become student captions`;
    - `server events map as in the table`;
    - `vad ducks only while she speaks`;
    - `garbage server data maps to nothing`.
  - **live-client** (a fake `PipecatLike`, a manual clock):
    - `connects with bearer Headers, requestData and a 15 s timeout`;
    - `a typed line shows at once and goes out as send-text with run_immediately`;
    - `a bot audio track goes to the speaker`;
    - `an unrequested disconnect reconnects after 1, 2 and 4 s, then reports failed` (Review Focus 4);
    - `an intentional disconnect never reconnects`;
    - `a language event reconnects`;
    - `ptt, sensitivity and metrics messages use the tassel envelope`;
    - `a denied mic still connects and emits mic denied` (Review Focus 3).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test live/rtvi-map live/live-client`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run the same command plus `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(voice-client): live TutorClient over SmallWebRTC with RTVI mapping and reconnects"`

### Task 14: Audio preferences, device pickers and push-to-talk

**Files:**
- Modify: `apps/desktop/package.json` (`@radix-ui/react-popover` `1.3.1`, `@radix-ui/react-select` `2.4.1`, `@radix-ui/react-switch` `1.4.1`, exact), `pnpm-lock.yaml`, `packages/shared/src/i18n/{en,es,ko}.json` (the `voice.settings.*`, `voice.device.*` and `voice.mic.holdSpace` keys)
- Create: `apps/desktop/src/renderer/src/features/voice/audio-prefs.ts`, `features/voice/devices.ts`, `features/voice/AudioSettings.tsx`, `tutor/live/push-to-talk.ts`
- Test: `apps/desktop/tests/unit/live/audio-prefs.test.ts`, `tests/unit/live/devices.test.ts`, `tests/unit/live/audio-settings.test.tsx`, `tests/unit/live/push-to-talk.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AudioPrefs { inputId: string | null; outputId: string | null; presenter: boolean;
  presenterOutputId: string | null; pushToTalk: boolean; sensitivity: Sensitivity }
export const DEFAULT_AUDIO_PREFS: AudioPrefs;   // all null/false, sensitivity 'normal'
export const useAudioPrefs: UseBoundStore<StoreApi<AudioPrefs & {
  set(p: Partial<AudioPrefs>): void; setPresenter(on: boolean, outputId?: string | null): void; reset(): void }>>;  // zustand persist 'tassel.audio-prefs', v1
export function resolveDevice(saved: string | null, devices: MediaDeviceInfo[], kind: 'audioinput' | 'audiooutput'):
  { id: string | null; lost: boolean };
export function useAudioDevices(media?: MediaDevices): { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; refresh(): Promise<void> };
export function AudioSettings(props: { open: boolean; onOpenChange(open: boolean): void; trigger: ReactNode }): JSX.Element;
export function bindPushToTalk(target: Window, onHeld: (held: boolean) => void): () => void;
```

- **`setPresenter(true, id)`** sets presenter mode, its output, `pushToTalk: true` and `sensitivity: 'low'` (P2-R6). `setPresenter(false)` sets only `presenter: false`.
- **`AudioSettings`** is a Radix Popover holding:
  - Microphone and Speaker selects: "System default", then the devices. An empty label shows as "Microphone {n}" or "Speaker {n}".
  - A Presenter switch. When it's on, a "Room output" select appears, without the primary output.
  - A Push-to-talk switch, with the hint "Hold Space while you talk."
  - An Interruptions `SegmentedControl` (Fewer · Normal · Instant), with the hint: short replies like "uh-huh" never interrupt Ada, except on Instant.
  - A device-lost line, when `resolveDevice` reports `lost`.
- **`bindPushToTalk`:**
  - On keydown of `code === 'Space'`, with no modifiers, not a repeat, and not in `input`, `textarea`, `select` or `[contenteditable]`: `preventDefault`, then `onHeld(true)` once.
  - On keyup: `onHeld(false)`, also with `preventDefault`, so a focused button never clicks.
  - On `blur` or `visibilitychange` to hidden: `onHeld(false)`, if held.
- **English copy** (es and ko written naturally, ko in polite 해요체):
  - `voice.settings.title` "Audio", `voice.settings.open` "Audio settings";
  - `voice.settings.input` "Microphone", `voice.settings.output` "Speaker", `voice.settings.systemDefault` "System default";
  - `voice.settings.presenter` "Presenter mode", `voice.settings.presenterHint` "Ada also plays on a second output, like room speakers. Push-to-talk turns on, because room speakers echo.", `voice.settings.presenterOutput` "Room output";
  - `voice.settings.pushToTalk` "Push-to-talk", `voice.settings.pushToTalkHint` "Hold Space while you talk.";
  - `voice.settings.sensitivity` "Interruptions", `voice.settings.sensitivity.low|normal|high` "Fewer|Normal|Instant", `voice.settings.sensitivityHint`;
  - `voice.device.lost` "{device} was disconnected. Using the system default.";
  - `voice.mic.holdSpace` "Hold Space to talk".

- [ ] **Step 1: Write the failing tests.**
  - **prefs:**
    - `presenter mode turns on push-to-talk and fewer interruptions`;
    - `turning presenter off leaves push-to-talk as she set it`;
    - `prefs persist across reloads` (the jsdom store rehydrates).
  - **devices:**
    - `resolveDevice keeps a present device`;
    - `a vanished device falls back to the default and is lost` (Review Focus 1);
    - `null means system default, not lost`;
    - `devicechange refreshes the lists`.
  - **AudioSettings** (jsdom; Testing Library):
    - `lists inputs and outputs with fallback labels`;
    - `choosing a speaker saves outputId`;
    - `the room output list excludes the primary output`;
    - `sensitivity and push-to-talk save`;
    - `controls have accessible names in ko`;
    - `shows the device-lost notice`.
  - **push-to-talk** (Review Focus 2):
    - `hold and release`;
    - `repeats call onHeld once`;
    - `Space in an input types and never holds`;
    - `blur releases`;
    - `a hidden document releases`;
    - `Space on a focused button doesn't click it while bound`;
    - `modifiers are ignored`;
    - `unbind removes every listener`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test live/audio-prefs live/devices live/audio-settings live/push-to-talk`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Before writing UI, read `docs/design-system/DESIGN.md` and `.impeccable/mocks/decision/stage.html` (pills, hairline borders, no shadows, 12–16 px radii).
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `pnpm --filter @tassel/desktop test && pnpm check:i18n && pnpm --filter @tassel/desktop typecheck`
  - Expected: PASS, then exit 0.
- [ ] **Step 5: Commit.** `git add apps/desktop packages/shared/src/i18n pnpm-lock.yaml && git commit -m "feat(voice-client): audio settings, device pickers, presenter mode and push-to-talk"`

### Task 15: Latency meter, HUD and developer console

**Files:**
- Create: `apps/desktop/src/renderer/src/tutor/live/latency.ts`, `features/voice/voice-debug.ts`, `features/voice/LatencyHud.tsx`, `features/voice/DevConsole.tsx`
- Modify: `packages/shared/src/i18n/{en,es,ko}.json` (`voice.hud.*` and `voice.dev.*`)
- Test: `apps/desktop/tests/unit/live/latency.test.ts`, `tests/unit/live/latency-hud.test.tsx`, `tests/unit/live/dev-console.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface MeterThresholds { micOn: number; micOff: number; botOn: number; botOff: number; micOnMs: number; micOffMs: number; botOffMs: number }
// defaults: 0.02, 0.01, 0.01, 0.005, 40, 300, 60
export class LatencyMeter {
  constructor(t?: Partial<MeterThresholds>);
  sample(atMs: number, micRms: number, botRms: number): ClientMetrics | null;
  markDuck(atMs: number): void;
}
export function percentile(values: number[], p: number): number | null;   // nearest rank
export function startLatencySampler(o: { mic: Pick<Mic, 'level'>; speaker: Pick<Speaker, 'level'>; meter: LatencyMeter;
  onMetrics(m: ClientMetrics): void; intervalMs?: number; now?: () => number }): () => void;   // 20 ms
export const useVoiceDebug: UseBoundStore<StoreApi<{ route: RouteEvent | null; turns: TurnMetrics[]; client: ClientMetrics[];
  backchannels: number; connections: number; micOpenedAt: number | null; push(e: VoiceDebugEvent): void;
  setMicOpenedAt(t: number | null): void; reset(): void }>>;
export function LatencyHud(): JSX.Element;
export function DevConsole(props: { onSend(text: string): void }): JSX.Element;
```

- **`LatencyMeter`** watches two signals.
  - **The mic:** speech starts after `micOnMs` above `micOn`. It ends at the first sample below `micOff` that stays below for `micOffMs`.
  - **Bot audio:** it starts at the first sample above `botOn`. It goes silent at the first sample below `botOff` that stays below for `botOffMs`.

  It reports in two cases.
  - **First audio:** mic speech ends while bot audio is quiet, and bot audio then starts within 10 s. It returns `{ ttfa_ms: botOnset − speechEnd }`.
  - **Barge-in:** mic speech starts while bot audio plays, and bot audio goes silent within 2 s. It returns `{ barge_in_ms: silentAt − micOnset, yield_ms: duckAt − micOnset }`; `yield_ms` is null without a duck. If bot audio keeps playing past 2 s, it was a backchannel and nothing is reported.
- **`LatencyHud`** is mono, top-left of the stage. Its `data-testid` hooks are `hud-route`, `hud-first-audio`, `hud-barge-in`, `hud-backchannels`, `hud-connections` and `hud-mic-opened-at`.
  - The route reads like `EN · FAKE · FAKE · FAKE`.
  - `hud-first-audio` shows the latest client `ttfa_ms`. For a typed turn, which has no mic speech to time, it shows that turn's `server_ttfa_ms`, labelled "server".
  - It shows the last first-audio and barge-in times against their budgets (`VOICE_BUDGETS`), and the session p50/p90.
  - It shows the last turn's server breakdown (STT, LLM, TTS) and the counts of backchannels and connections.
  - A value over budget uses `text-live`.
- **`DevConsole`** is a labelled text field with Send. Enter sends; whitespace-only input is ignored; it clears after sending.
- **English copy:**
  - `voice.hud.title` "Latency", `voice.hud.firstAudio` "First audio", `voice.hud.bargeIn` "Barge-in", `voice.hud.budget` "Budget {ms} ms";
  - `voice.hud.backchannels` "Backchannels ignored", `voice.hud.connections` "Connections";
  - `voice.dev.placeholder` "Type what the student says", `voice.dev.send` "Send".

- [ ] **Step 1: Write the failing tests.**
  - `first audio`:
    - Mic samples run 0.1 RMS from 0 to 1000 ms, then 0, every 20 ms; bot audio runs from 1900 ms.
    - Result: `{ ttfa_ms: 900, barge_in_ms: null, yield_ms: null }`.
  - `barge-in`:
    - Bot audio plays throughout; the mic starts at 5000 ms; `markDuck(5250)`; bot audio is quiet from 5420 ms.
    - Result: `{ barge_in_ms: 420, yield_ms: 250 }`.
  - `a backchannel reports nothing`: the mic runs 5000–5300 ms while bot audio continues past 7000 ms.
  - `mic blips under 40 ms are ignored`.
  - `percentile`: [800, 900, 1000, 1100, 1300] gives p50 1000 and p90 1300; [] gives null.
  - `the HUD marks over-budget values`: a client `ttfa_ms` of 1500 in en gets the `text-live` class.
  - `the HUD shows the route`.
  - `the dev console sends trimmed text on Enter and ignores blanks`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test live/latency live/latency-hud live/dev-console`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `pnpm --filter @tassel/desktop test && pnpm check:i18n`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop packages/shared/src/i18n && git commit -m "feat(voice-client): client latency meter, HUD and developer console"`

### Task 16: Desktop media plumbing and audio fixtures

**Files:**
- Create: `apps/desktop/src/main/voice/switches.ts`, `main/voice/mic-access.ts`, `main/voice/ipc.ts`, `apps/desktop/src/shared/voice-bridge.ts`
- Modify (one-line hooks):
  - `main/index.ts`: `applyVoiceSwitches(app.commandLine)` before `whenReady`, and `registerVoiceIpc({ access: createMicAccess(...), config: readVoiceConfig() })` after it;
  - `main/windows.ts`:
    - `webPreferences.backgroundThrottling: false`, so the voice loop's timers keep running when the window is covered; the default is true ([webPreferences][el-webprefs]);
    - `restrictPermissions` denies `media` when the fake access is `denied`;
  - `preload/index.ts`: expose `voice`;
  - `shared/bridge.ts`: `voice: VoiceBridge` on `TasselBridge`.
- Create: `apps/desktop/tests/fixtures/audio/timelines.json`, `tests/fixtures/audio/make-fixtures.mjs`, and the committed WAVs `silence`, `barge-in-en`, `barge-in-ko`, `ptt-en`, `dfa-en`, `dfa-es` and `dfa-ko`
- Modify: `apps/desktop/tests/e2e/fixtures.ts` (`launchVoice`), `tests/e2e/global-setup.ts` (the server env below)
- Test: `apps/desktop/tests/unit/voice-main/switches.test.ts`, `voice-main/mic-access.test.ts`, `voice-main/fixtures.test.ts`, `tests/unit/windows.test.ts` (extend), `tests/e2e/fake-mic.spec.ts`

**Interfaces:**
- Consumes:
  - `app.commandLine.appendSwitch` before ready ([command-line switches][el-cmdline]). Chromium copies `use-fake-device-for-media-stream` and `use-file-for-fake-audio-capture` from the browser process's command line into the audio service, and `%noloop` plays the file once ([media_switches.cc][cr-switches]);
  - `systemPreferences.getMediaAccessStatus('microphone')` (macOS, Windows) and `askForMediaAccess('microphone')` (macOS only) ([systemPreferences][el-sysprefs]);
  - `shell.openExternal`;
  - P1's `isTrustedUrl` and IPC pattern.
- Produces:

```ts
// shared/voice-bridge.ts
export type MicAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
export interface VoiceConfig { devTools: boolean; fakeMic: boolean; devConsole: boolean }  // devTools = !app.isPackaged; devConsole = TASSEL_DEV_CONSOLE === '1'
export interface VoiceBridge { getConfig(): Promise<VoiceConfig>; micAccess(): Promise<MicAccess>; askMicAccess(): Promise<MicAccess>; openMicSettings(): Promise<void> }
export const VOICE_IPC = { getConfig: 'voice:getConfig', micAccess: 'voice:micAccess', askMicAccess: 'voice:askMicAccess', openMicSettings: 'voice:openMicSettings' } as const;
// main/voice/switches.ts
export function voiceSwitches(env: NodeJS.ProcessEnv, packaged: boolean, exists?: (p: string) => boolean): Array<[string] | [string, string]>;
export function applyVoiceSwitches(cmd: { appendSwitch(n: string, v?: string): void }, env?: NodeJS.ProcessEnv, packaged?: boolean): void;
// main/voice/mic-access.ts
export function micSettingsUrl(platform: NodeJS.Platform): string | null;
export function createMicAccess(deps: { platform: NodeJS.Platform; prefs: Pick<SystemPreferences, 'getMediaAccessStatus' | 'askForMediaAccess'>;
  fake?: 'granted' | 'denied' | 'not-determined'; open(url: string): Promise<void> }): { status(): MicAccess; ask(): Promise<MicAccess>; openSettings(): Promise<void> };
// main/voice/ipc.ts: one ipcMain.handle per VOICE_IPC channel, each refusing senders that fail isTrustedUrl (P1's pattern)
export function registerVoiceIpc(deps: { access: ReturnType<typeof createMicAccess>; config: VoiceConfig }): void;
export function readVoiceConfig(env?: NodeJS.ProcessEnv, packaged?: boolean): VoiceConfig;
// tests/e2e/fixtures.ts
export type MicFixture = 'silence' | 'barge-in-en' | 'barge-in-ko' | 'ptt-en' | 'dfa-en' | 'dfa-es' | 'dfa-ko';
export function launchVoice(opts?: { mic?: MicFixture; env?: Record<string, string> }): Promise<{ app: ElectronApplication; page: Page }>;
```

- **`voiceSwitches`:** only unpackaged, with `TASSEL_FAKE_MIC` naming an existing file, it returns `[['use-fake-device-for-media-stream'], ['use-file-for-fake-audio-capture', '<abs>%noloop']]`. There is no `%noloop` when `TASSEL_FAKE_MIC_LOOP=1`. It returns `[]` otherwise, and logs a missing file once.
- **`micSettingsUrl`:**
  - darwin: `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`. This is the same form P3 uses for the camera; on macOS 26.6.2 the Privacy & Security extension (`com.apple.settings.PrivacySecurity.extension`, legacy id `com.apple.preference.security`) contains `Privacy_Microphone`.
  - win32: `ms-settings:privacy-microphone` ([Microsoft][ms-settings]).
  - Else null.
- **`TASSEL_FAKE_MIC_ACCESS`** (unpackaged only) replaces `systemPreferences`. The fake mic reports `granted`.
- **`launchVoice`** sets `TASSEL_TUTOR=live` and `TASSEL_FAKE_MIC=<abs path of the fixture>` (default `silence`), plus `TASSEL_FAKE_MIC_LOOP=1` for a fixture with `loop: true`. An E2E run therefore never touches a real microphone or a macOS permission prompt.
- **global-setup** passes the server `TASSEL_PROVIDERS=${TASSEL_E2E_PROVIDERS ?? 'fake'}`, `TASSEL_FAKE_TTS=tone` and `TASSEL_VOICE_METRICS_LOG=<apps/desktop/test-results/voice-metrics.jsonl>`.
- **`timelines.json`** (exact). Every clip's transcript is its `say` text unless `transcript` is given. `heard: false` marks a clip push-to-talk must drop.

```json
{ "sample_rate": 16000,
  "fixtures": {
    "silence":     { "voice": null,       "total_ms": 2000,  "loop": true, "scenario": null, "clips": [] },
    "barge-in-en": { "voice": "Samantha", "total_ms": 14000, "scenario": ["barge-in", "en"], "clips": [
      { "at_ms": 4000, "say": "uh-huh" }, { "at_ms": 7500, "say": "Wait, can I ask something?" } ] },
    "barge-in-ko": { "voice": "Yuna",     "total_ms": 14000, "scenario": ["barge-in", "ko"], "clips": [
      { "at_ms": 4000, "say": "네" }, { "at_ms": 7500, "say": "잠깐만요, 질문이 있어요." } ] },
    "ptt-en":      { "voice": "Samantha", "total_ms": 14000, "scenario": ["ptt", "en"], "clips": [
      { "at_ms": 2000, "say": "Hi Ada, can you hear me?", "heard": false }, { "at_ms": 9000, "say": "Can you hear me now?" } ] },
    "dfa-en": { "voice": "Samantha", "total_ms": 12000, "scenario": ["dfa-opening", "en"], "clips": [ { "at_ms": 1500,
      "say": "Hi Ada, I'm working on a DFA for binary strings that start with zero one zero.",
      "transcript": "Hi Ada, I'm working on a DFA for binary strings that start with 010." } ] },
    "dfa-es": { "voice": "Paulina", "total_ms": 12000, "scenario": ["dfa-opening", "es"], "clips": [ { "at_ms": 1500,
      "say": "Hola Ada, estoy haciendo un AFD para cadenas binarias que empiezan con cero uno cero.",
      "transcript": "Hola Ada, estoy haciendo un AFD para cadenas binarias que empiezan con 010." } ] },
    "dfa-ko": { "voice": "Yuna", "total_ms": 12000, "scenario": ["dfa-opening", "ko"], "clips": [ { "at_ms": 1500,
      "say": "에이다, 영 일 영으로 시작하는 이진 문자열 DFA를 만들고 있어요.",
      "transcript": "에이다, 010으로 시작하는 이진 문자열 DFA를 만들고 있어요." } ] } } }
```

- **`make-fixtures.mjs`:**
  - On macOS it synthesizes each clip with `say -v <voice> -o <tmp> --file-format=WAVE --data-format=LEI16@16000` (through `cross-spawn`), places it at `at_ms` in a zeroed buffer of `total_ms`, and writes RIFF PCM16 mono.
  - Elsewhere, and with `--check` on any OS, it only validates the committed files.
  - The WAVs are committed, about 0.2–0.45 MB each, so Windows never needs `say`.

- [ ] **Step 1: Write the failing tests.**
  - **switches:**
    - `fake mic switches only unpackaged, with an existing file`;
    - `noloop unless TASSEL_FAKE_MIC_LOOP=1`;
    - `nothing when packaged`;
    - `a missing file appends nothing and logs once`.
  - **mic-access:**
    - `maps statuses on darwin and win32`;
    - `asks only on macOS`;
    - `the fake access wins when unpackaged`;
    - `settings links per platform`;
    - `openSettings opens only the fixed URL`;
    - `voice IPC refuses untrusted senders`.
  - **windows:**
    - `the main window keeps timers running in the background` (`backgroundThrottling === false`);
    - `media is denied when TASSEL_FAKE_MIC_ACCESS=denied in an unpackaged app`.
  - **fixtures** (node): every WAV in `timelines.json` must be:
    - RIFF PCM, 16-bit, mono, 16 kHz;
    - of length `total_ms` ±20 ms;
    - silent for its last 1000 ms.
  - **E2E `fake-mic.spec.ts`:**
    - `launchVoice({ mic: 'dfa-en' })` then `getUserMedia({ audio: true })` in the page gives a live audio track;
    - `enumerateDevices()` lists at least two `audiooutput` devices;
    - `window.tassel.voice.micAccess()` is `granted`;
    - the track is still live 13 s later, after the `%noloop` file has ended;
    - `launchVoice({ env: { TASSEL_FAKE_MIC_ACCESS: 'denied' } })` makes `getUserMedia` reject with `NotAllowedError`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test voice-main windows && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e fake-mic`
  - Expected: FAIL.
- [ ] **Step 3: Implement, then generate the fixtures on macOS.** Run `node apps/desktop/tests/fixtures/audio/make-fixtures.mjs`, then `--check`.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's command. Expected: PASS, and P1's E2E specs still pass.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(desktop): fake microphone switches, mic access and settings links, audio fixtures"`

### Task 17: The live client in the tutor contract and stores

*Integration: starts after Teams S, C and D have merged into `claude/p2-voice-loop`.*

**Files:**
- Modify:
  - `apps/desktop/src/renderer/src/tutor/create-client.ts`: `createTutorClient(cfg, deps?)`;
  - `tutor/use-tutor-session.ts`;
  - `features/session/stage-store.ts`;
  - `features/session/Captions.tsx`: a `lang` attribute on each line;
  - `features/session/current-session.ts` (P1 R4).
- Create: `apps/desktop/src/renderer/src/features/voice/use-voice-session.ts`
- Test: `apps/desktop/tests/unit/use-tutor-session.test.tsx` (extend), `tests/unit/stage-store.test.ts` (extend), `tests/unit/live/use-voice-session.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 and 11–16; P1's `useStageStore`, `useCurrentSession.patchLocal` and `createApiClient`; the generated `/v1/voice/ice-servers` route (Task 8).
- Produces:

```ts
// stage-store additions
connection: ConnectionStatus; mic: MicStatus | null; setConnection(s: ConnectionStatus): void; setMic(s: MicStatus | null): void;
caption: { previous?: CaptionLine; current?: CaptionLine };   // CaptionLine = { speaker; text; lang?: Lang; final?: boolean }
pushCaption(speaker: 'student' | 'tutor', text: string, opts?: { final?: boolean; lang?: Lang }): void;
// an interim line from the same speaker is replaced in place; a final line or another speaker shifts current to previous
// create-client.ts
export interface LiveDeps { api: ApiClient; bridge: Pick<TasselBridge, 'getToken'>; voice: VoiceSessionResources;
  micOptions(): MicOptions; offerData(): OfferRequestData; lang(): Lang }
export function createTutorClient(cfg: AppConfig, deps?: LiveDeps): TutorClient;   // 'live' without deps throws
// use-voice-session.ts
export interface VoiceSessionResources { mic: Mic; speaker: Speaker; meter: LatencyMeter }
export function useVoiceSession(opts: { sessionId: string; lang: Lang; app: AppConfig; config: VoiceConfig; api: ApiClient }): {
  resources: VoiceSessionResources; client: TutorClient | null };
```

- **`createTutorClient`** for `live` builds `LiveTutorClient` with `serverUrl` from the config and `getToken` from the bridge. `getIceServers()` is `api.GET('/v1/voice/ice-servers')`, mapping each `{ urls }` to an `RTCIceServer`; this typed call refreshes a stale token once, as P1's client already does.

- **`useTutorSession`** routes the new variants:
  - `connection` and `mic` go to the store;
  - `language` calls `patchLocal({ language })`, since the server already saved it;
  - `word` is ignored for now (P6);
  - `voice-debug` goes to `useVoiceDebug.push`;
  - captions carry `final` and `lang`;
  - `title` calls **only** `patchLocal`. R16's `patchSession` call is removed, because the server writes AI titles (P2-R4), and the client-only fake tutor's titles become display-only.
- **`useVoiceSession`** owns the session's voice resources.
  - It builds `Mic` and `Speaker` from `navigator.mediaDevices`, `AudioContext` and `document`.
  - It applies the prefs: input to `mic.setDevice`; outputs and presenter to `speaker.setSinks`; sensitivity to `voice.setSensitivity`.
  - It binds push-to-talk while `pushToTalk` is on, sending `voice.setTalking` and `mic.setGate`; with it off, the gate stays open.
  - It reconnects when `pushToTalk` changes (P2-R8).
  - It runs `startLatencySampler`, sending results to `useVoiceDebug` and `voice.reportClientMetrics`, and calls `meter.markDuck(atMs)` from `speaker.onDuck` when the duck turns on.
  - It builds the client through `createTutorClient(app, deps)`.
  - It feeds `mic.openedAt` to `useVoiceDebug.setMicOpenedAt`.
  - It disposes everything on unmount.
  - `offerData()` returns `{ scenario: app.fakeScript, sensitivity, ptt: pushToTalk }`, and `micOptions()` returns `{ deviceId: inputId, processing: !config.fakeMic }`.

- [ ] **Step 1: Write the failing tests.**
  - `title events no longer PATCH the session`: `api.PATCH` is never called, and `patchLocal` is.
  - `an interim caption is replaced in place; a final one shifts`.
  - `captions keep their language`.
  - `connection and mic events reach the store`.
  - `a language event patches the local session`.
  - `voice-debug events reach useVoiceDebug`.
  - `createTutorClient builds a LiveTutorClient for live, and the scripted client for fake`.
  - `useVoiceSession binds Space only with push-to-talk on, and reconnects when it changes`.
  - `useVoiceSession disposes the mic and speaker on unmount`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test use-tutor-session stage-store live/use-voice-session`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`
  - Expected: PASS, and P1's tutor tests too.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(desktop): live tutor wired into the tutor contract and stage store"`

### Task 18: Voice in the session screen, and the conversation E2E

**Files:**
- Modify:
  - `features/session/SessionScreen.tsx`: `useVoiceSession` in live mode, the HUD, the dev console and `MicNotice`;
  - `Dock.tsx`, `TitleStrip.tsx`, `TutorTile.tsx`, `shortcuts.ts`;
  - `components/icons.tsx`: a `Sliders` icon;
  - `packages/shared/src/i18n/{en,es,ko}.json`: the remaining `voice.*` keys;
  - `scripts/dev.mjs`: `TASSEL_TUTOR` defaults to `live` (P2-R11).
- Create: `features/voice/LanguageMenu.tsx`, `features/voice/MicNotice.tsx`, `apps/desktop/tests/e2e/voice-conversation.spec.ts`
- Test: `apps/desktop/tests/unit/session-voice.test.tsx`, `tests/e2e/voice-conversation.spec.ts`

**Interfaces:**
- Consumes: Task 17; `AudioSettings`, `LatencyHud`, `DevConsole` and `useVoiceDebug` (Tasks 14–15); `window.tassel.voice` (Task 16); P1's `patchSession`.
- Behavior:
  - **Dock:**
    - Mic level bars come from `mic.level()`, at most 30 fps through rAF, still updating under reduced motion but with no easing.
    - An "Audio settings" `IconButton` (Sliders) beside Mic opens `AudioSettings`.
    - While push-to-talk is on, the mic button's name is `voice.mic.holdSpace` and `pressed` follows the hold.
  - **TitleStrip:**
    - The language pill opens `LanguageMenu` (Radix Popover: English · Español · 한국어). Choosing one calls `patchSession({ language })`, then `patchLocal`, then `voice.reconnect()`, and shows `voice.language.switching` until connected.
    - A new AI title types on at about 30 ms per character, instantly under `prefers-reduced-motion` (spec §5.1).
  - **TutorTile:** `voice.connection.connecting` and `voice.connection.reconnecting` while not connected; `voice.connection.failed`, with a Retry button calling `voice.reconnect()`.
  - **MicNotice** sits above the captions while the mic is `denied` or `unavailable`. Its "Open settings" button calls `window.tassel.voice.openMicSettings()`, and it can be dismissed.
  - **HUD:** only when `devTools`. Ctrl/Cmd+Shift+L toggles it, top-left of the stage.
  - **DevConsole:** when `devTools`, and the route's `stt` is `fake` or `devConsole` is set; bottom-left, above the dock. Neither the HUD nor the console may overlap the dock, captions or tile at 1024×680.
  - **English copy:**
    - `voice.connection.connecting` "Connecting to Ada", `voice.connection.reconnecting` "Reconnecting…", `voice.connection.failed` "Couldn't reach Ada.", `voice.connection.retry` "Retry";
    - `voice.mic.denied` "Tassel can't use your microphone. You can still type to Ada.", `voice.mic.unavailable` "No microphone found.", `voice.mic.openSettings` "Open settings";
    - `voice.language.menu` "Session language", `voice.language.switching` "Switching to {language}…".

- [ ] **Step 1: Write the failing tests.**
  - **session-voice** (jsdom, fake resources):
    - `the dock shows the live mic level`;
    - `audio settings open from the dock`;
    - `the language menu switches and reconnects`;
    - `a failed connection offers Retry`;
    - `a denied mic shows the notice with Open settings` (Review Focus 3);
    - `Ctrl+Shift+L toggles the HUD only in dev`;
    - `the dev console sends typed lines`;
    - `an AI title types on, and appears at once with reduced motion`.
  - **E2E `voice-conversation.spec.ts`:** `launchVoice()`, then New session → Homework, English, Paper → Start.
    - The tutor tile goes from Connecting to Speaking, and the greeting caption "Hi, I'm Ada. What are we working on today?" appears.
    - The dev console types the first student line, and the student caption shows it.
    - The title strip becomes "Strings that start with 010".
    - The tutor caption "Great, draw it on paper and talk me through it. I'll watch." appears.
    - `audio[data-testid=tutor-audio]` has a live audio track and an advancing `currentTime`.
    - After Ctrl+Shift+L (Meta+Shift+L on macOS), the HUD reads `EN · FAKE · FAKE · FAKE`, and its first-audio (server, for a typed turn) is at or under 1200.
    - The line "I think that's it. If it starts with a 1, I just wait on q0 until I see a 0." makes the stage Split, and a caption contains "1010".
    - End session → confirm: the library card shows the title. `GET /v1/sessions/{id}` gives `title_source: 'ai'` and subject "Automata · DFA".
    - At 1024×680 the dock, captions, tile, HUD and console boxes don't intersect.
    - Screenshots: `snap('p2-voice-conversation')`, `snap('p2-voice-1024')`, `snap('p2-library-ai-title')`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test session-voice && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e voice-conversation`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Hold the UI to the session screen's direction contract (`apps/desktop/.impeccable/surfaces/er-src-features-session-sessionscreen-tsx-a096c7a1.md`), `DESIGN.md` and the stage mock.
  - Iris stays Ada's alone, for her ring, caption label and marks; the HUD's over-budget red is `--color-live`.
  - The new dock button keeps the dock a single pill.
  - Every new motion is instant under reduced motion.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `pnpm check && pnpm e2e`.
  - Expected: PASS. Every P1 spec still passes, and the screenshots exist.
- [ ] **Step 5: Commit.** `git add apps/desktop packages/shared/src/i18n scripts/dev.mjs && git commit -m "feat(desktop): voice controls in the session screen with AI title type-on"`

### Task 19: Voice E2E scenarios

**Files:**
- Create: `apps/desktop/tests/e2e/voice-barge-in.spec.ts`, `voice-ptt.spec.ts`, `voice-devices.spec.ts`, `voice-language.spec.ts`, `voice-reconnect.spec.ts`, `apps/desktop/tests/unit/fixture-sync.test.ts`

**Interfaces:**
- Consumes: `launchVoice` and `MicFixture` (Task 16), the HUD's `data-testid` hooks (Task 15), `timelines.json`, and the scenarios (Task 4).
- Timing: a spec waits relative to `hud-mic-opened-at` (the mic's `performance.now()` at open), so the WAV timeline and the test agree.

- [ ] **Step 1: Write the specs.**
  - **`fixture-sync.test.ts`** (node): for each fixture with a `scenario`, the transcripts of its clips with `heard !== false` must be a prefix of that scenario language's `student` list.
  - **`voice-barge-in.spec.ts`:**
    - **en**, with `TASSEL_FAKE_SCRIPT=barge-in` and mic `barge-in-en`, on an English session:
      - the tile shows Speaking (the long greeting);
      - between +4.0 s and +7.0 s it stays Speaking and `hud-backchannels` becomes 1 ("uh-huh" ignored);
      - after the +7.5 s clip, the tile leaves Speaking within 1.5 s;
      - `hud-barge-in` shows a number under 1000 ms, which the test logs;
      - the greeting's last caption doesn't contain "any time";
      - the reply "Of course. What's your question?" appears;
      - the HUD's first-audio for that reply is at or under 1800 (1.5 × budget; the strict check is Task 20's).
    - **ko**, with mic `barge-in-ko` on a Korean session: "네" is ignored, "잠깐만요, 질문이 있어요." interrupts, and "네, 말씀하세요." appears with `lang="ko"`.
    - Screenshots: `p2-barge-in-en`, `p2-barge-in-ko`.
  - **`voice-ptt.spec.ts`:**
    - Setup: with push-to-talk on (set `localStorage['tassel.audio-prefs']` with `pushToTalk: true`, then reload), `TASSEL_FAKE_SCRIPT=ptt`, mic `ptt-en`.
    - Until +8 s: no student caption.
    - Then `keyboard.down('Space')` at +8.0 s and `keyboard.up('Space')` at +11.5 s.
    - The student caption "Can you hear me now?" appears, and "Yes, I can hear you clearly." appears only after the release.
    - Typing a space in the dev console types a space and never holds push-to-talk: the mic button stays unpressed (Review Focus 2).
    - Screenshot: `p2-ptt`.
  - **`voice-devices.spec.ts`:**
    - The audio panel lists the fake inputs and outputs.
    - Choosing "Fake Audio Output 1" sets the `tutor-audio` element's `sinkId` to that device's id.
    - Presenter on, with Room output "Fake Audio Output 2", sets `data-presenter-sink` to its id and turns push-to-talk on.
    - A relaunch with the same `TASSEL_USER_DATA` restores all three.
    - With `TASSEL_FAKE_MIC_ACCESS=denied`, the mic notice shows "Open settings", Ada's greeting still appears, and a typed line still gets its reply (Review Focus 3).
    - Screenshots: `p2-audio-settings`, `p2-mic-denied`.
  - **`voice-language.spec.ts`:**
    - **The pill:** on an English session after one exchange, the language pill → 한국어. `hud-connections` reaches 2 and `hud-route` reads `KO · FAKE · FAKE · FAKE`. Typing "왜 죽은 상태가 필요해요?" gets ko's dead-state reply, with `lang="ko"`. `GET` gives `language: 'ko'`.
    - **The spoken request:** on a new session, typing "Can we continue in Korean?" makes the caption "Sure, let's switch to Korean." appear, then reconnects, then shows "좋아요, 이제 한국어로 계속할게요.".
    - Screenshot: `p2-language-ko`.
  - **`voice-reconnect.spec.ts`:** first student line → reply.
    - Typing `/drop`: `hud-connections` reaches 2 within 10 s and the tile returns to Listening. The greeting caption has appeared exactly once (no re-greeting).
    - The next scripted line gets turn 2's reply (Review Focus 4).
    - Screenshot: `p2-reconnect`.
- [ ] **Step 2: Run them.**
  - Run: `pnpm --filter @tassel/desktop test fixture-sync && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e voice-`
  - Expected: PASS. A failure here is a bug in Tasks 2–18: fix it test-first in the owning module, and keep the spec.
- [ ] **Step 3: Exercise it in the running app.**
  - Run `pnpm dev` and do one fake-provider session by voice on the real microphone: greeting, barge-in, a backchannel, push-to-talk and presenter mode. On macOS the request goes to the launching terminal; grant it once.
  - Then open the mic settings link from the denied notice (`TASSEL_FAKE_MIC_ACCESS=denied`), and confirm that the Privacy & Security → Microphone pane opens.
  - Post the screenshots to the team's Discord (roadmap working rule).
- [ ] **Step 4: Commit.** `git add apps/desktop && git commit -m "test(e2e): barge-in, backchannels, push-to-talk, devices, language switch and reconnect"`

### Task 20: Live smoke checks, live E2E and docs

**Files:**
- Create: `services/server/src/tassel/voice/smoke.py`, `services/server/tests/voice/test_smoke.py`, `apps/desktop/tests/e2e/voice-live.spec.ts`
- Modify: `README.md` (a "Voice loop" section), `CLAUDE.md` (voice commands and rules), `services/server/tests/voice/fixtures/openrouter-title.json` (replaced by a recorded response when keys exist)

**Interfaces:**
- Produces: `python -m tassel.voice.smoke [--only stt,llm,tts,titles] [--lang en,es,ko]`. It prints one line per check, and returns exit 0 when every check either passes or is skipped for a missing key.

| Check | What it does | Pass |
|---|---|---|
| `llm` | One streamed completion with `OPENROUTER_PROVIDER` and `REASONING_OFF` | Prints the TTFB and tokens/s; `usage.completion_tokens_details.reasoning_tokens` is 0 (07 open item) |
| `titles` | `OpenRouterTitler.suggest` on the demo line | Prints whether the named `tool_choice` was accepted; writes the raw response to `tests/voice/fixtures/openrouter-title.recorded.json` |
| `stt` | Runs `TasselFluxSTTService` on `dfa-en.wav` and `dfa-es.wav`, and `DeepgramSTTService` with Silero VAD on `dfa-ko.wav`, inside a small Pipecat pipeline | Flux gives at least 1 interim frame (P2-R14) and a final transcript containing "DFA" (the 07 open item on Flux interims); Nova-3 gives a non-empty Korean final |
| `tts` | `ElevenLabsTTSService` speaks one sentence per language | Prints the first-audio latency; word timings are present |

- [ ] **Step 1: Write the failing tests** (no keys, no network).
  - `every check is skipped without its key`: exit 0, and the output contains `skipped: DEEPGRAM_API_KEY not set`.
  - `--only and --lang parse`.
  - `a failed check exits 1` (with a stubbed check).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_smoke.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement `smoke.py` and `voice-live.spec.ts`.**
  - The spec is skipped unless `TASSEL_E2E_PROVIDERS=live`.
  - Per language, it launches with mic `dfa-<lang>`, on a session in that language, and expects:
    - a student caption containing "DFA";
    - a non-empty AI title of at most 6 words;
    - a spoken reply;
    - at least one `turn-metrics` line in `voice-metrics.jsonl`.
  - Write the docs:
    - **README:** the keys go in `services/server/.env`; `TASSEL_PROVIDERS` and the overrides; the dev console and the HUD; push-to-talk and presenter mode; on macOS a terminal-launched app asks for microphone access for the terminal.
    - **`CLAUDE.md`:** the commands; `launchVoice`, and that E2E never uses the real microphone; never put keys in the app.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `uv run --directory services/server pytest -v && pnpm check && pnpm test && pnpm e2e`
  - Expected: PASS, with the live spec skipped.
- [ ] **Step 5: Run the live checks, once keys exist.** Until then, record "live checks pending: no keys" in the ledger. When keys exist:
  1. Fill in `services/server/.env`.
  2. Run `uv run --directory services/server python -m tassel.voice.smoke`. Expected: every check passes. Replace the constructed title fixture with the recorded one, and keep Task 9's tests green.
  3. Run `TASSEL_E2E_PROVIDERS=live pnpm --filter @tassel/desktop e2e voice-live`. Expected: PASS in en, es and ko.
  4. Run `uv run --directory services/server python -m tassel.voice.latency_report ../../apps/desktop/test-results/voice-metrics.jsonl --strict`. Expected: exit 0. Record the p50/p90 table against the §2 budgets in the ledger; a miss becomes a tuning task (Flux `eot_threshold`, VAD `stop_secs`, the Smart Turn parameters, `max_tokens`).
  5. Exercise a live session by voice in `pnpm dev`, in English, Spanish and Korean, and post the screenshots and the latency table to Discord.
- [ ] **Step 6: Commit, then push.** `git add services/server apps/desktop README.md CLAUDE.md && git commit -m "feat(voice): live smoke checks, live E2E and voice docs"`, then `git push -u origin claude/p2-voice-loop`.

---

## Sources

Pipecat sources are at tag `v1.12.0`; client packages at the published versions. These are the files the three verification helpers and the planner read on 2026-10-17.

[pc-pyproject]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/pyproject.toml
[pc-pypi]: https://pypi.org/pypi/pipecat-ai/1.12.0/json
[pc-changelog]: https://github.com/pipecat-ai/pipecat/blob/v1.12.0/CHANGELOG.md
[pc-pipeline]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/pipeline/pipeline.py
[pc-worker]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/pipeline/worker.py
[pc-runner]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/workers/runner.py
[pc-swrtc-conn]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/smallwebrtc/connection.py
[pc-swrtc-transport]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/smallwebrtc/transport.py
[pc-swrtc-handler]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/smallwebrtc/request_handler.py
[pc-run]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/runner/run.py
[pc-transport-params]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/base_transport.py
[pc-rtvi-proc]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frameworks/rtvi/processor.py
[pc-rtvi-models]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frameworks/rtvi/models.py
[pc-rtvi-frames]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frameworks/rtvi/frames.py
[pc-frames]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/frames/frames.py
[pc-observer]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/observers/base_observer.py
[pc-latency-obs]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/observers/user_bot_latency_observer.py
[pc-test-utils]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/tests/utils.py
[pc-user-start]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/turns/user_start/base_user_turn_start_strategy.py
[pc-min-words]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/turns/user_start/min_words_user_turn_start_strategy.py
[pc-user-stop]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/turns/user_stop/base_user_turn_stop_strategy.py
[pc-ext-stop]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/turns/user_stop/external_user_turn_stop_strategy.py
[pc-ta-stop]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/turns/user_stop/turn_analyzer_user_turn_stop_strategy.py
[pc-strategies]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/turns/user_turn_strategies.py
[pc-aggregator]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/aggregators/llm_response_universal.py
[pc-context]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/aggregators/llm_context.py
[pc-flux]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/deepgram/flux/stt.py
[pc-flux-base]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/deepgram/flux/stt_base.py
[pc-nova]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/deepgram/stt.py
[pc-openrouter]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/openrouter/llm.py
[pc-elevenlabs]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/elevenlabs/tts.py
[pc-tts]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/tts_service.py
[pc-stt]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/stt_service.py
[pc-llm]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/llm_service.py
[pc-openai-llm]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/services/openai/base_llm.py
[pc-silero]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/audio/vad/silero.py
[pc-vad]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/audio/vad/vad_analyzer.py
[pc-smart-turn]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/audio/turn/smart_turn/local_smart_turn_v3.py
[pc-fn-schema]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/adapters/schemas/function_schema.py
[pc-tools-schema]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/adapters/schemas/tools_schema.py
[pc-language]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transcriptions/language.py
[pc-time]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/utils/time.py
[npm-cj]: https://registry.npmjs.org/@pipecat-ai/client-js
[npm-swt]: https://registry.npmjs.org/@pipecat-ai/small-webrtc-transport
[npm-radix]: https://registry.npmjs.org/@radix-ui/react-popover
[cj-dts]: https://unpkg.com/@pipecat-ai/client-js@1.14.0/dist/index.d.ts
[cj-js]: https://unpkg.com/@pipecat-ai/client-js@1.14.0/dist/index.module.js
[swt-js]: https://unpkg.com/@pipecat-ai/small-webrtc-transport@1.11.0/dist/index.module.js
[swt-src]: https://github.com/pipecat-ai/pipecat-client-web-transports/blob/small-webrtc-transport-v1.11.0/transports/small-webrtc-transport/src/smallWebRTCTransport.ts
[mm-src]: https://github.com/pipecat-ai/pipecat-client-web-transports/blob/small-webrtc-transport-v1.11.0/lib/src/media-mgmt/mediaManager.ts
[fake-mm]: https://github.com/pipecat-ai/pipecat-client-web-transports/blob/small-webrtc-transport-v1.11.0/tests/src/helpers/fakeMediaManager.ts
[pnpm-age]: https://pnpm.io/settings/dependency-resolution#minimumreleaseage
[res07]: ../../research/07-p2-provider-verification.md
[dg-flux-state]: https://developers.deepgram.com/docs/flux/state.md
[el-models]: https://elevenlabs.io/docs/overview/models
[or-model]: https://openrouter.ai/qwen/qwen3.8-27b
[or-routing]: https://openrouter.ai/docs/guides/routing/provider-selection
[or-params]: https://openrouter.ai/docs/api_reference/parameters
[or-errors]: https://openrouter.ai/docs/api_reference/errors-and-debugging
[cb-chat]: https://inference-docs.cerebras.ai/api-reference/chat-completions
[cb-tools]: https://inference-docs.cerebras.ai/capabilities/tool-use
[el-releases]: https://releases.electronjs.org/release/v44.9.0
[el-cmdline]: https://www.electronjs.org/docs/latest/api/command-line-switches
[el-sysprefs]: https://www.electronjs.org/docs/latest/api/system-preferences
[el-webprefs]: https://www.electronjs.org/docs/latest/api/structures/web-preferences
[cr-switches]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/media_switches.cc
[cr-fake-input]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/fake_audio_input_stream.cc
[cr-file-source]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/simple_sources.cc
[crbug-webaudio]: https://issues.chromium.org/issues/40094084
[mdn-setsinkid]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId
[mdn-ac]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext
[ms-settings]: https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings-app
