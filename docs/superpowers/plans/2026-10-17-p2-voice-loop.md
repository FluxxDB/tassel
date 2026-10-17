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
  - a `Mic`: a Web Audio graph for device switching, mute, the push-to-talk gate and the levels;
  - a `TutorAudio`: Ada's audio on the primary output and the presenter output, with ducking and a level.

  A latency meter measures what she actually hears. A HUD and a developer console make it testable without keys.
- **Contract:** `packages/shared/src/voice` holds the event types, budgets, endpoints, the scripted student lines and the JSON fixtures that both sides test against. `TutorEvent` gains additive variants.

**Tech Stack:**
- **Server:** `pipecat-ai[webrtc,deepgram]==1.12.0` ([pyproject][pc-pyproject], [PyPI, 2026-09-26, Python ≥ 3.11][pc-pypi]). It pulls in aiortc 1.15.0 and onnxruntime 1.24.x (wheels for macOS 14+ arm64, Windows x64 and Linux on Python 3.12). Add `httpx>=0.28` for the titler.
- **Client:** `@pipecat-ai/client-js` `1.14.0` ([npm][npm-cj], [d.ts][cj-dts]) and `@pipecat-ai/small-webrtc-transport` `1.11.0` (peer `client-js ~1.14.0`, dependency `@daily-co/daily-js ^0.94.0`; [npm][npm-swt], [source][swt-src]). UI primitives: `@radix-ui/react-popover` `1.3.1`, `@radix-ui/react-select` `2.4.1`, `@radix-ui/react-switch` `1.4.1` ([npm][npm-radix]).
- **Unchanged from P1:** Electron exactly 44.9.0 (Chromium 152.0.7977.167, [release][el-releases]), React 19, Zustand 5, Vitest, Playwright `_electron`, FastAPI, SQLAlchemy 2, pytest.

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md`, especially:
- §2 (budgets), §4.1 (audio devices and presenter mode), §4.2 (voice loop), §5.1 (titles);
- §5.5 (persona and voice), §5.9 (languages), §6 (session states and shortcuts), §7 (fakes and tests), §10 (keys).

Also read `PRODUCT.md`, the roadmap, the P1 plan (Task 14's `TutorClient` contract), and `docs/research/07-p2-provider-verification.md` (the provider facts this plan relies on), `01-voice-loop-and-models.md` and `00-flagged-items.md`.

**Review flow (main's ruling R30):**
- Every task runs test-first and gets one code review, covering spec and quality, from a checker.
- Each task still runs its own in-app E2E as written.
- App QA with screenshots, and a design pass, happen once at the P2 milestone (end of this plan), not per task. Specs keep calling `snap()`, so the milestone has screens to look at.

## Global Constraints

**Carried from P1, unchanged**
- **Electron:** exactly `44.9.0`. `contextIsolation`, `sandbox` and no Node in renderers; `window.tassel` is the only IPC surface; the origins are `app://tassel` and `http://localhost:5173`.
- **Cross-platform:** every script runs on macOS and Windows, and Node scripts use `cross-spawn`. No command in this plan relies on POSIX `VAR=value cmd`: settings travel through scripts and Playwright configs, or the PowerShell form is given too.
- **UI:** every UI string goes through i18next in en, es and ko (`pnpm check:i18n`), and the design tokens and styling rules apply. Every JSON file passes Biome (`pnpm check`).
- **Ports:** 8787 for dev and 8799 for E2E (`TASSEL_E2E_PORT`); the E2E database is `tassel_e2e`.
- **Commits:** the trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Keys and providers**
- **Keys live only in `services/server/.env`,** which is git-ignored by `.env` and holds voice settings only: `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, and the voice ids `TASSEL_VOICE_EN`, `TASSEL_VOICE_ES` and `TASSEL_VOICE_KO`. They never appear in the app, in `requestData`, in client messages or in logs.
  - `VoiceSettings` reads the file in the app's lifespan, never at import or in `create_app`, so `export_openapi` and P1's schema test stay key-free.
  - `TASSEL_VOICE_ENV_FILE` overrides its path; empty means "read no file".
  - Empty values count as unset (`env_ignore_empty`, [pydantic-settings][ps-settings]).
- **Provider mode:** `TASSEL_PROVIDERS=fake|live|auto` (default `fake`), with per-provider overrides `TASSEL_STT_PROVIDER`, `TASSEL_LLM_PROVIDER`, `TASSEL_TTS_PROVIDER` and `TASSEL_TITLES_PROVIDER`.
  - `auto` is live exactly when that provider's key is set.
  - A provider that resolves live without what it needs fails startup with `"<VAR>=<mode> needs <KEY> in services/server/.env"`.
- **Tests never reach a live provider** (P2-R16):
  - An autouse pytest fixture clears every `TASSEL_*PROVIDER*`, `TASSEL_VOICE_*` and key variable, and sets `TASSEL_VOICE_ENV_FILE` to empty.
  - E2E's global setup does the same for the server it starts, and pins all five provider settings to `fake`.
  - The live E2E is a separate Playwright config, `pnpm --filter @tassel/desktop e2e:live`, so `pnpm e2e` can never go live.

**Budgets** (spec §2, P2-R5), in `VOICE_BUDGETS`:
- First tutor audio, after she stops talking: ≤ 1200 ms in en and es, ≤ 1400 ms in ko.
- Barge-in, from her speech onset:
  - Ada yields (ducks) within 300 ms;
  - she is silent within 600 ms on Normal and Fewer;
  - she is silent within 300 ms on Instant.

**Voice route per session language** (P2-R2)

| Language | STT | Turn end | TTS language | Budget |
|---|---|---|---|---|
| en | Flux `flux-general-multi`, `language_hints=[en]` | Flux EndOfTurn | `en` | 1200 ms |
| es | Flux `flux-general-multi`, `language_hints=[es]` | Flux EndOfTurn | `es` | 1200 ms |
| ko | Nova-3 `nova-3-general`, `language=ko`, interim results on | Silero VAD (stop 0.2 s) + Smart Turn v3.2 | `ko` | 1400 ms |

Silero VAD (`confidence 0.7, start_secs 0.2, stop_secs 0.2, min_volume 0.6`) runs on every route.
- On every route it starts turns while Ada is quiet, makes Instant interrupt, and feeds ducking and the metrics.
- On Flux routes, Flux still ends turns ([07][res07]).

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
- **When the mic opens:** the sent track exists from connect, silent until capture starts. Capture starts once the bot is ready (`BotReady`). That anchors a fake WAV's clock to the bot, and the real mic opens just before Ada first speaks.
- **Presenter mode:** one `<audio>` element on the primary output, plus one `AudioContext({ sinkId })` on the second output (P2-R6).
- **Push-to-talk:** hold Space. It ignores Space with modifiers, on key repeat, while typing in an editable field, and while a dialog or popover is open. It releases on window blur and when the document hides. Mute (M) wins over it.
- **Shortcuts:** M, B and C work as in P1. Space acts only while push-to-talk is on. Ctrl+Shift+L (Cmd+Shift+L on macOS) toggles the latency HUD in unpackaged builds.

**E2E**
- **It drives the built app.** For the microphone, `TASSEL_FAKE_MIC=<absolute .wav>` makes main append `use-fake-device-for-media-stream` and `use-file-for-fake-audio-capture=<wav>%noloop`, never in a packaged app.
- **Fixture WAVs** are 16-bit PCM, mono, 16 kHz, committed as binary (`*.wav binary` in `.gitattributes`). Each ends with at least 1 s of silence: after a `%noloop` file ends, Chromium's file source returns no frames and the fake input stream resends its last buffer ([fake_audio_input_stream.cc][cr-fake-input], [simple_sources.cc][cr-file-source]).
- **Sessions:** voice specs start "Just talk" sessions, so P3's paper path (the Desk View helper, camera permission) never starts.
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
2. **Space is held when the window loses focus** (Cmd-Tab, a system dialog), auto-repeats, or is pressed inside the audio popover.
   - Expected: push-to-talk releases on blur and when the window hides, and repeats are ignored. Space in a text field types a space, Space inside a dialog does nothing, and Space never clicks a focused button while push-to-talk is on.
   - Tests: Task 14.
3. **Microphone permission is denied**, in macOS or Windows privacy settings, or the device is busy.
   - Expected: the session still connects, Ada still speaks, typed lines still work, and a notice offers "Open settings" wherever a settings link exists.
   - Tests:
     - Task 11: a denied or busy mic resolves to a status, and the connection proceeds;
     - Task 13: the `mic denied` event;
     - Task 16: the settings links and `TASSEL_FAKE_MIC_ACCESS=denied`;
     - Task 18: the notice;
     - Task 19: E2E.
4. **The bot dies, or the learner connects twice** (a crash, a server restart, a second window).
   - Expected on the client: it shows Reconnecting, retries 3 times with backoff, then offers Retry.
   - Expected on the server: one bot per learner. A stale restart offer gets a 409, and the conversation resumes without a second greeting, even when the remembered history held a tool call.
   - Tests: Task 8 (registry), Task 13 (backoff), Task 7 (resume, trimming at a user message), Task 19 (E2E `/drop`).
5. **The student renames the session while the AI title is in flight**, or the model returns a long, quoted or punctuated title.
   - Expected: the AI never overwrites her title. Titles clamp to 6 words and 80 characters, subjects to 3 words and 40, in Spanish and Korean too. Injected notes never become titles.
   - Tests: Task 9.

## Rulings (spec conflicts and gaps)

Main adjudicated R1–R15 as accepted (`.superpowers/sdd/2026-10-17-p2-voice-loop/progress.md`); this revision amends R4, R5, R7 and R14 and adds R16. Each ruling gives the decision, why, and the cost if it's wrong.

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
  - Spec §4.3 puts titles on Vultr Serverless Inference, and §4.2 and §5.1 say "fast model". P2 ships OpenRouter→Cerebras behind a `Titler` interface; P10 adds a Vultr titler and makes it the live default (roadmap).
  - Cost if wrong: one implementation behind `Titler`.
- **P2-R5. The barge-in budget, with a backchannel filter.** Spec §2 ("silent within ~300 ms") and §4.2 (a minimum-words filter) pull against each other: words arrive about 250 ms after speech starts ([Flux state machine][dg-flux-state]).
  - Ruling: Ada yields (ducks to 25%) within 300 ms of speech onset, on server VAD. She falls silent once the filter confirms a real interruption, within 600 ms.
  - The "Instant" sensitivity skips the filter: silent within 300 ms.
  - All three budgets live in `VOICE_BUDGETS`, and the HUD, the report and the E2E judge each number against its own budget.
  - The filter uses a per-language backchannel lexicon, not a word count alone, because Korean "잠깐만요" ("wait") is one word.
  - Main flagged this relaxation of §2 to the owner. Cost if wrong: one threshold table.
- **P2-R6. Presenter mode uses one `<audio>` element plus one `AudioContext({ sinkId })`.**
  - Why: Chromium shares one WebRTC audio renderer per page, so with two elements the last `setSinkId` wins ([07][res07]).
  - The element stays attached because remote WebRTC audio is silent in Web Audio unless a media element plays it ([crbug 40094084, open][crbug-webaudio]).
  - Turning presenter mode on also turns on push-to-talk and "Fewer" interruptions, because room speakers are likely outside the echo canceller's reference (UNVERIFIED).
  - Cost if wrong: a default.
- **P2-R7. Switching language restarts the voice loop.** Spec §5.9 lets her switch with the language pill or with `set_language`.
  - The client reconnects (about 1 s), and the server builds the new route and replays the remembered conversation with a switch note.
  - The pill reconnects at once. A spoken switch waits until Ada stops talking (`bot-stopped`, or 3 s), so her "Sure, let's switch to Korean." is never cut off.
  - A seamless `ServiceSwitcher` swap waits for a live test of the Flux→Nova-3 path, which 07 flags as UNVERIFIED.
  - Cost if wrong: a 1 s gap in the Korean demo segment.
- **P2-R8. Push-to-talk is fixed per connection, and toggling it reconnects.** Holding Space means an instant barge-in; releasing it ends the turn as soon as VAD and the transcript allow. Pipecat has no server-side push-to-talk, and a mute strategy that drops VAD stop frames can wedge a turn ([07][res07]).
  - Cost if wrong: a reconnect when she toggles it.
- **P2-R9. Typed lines go through RTVI `send-text`, from a developer console.** Spec §7 says the fake STT takes typed lines.
  - This works with any STT ([processor.py][pc-rtvi-proc]).
  - The fake STT instead maps utterances found by VAD (from Chromium's fake mic) to scripted lines, so the audio path runs with no keys.
  - Cost if wrong: none.
- **P2-R10. Provider settings move to `VoiceSettings`.** `TASSEL_PROVIDERS` gains `auto` and per-provider overrides, and moves out of P1's `Settings`, whose `Literal["fake", "live"]` would reject `auto` at startup.
  - Cost if wrong: one settings field.
- **P2-R11. `TASSEL_TUTOR=live` means the WebRTC client talking to the server's voice loop,** whose providers may still be fake.
  - The default stays `fake`, so P1's specs hold; `pnpm dev` defaults to `live`.
  - Cost if wrong: one default.
- **P2-R12. The owner supplies the ElevenLabs voice ids** (`TASSEL_VOICE_EN|ES|KO`). Tassel ships no default, because spec §5.5 asks for listen-tested native voices; P6 adds the accent picker.
  - Cost if wrong: none.
- **P2-R13. `TutorEvent` grows additively,** with `connection`, `mic`, `language`, `word` and `voice-debug`, and `TutorClient` gains an optional `voice`. P5 and P6 may consume `word`, one event per spoken word.
  - Cost if wrong: renames.
- **P2-R14. Pipecat 1.12.0's event quirks** (revised).
  - **Student captions:** a 1.12.0 server sends `user-transcription`, which client 1.14.0 surfaces as the deprecated `UserTranscript`, never as `UserInput`. The mapping accepts both ([client d.ts][cj-dts]).
  - **Tutor captions:** the server sends `bot-output` per sentence, a `new` message and then progress whose `accumulated_text` covers that sentence only ([observer.py L684–789][pc-rtvi-obs]). The client stitches the sentences of a turn together (Task 13).
  - **Flux interims:** Flux emits no interim frames in 1.12.0. The CHANGELOG says to subscribe to `on_update` instead ([CHANGELOG L1836][pc-changelog]). **Verified usable:**
    - `on_start_of_turn` and `on_update` are public event handlers, registered with `sync=False`, so each call runs the handler in its own task ([stt_base.py L293–297][pc-flux-base], [base_object.py L223–266][pc-base-object]).
    - A handler receives the service and can `push_frame` an `InterimTranscriptionFrame`.
    - Nothing private is overridden. A late handler task can't reopen a finished turn, because `BackchannelGuard` ignores interims between a final transcript and the next start signal.
  - Cost if wrong: the Flux backchannel filter only sees final transcripts.
- **P2-R15. One live bot per learner.**
  - A restart offer for an unknown or ended `pc_id` gets 409, so the client reconnects cleanly instead of reviving a dead bot.
  - Cost if wrong: one rule.
- **P2-R16. Tests and default E2E can't reach live providers** (main's direction).
  - A developer's `.env`, exported keys or `TASSEL_*_PROVIDER` overrides can't switch them, and the live E2E is its own config and command.
  - Cost if wrong: none; the live check is one command (Task 20).

**Not in P2,** with the plan that owns each:
- **P10:**
  - TURN credentials from coturn, TURN over TCP 443, and the WebSocket fallback transport (spec §4.2). P2's `TASSEL_ICE_SERVERS` already carries `urls`, `username` and `credential` to both ends.
  - The Vultr titler as the live default.
  - Packaging's `NSMicrophoneUsageDescription` and the `com.apple.security.device.audio-input` entitlement ([07][res07]).
- **P4:** vision notes injected into the loop, and holding lines. They queue `LLMMessagesAppendFrame(run_llm=True)` on `Bot.worker`, and start with `[` (`is_note`), so titles ignore them.
- **P5 and P6:** beat cue documents, lip-sync, and character-level timings (spec §7 asks the fake TTS for character timings; P2's fake emits word timings). P2 emits the playback-synced `word` events they start from.
- **P6:** the voice accent picker and its preview.
- **P8:** the session event log.
- **P9:** bilingual captions, per-language prompt tuning, onboarding's permission asks (`askMicAccess` is exposed), and the Settings screen's device section, which reuses `AudioSettings` (roadmap).
- **Unverified, to check once on Windows:** aiortc under P1's forced Windows `SelectorEventLoop`. A Windows developer runs Task 8's real-bot test once. Loopback-only (offline) ICE is also unverified.

---

## Parallel tracks

**Task 1** (the contract) runs first, on `claude/p2-voice-loop`. Then three teams work at once, each in its own worktree, branched from `claude/p2-voice-loop` after Task 1:

| Team | Tasks, in order | Worktree and branch | Owns (nobody else edits these) |
|---|---|---|---|
| **S: server** | 2 → {3, 4, 5, 6 in any order} → 7 → 8 → 9 → 10 | `.claude/worktrees/p2-server`, `claude/p2-server` | `services/server/**` (including `config.py`, `app.py`, `sessions_repo.py`, `tests/conftest.py`, `pyproject.toml`, `uv.lock`, `.env.example`), and the generated `packages/shared/src/api/*` (Task 8) |
| **C: client** | 11 → 12 → 13 → 14 → 15 | `.claude/worktrees/p2-client`, `claude/p2-client` | `apps/desktop/src/renderer/src/tutor/live/**`, `apps/desktop/src/renderer/src/features/voice/**`, `apps/desktop/tests/unit/live/**`, `apps/desktop/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the `voice.*` keys in `packages/shared/src/i18n/*.json` |
| **D: desktop media** | 16 | `.claude/worktrees/p2-desktop`, `claude/p2-desktop` | `apps/desktop/src/main/voice/**`, `apps/desktop/src/shared/voice-bridge.ts`, `apps/desktop/tests/unit/voice-main/**`, `apps/desktop/tests/unit/windows.test.ts`, `apps/desktop/tests/fixtures/audio/**`, `apps/desktop/tests/e2e/fake-mic.spec.ts`, `.gitattributes`; one-line hooks in `main/index.ts`, `main/windows.ts`, `preload/index.ts`, `shared/bridge.ts`, `tests/e2e/fixtures.ts` and `tests/e2e/global-setup.ts` |

**Integration:** merge D, C and S into `claude/p2-voice-loop`, in any order, since no two teams edit the same file. Then build Tasks 17 → 18 → 19 → 20 there, one builder at a time. They own:
- `renderer/src/main.tsx`, `app/App.tsx`, `tutor/types.ts`, `tutor/create-client.ts`, `tutor/use-tutor-session.ts`;
- `features/session/**` and its tests;
- the remaining i18n keys;
- `voice/smoke.py`, `scripts/voice-live-check.mjs`, `apps/desktop/playwright.live.config.ts` and `apps/desktop/tests/live/**`;
- `scripts/dev.mjs`, the root `package.json`, the README and `CLAUDE.md`;
- the `tests/e2e/voice-*.spec.ts` files.

**Team rules:**
- Teams meet only at Task 1's contract, which now also fixes the scripted student lines both the scenarios (S) and the WAV transcripts (D) must use. A change to it goes to `main` as a `QUESTION:` first.
- The client team never imports the generated `/v1/voice/*` API types; Task 17 wires the ICE-server fetch.
- E2E runs only in Team D's worktree before integration, on its own `TASSEL_E2E_PORT` and database if another checkout is running E2E.

**Merging with P3.** This is written against P3's revised plan at `828e0a3` and its "Merging with P2" section; recheck both at merge time.
- **Server:**
  - `services/server/src/tassel/app.py`: P2 Task 8 builds `VoiceSettings` and the registry in the lifespan, and includes the voice router. P3 Tasks 4–5 put the object store on `app.state` in the factory, and include the frames router. Keep both.
  - `services/server/src/tassel/config.py`: P2 removes `providers`; P3 adds the object-store and frame fields. Keep both.
  - `services/server/pyproject.toml` and `uv.lock`: keep both, then run `uv lock`.
  - `services/server/tests/conftest.py`: P2 adds the autouse env-scrub fixture; P3 splits `client` into `app`, `client` and `store`. Keep both.
    - P3's note asks the merged `app` fixture to pass P2's `voice_settings`. That is no longer needed: P2 no longer touches the `client` fixture, and `VoiceSettings` loads in the lifespan from the scrubbed environment. Passing it stays harmless.
  - `packages/shared/src/api/*`: never hand-merge. Merge, then run `pnpm gen:api`.
  - Alembic: P2 adds no migration.
- **Desktop main:**
  - `main/index.ts`, `preload/index.ts`, `shared/bridge.ts`: P2 adds `voice`, P3 adds `paper`, on adjacent lines. Keep both.
  - `main/windows.ts`: P2 sets `backgroundThrottling: false`, and its fake mic denial refuses only requests whose `mediaTypes` include `audio`, as P3's note requires, so P3's fake clip video is never blocked. P3 adds the display-media handler. Keep both.
  - `main/ipc.ts`: P3 exports its trusted `handle` as `handleTrusted`. After the merge, `main/voice/ipc.ts` may switch to it; behavior is the same.
- **Renderer:**
  - `index.html`: P3 adds `'wasm-unsafe-eval'` to `script-src`, which still blocks `Function()`, so P2-R3 holds.
  - `renderer/src/main.tsx`: the boot loads both plans' configs, `voice.getConfig()` and `paper.getConfig()`, on adjacent lines. Keep both.
  - The session screen: `SessionScreen.tsx`, `TitleStrip.tsx` and `stage-store.ts` are edited by both plans (P2 Tasks 17–18, P3 Task 13), as are `Stage.tsx` (P3) and `Dock.tsx` (P2), and the tests `session-screen.test.tsx` and `stage-store.test.ts`. Keep both sides' additions.
  - `components/icons.tsx`: P2 adds `Sliders`.
  - The i18n catalogs: P2's `voice.*` and P3's `paper.*` namespaces. Keep both, then run `pnpm check:i18n`.
  - `apps/desktop/package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`: merge, then run `pnpm install`.
- **E2E:**
  - `tests/e2e/global-setup.ts`: P2 adds the hermetic voice pins and `startE2EServer`; P3 adds clip generation, the helper build and the S3 bucket and check. Keep both.
  - `tests/e2e/fixtures.ts`: P2 adds `launchVoice` and `startVoiceSession`; P3 adds `startPaperSession`, `latestSession` and `framesOf`, and makes `launchApp` pin `TASSEL_PAPER_SOURCE=fake-clip`, its clip, `TASSEL_REQUIRE_FAKE_CAPTURE=1` and its capture guard. Keep both.
    - `launchVoice` wraps `launchApp`, so P3's pins and guard cover voice specs too.
    - P3's fake clip and P2's fake mic coexist: Chromium takes its video from the clip and its audio from `TASSEL_FAKE_MIC`.
  - After the merge, every E2E run needs `docker compose up -d db s3`.
  - P2's voice specs use "Just talk" sessions, so they never start P3's Desk View helper or a camera permission check.
- **Fake devices:** Chromium's `use-fake-device-for-media-stream` fakes the camera *and* the microphone, and the default fake mic beeps (P3-R5).
  - After both merge, when P3's fake clip is on and `TASSEL_FAKE_MIC` is unset, point the fake mic at `apps/desktop/tests/fixtures/audio/silence.wav` (looping). That is one line in `main/index.ts`, and the live voice loop then hears silence.
  - P3's `scripts/dev.mjs` defaults to its fake clip. So after the merge, `pnpm dev` talks to Ada by typed lines; a real-microphone session needs a non-fake paper source (`TASSEL_PAPER_SOURCE=deskview-helper`). See the P2 milestone.
- **Everything else:** `docker-compose.yml` (P3's `s3` service), `.gitattributes` (P2's `*.wav binary`, plus any rules of P3's), `scripts/dev.mjs` (P2's `TASSEL_TUTOR=live` default beside P3's fake paper default), the README and `CLAUDE.md`: keep both. CI moved to P10 (main's R32).

## File map

| Area | New files |
|---|---|
| Contract (Task 1) | `packages/shared/src/voice/{messages.ts,fixtures.json}`, `services/server/src/tassel/voice/{__init__,messages}.py` |
| Server (S) | `voice/{settings,routes,turns,flux,providers,prompts,tools,memory,events,bot,api,registry,titles,metrics,latency_report}.py`, `voice/fakes/{__init__,tts,scenario,llm,stt}.py`, `voice/fakes/scenarios/{dfa-opening,barge-in,ptt}.json`, `services/server/.env.example`, `tests/voice/**` (including `fixtures/{openrouter-title,flux-turninfo}.json`) |
| Client (C) | `tutor/live/{mic,tutor-audio,media-manager,rtvi-map,live-client,push-to-talk,latency}.ts`, `features/voice/{audio-prefs,devices,voice-debug}.ts`, `features/voice/{AudioSettings,LatencyHud,DevConsole}.tsx`, `tests/unit/live/**` |
| Desktop media (D) | `src/main/voice/{switches,mic-access,ipc}.ts`, `src/shared/voice-bridge.ts`, `tests/fixtures/audio/{timelines.json,make-fixtures.mjs,*.wav}`, `tests/unit/voice-main/**`, `tests/e2e/fake-mic.spec.ts` |
| Integration | `features/voice/{use-voice-session.ts,LanguageMenu.tsx,MicNotice.tsx}`, `tests/unit/live/use-voice-session.test.tsx`, `tests/unit/session-voice.test.tsx`, `tests/e2e/voice-{bundle,conversation,barge-in,ptt,devices,language,reconnect}.spec.ts`, `services/server/src/tassel/voice/smoke.py`, `scripts/voice-live-check.mjs`, `apps/desktop/playwright.live.config.ts`, `apps/desktop/tests/live/{global-setup.live.ts,voice-live.spec.ts}` |

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
export type Sensitivity = 'low' | 'normal' | 'high';   // shown as Fewer · Normal · Instant
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
export interface ClientMetrics { ttfa_ms: number | null; barge_in_ms: number | null; yield_ms: number | null; sensitivity: Sensitivity }
export type ClientEvent =
  | { kind: 'ptt'; enabled: boolean; held: boolean }
  | { kind: 'sensitivity'; level: Sensitivity }
  | ({ kind: 'client-metrics' } & ClientMetrics);
export interface OfferRequestData { scenario?: string; sensitivity: Sensitivity; ptt: boolean }
export const VOICE_BUDGETS: { ttfa_ms: Record<Lang, number>; yield_ms: number; silence_ms: number; silence_instant_ms: number };
//   { ttfa_ms: { en: 1200, es: 1200, ko: 1400 }, yield_ms: 300, silence_ms: 600, silence_instant_ms: 300 }
export function silenceBudget(s: Sensitivity): number;                 // high → silence_instant_ms, else silence_ms
export function parseServerEvent(data: unknown): ServerEvent | null;   // validates { tassel: {...} } field by field
export function voiceOfferPath(sessionId: string): string;             // `/v1/sessions/${sessionId}/voice/offer`
export const ICE_SERVERS_PATH = '/v1/voice/ice-servers';
```

- Produces (Python, `tassel.voice.messages`):
  - the literals `Sensitivity = Literal["low", "normal", "high"]` and `SttKind = Literal["flux", "nova-3", "fake"]`, which later tasks import rather than redefine;
  - one Pydantic model per kind: `RouteEvent`, `TitleEvent`, `StageEvent`, `LanguageEvent`, `VadEvent`, `BackchannelEvent`, `TurnMetrics`, `TurnMetricsEvent`, `PushToTalkEvent`, `SensitivityEvent`, `ClientMetricsEvent`, `OfferRequestData` (defaults `scenario=None`, `sensitivity="normal"`, `ptt=False`);
  - `TypeAdapter`s `SERVER_EVENTS` and `CLIENT_EVENTS` over unions discriminated on `kind`;
  - `ENVELOPE = "tassel"`, `VOICE_BUDGETS` (same values), and the router-relative routes `OFFER_ROUTE = "/sessions/{session_id}/voice/offer"` and `ICE_SERVERS_ROUTE = "/voice/ice-servers"` (the app mounts them under `/v1`);
  - `LANGUAGE_SWITCH_PREFIX = "[language switch]"` and `def is_note(text: str) -> bool`, which is true for a user-role message the server injected rather than the student said: it starts with `[`;
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
  | { type: 'word'; text: string; lang: Lang }          // one per word as Ada says it (playback-synced); for P5/P6
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
  - an `offer_request_data` example;
  - **`scenario_lines`**: the exact student lines that Team S's scenarios (Task 4) and Team D's WAV transcripts (Task 16) must both use:

```json
"scenario_lines": {
  "dfa-opening": {
    "en": ["Hi Ada, I'm working on a DFA for binary strings that start with 010.",
           "I think that's it. If it starts with a 1, I just wait on q0 until I see a 0."],
    "es": ["Hola Ada, estoy haciendo un AFD para cadenas binarias que empiezan con 010.",
           "Creo que ya está. Si empieza con un 1, me quedo en q0 hasta ver un 0."],
    "ko": ["에이다, 010으로 시작하는 이진 문자열 DFA를 만들고 있어요.", "왜 죽은 상태가 필요해요?"] },
  "barge-in": { "en": ["uh-huh", "Wait, can I ask something?"], "es": ["ajá", "Espera, ¿puedo preguntar algo?"],
                "ko": ["네", "잠깐만요, 질문이 있어요."] },
  "ptt": { "en": ["Can you hear me now?"], "es": ["¿Me oyes ahora?"], "ko": ["이제 들려요?"] } }
```

  It is the contract the server and client teams build against.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shared/tests/voice-messages.test.ts
it.each(fixtures.server)('parses the $kind server event', (event) => {
  expect(parseServerEvent({ tassel: event })).toEqual(event);
});
it.each([null, 'x', {}, { tassel: { kind: 'nope' } }, { tassel: { kind: 'title' } }, { tassel: { kind: 'vad', speaking: 'yes' } }])(
  'rejects %j', (data) => expect(parseServerEvent(data)).toBeNull());
it('keeps the spec §2 budgets, as R5 splits them', () => {
  expect(VOICE_BUDGETS).toEqual({ ttfa_ms: { en: 1200, es: 1200, ko: 1400 }, yield_ms: 300, silence_ms: 600, silence_instant_ms: 300 });
  expect(fixtures.budgets).toEqual(VOICE_BUDGETS);
  expect([silenceBudget('low'), silenceBudget('normal'), silenceBudget('high')]).toEqual([600, 600, 300]);
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
def test_budgets_and_routes_match_the_fixture():
    assert VOICE_BUDGETS == FIXTURES["budgets"]
    assert "/v1" + OFFER_ROUTE == FIXTURES["endpoints"]["offer"]
    assert "/v1" + ICE_SERVERS_ROUTE == FIXTURES["endpoints"]["ice_servers"]
def test_offer_request_data_defaults():
    d = OfferRequestData.model_validate({})
    assert (d.scenario, d.sensitivity, d.ptt) == (None, "normal", False)
def test_notes():
    assert is_note(LANGUAGE_SWITCH_PREFIX + " The student switched…") and is_note("[vision] DFA attempt complete.")
    assert not is_note("Hi Ada, I'm working on a DFA")
def test_envelope():
    assert envelope(StageEvent(kind="stage", view="split")) == {"tassel": {"kind": "stage", "view": "split"}}
```

  In `tutor-contract.test.ts`: `useTutorSession ignores a word event`. The FakeTutorClient emits `{ type: 'word', text: 'hi', lang: 'en' }`; nothing throws and the stage store is unchanged.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/shared test voice-messages && uv run --directory services/server pytest tests/voice/test_voice_messages.py -v`
  - Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Hand-write `parseServerEvent` guards (no new dependency). Keep the Python models with `extra="forbid"`.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `pnpm --filter @tassel/desktop test tutor-contract && pnpm --filter @tassel/desktop typecheck && pnpm check`.
  - Expected: PASS, and P1's tutor tests still pass.
- [ ] **Step 5: Commit.** `git add packages/shared services/server/src/tassel/voice services/server/tests/voice apps/desktop/src/renderer/src/tutor apps/desktop/tests/unit/tutor-contract.test.ts && git commit -m "feat(shared): voice event contract, scripted lines and additive TutorEvent variants"`

### Task 2: Pipecat dependency, voice settings, test isolation and routes

**Files:**
- Modify: `services/server/pyproject.toml`, adding the runtime dependencies `"pipecat-ai[webrtc,deepgram]==1.12.0"` and `"httpx>=0.28"`; `services/server/uv.lock`
- Modify: `services/server/src/tassel/config.py` (remove `providers`, which moves to `VoiceSettings`; P2-R10)
- Modify: `services/server/tests/conftest.py` (the autouse `scrub_voice_env` fixture, P2-R16)
- Create: `services/server/.env.example`, `services/server/src/tassel/voice/settings.py`, `services/server/src/tassel/voice/routes.py`
- Test: `services/server/tests/voice/test_voice_settings.py`, `services/server/tests/voice/test_voice_routes.py`

**Interfaces:**
- Produces:

```python
Mode = Literal["fake", "live", "auto"]
ProviderKind = Literal["stt", "llm", "tts", "titles"]
SERVER_DIR: Path  # services/server
class IceServerConfig(BaseModel): urls: list[str]; username: str | None = None; credential: SecretStr | None = None
class VoiceSettings(BaseSettings):  # env_prefix TASSEL_, extra ignore, populate_by_name, env_ignore_empty=True
    providers: Mode = "fake"
    stt_provider: Mode | None = None; llm_provider: Mode | None = None; tts_provider: Mode | None = None; titles_provider: Mode | None = None
    deepgram_api_key: SecretStr | None = Field(None, validation_alias="DEEPGRAM_API_KEY")   # same for OPENROUTER_API_KEY, ELEVENLABS_API_KEY
    voice_en: str | None = None; voice_es: str | None = None; voice_ko: str | None = None
    llm_model: str = "qwen/qwen3.8-27b"; llm_max_tokens: int = 400
    fake_tts: Literal["auto", "say", "tone"] = "auto"; fake_scenario: str = "dfa-opening"
    ice_servers: list[IceServerConfig] = []; voice_metrics_log: Path | None = None
    @classmethod
    def load(cls) -> "VoiceSettings"   # _env_file = TASSEL_VOICE_ENV_FILE if set (empty → None), else SERVER_DIR/".env"
class VoiceConfigError(RuntimeError): ...
def resolve_mode(kind: ProviderKind, s: VoiceSettings) -> Literal["fake", "live"]  # raises VoiceConfigError when live lacks a key
def check_voice_settings(s: VoiceSettings) -> list[str]                          # every problem, one line each

@dataclass(frozen=True)
class VoiceRoute:
    lang: Lang; stt: Literal["flux", "nova-3"]; stt_model: str; language_hints: tuple[str, ...]
    keyterms: tuple[str, ...]; smart_turn: bool; tts_language: str; ttfa_budget_ms: int
KEYTERMS: dict[Lang, tuple[str, ...]]
def route_for(lang: Lang) -> VoiceRoute
```

- **Keyterms (exact):**
  - en: `("DFA", "NFA", "automaton", "accept state", "dead state", "transition", "q zero")`
  - es: `("DFA", "AFD", "autómata", "estado de aceptación", "estado muerto", "transición")`
  - ko: `("DFA", "상태", "전이", "수락 상태", "죽은 상태", "오토마타")`
- **Error lines** read `"<VAR>=<mode> needs <KEY> in services/server/.env"`.
  - `<VAR>` is `TASSEL_PROVIDERS` when the global mode decided, else `TASSEL_<KIND>_PROVIDER`; `<mode>` is that variable's value (`live` or `auto`).
  - Titles use `OPENROUTER_API_KEY`.
  - Live TTS also needs one voice per language: `"TASSEL_PROVIDERS=auto needs TASSEL_VOICE_KO in services/server/.env"`.
- **The autouse fixture `scrub_voice_env`** (root `tests/conftest.py`, so P1's and P3's tests are covered too):
  - deletes every environment variable matching `TASSEL_*PROVIDER*` or `TASSEL_VOICE_*`, plus the three keys;
  - sets `TASSEL_VOICE_ENV_FILE=""`.

  A test that wants live settings constructs `VoiceSettings(...)` explicitly.
- **`.env.example`:**
  - lists `TASSEL_PROVIDERS=auto` (so each provider goes live as its key is filled in), the four override names in a comment, the three keys and the three voice ids;
  - has comments saying it holds voice settings only and is never shipped in the app.

- [ ] **Step 1: Write the failing tests.**
  - `test_defaults_are_fake`: with `VoiceSettings(_env_file=None)`, every kind resolves to `fake` and `check_voice_settings` returns `[]`.
  - `test_auto_is_live_only_with_its_key`: with `providers="auto"` and only `deepgram_api_key`, stt is live, and llm, tts and titles are fake.
  - `test_live_without_key_is_reported`: with `llm_provider="live"`, the problems are `["TASSEL_LLM_PROVIDER=live needs OPENROUTER_API_KEY in services/server/.env"]`, and `resolve_mode("llm", s)` raises with that text.
  - `test_live_tts_needs_a_voice_per_language`: with `providers="auto"`, an ElevenLabs key and only `voice_en`, the problems are `"TASSEL_PROVIDERS=auto needs TASSEL_VOICE_ES …"` and `"… TASSEL_VOICE_KO …"`.
  - `test_empty_values_count_as_unset(tmp_path)`: a file with `DEEPGRAM_API_KEY=`, `TASSEL_STT_PROVIDER=` and `TASSEL_PROVIDERS=auto` loads without error, and stt resolves to `fake` (Review I8).
  - `test_load_reads_the_env_file_it_is_told(tmp_path, monkeypatch)`: `TASSEL_VOICE_ENV_FILE` pointing at a file with `DEEPGRAM_API_KEY=dg1` gives the key `dg1`; `TASSEL_VOICE_ENV_FILE=""` reads nothing.
  - `test_tests_never_see_developer_keys`: under the autouse fixture, `"OPENROUTER_API_KEY" not in os.environ`, and `VoiceSettings.load()` resolves every kind to `fake`.
  - `test_secrets_never_print`: `repr()` contains no key text and no TURN credential.
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
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(server): pin Pipecat 1.12.0, voice settings, hermetic tests and per-language routes"`

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
- **Timings are per word.** Spec §7 asks the fake TTS for character timings; those come with P5's and P6's cue documents.

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
  - `CancelWorkerFrame(reason)`;
  - Task 1's `scenario_lines` and `LANGUAGE_SWITCH_PREFIX`.
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
  2. Text starting with `LANGUAGE_SWITCH_PREFIX`: `after_switch`.
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
- **Every scenario defines en, es and ko,** and each language's `student` list starts with Task 1's `scenario_lines` for it, exactly. The lines the specs and fixtures depend on are fixed below; write the rest naturally, with Korean in polite 해요체.
- **`dfa-opening.json`:**
  - `title` is "Strings that start with 010" and `subject` is "Automata · DFA".
  - en:
    - `greeting`: "Hi, I'm Ada. What are we working on today?"
    - `after_switch`: "Okay, we'll keep going in English."
    - `fallback`: "Tell me more about what you're trying."
    - `turns`:
      1. `when` "start with 010", `say` "Great, draw it on paper and talk me through it. I'll watch."
      2. `when` "I think that's it", `say` "Before you move on, try running 1010 through your DFA. Where does it end up?", `tools` `[show_stage {view: split}]`
      3. `when` "continue in Korean", `say` "Sure, let's switch to Korean.", `tools` `[set_language {language: ko}]`
  - es: the same three turns, with `when` "empiezan con 010", "Creo que ya está" and "seguir en coreano"; `after_switch` "Perfecto, seguimos en español."
  - ko: turn 1's `when` is "010으로 시작"; one more turn has `when` "죽은 상태" and a short explanation of the dead state; `after_switch` is "좋아요, 이제 한국어로 계속할게요."
- **`barge-in.json`:** each language has one long greeting (about 190 characters, so about 12 s of tone), and one turn answering the barge-in line.
  - en `greeting`: "Hi, I'm Ada. Before we start, here's how this works: I'll watch your paper while you work, and I'll only step in when something is worth a closer look. You can interrupt me any time."
  - en turn: `when` "ask something", `say` "Of course. What's your question?"
  - es turn: `when` "preguntar".
  - ko turn: `when` "질문", `say` "네, 말씀하세요."
- **`ptt.json`:**
  - en `greeting`: "Hi, I'm Ada. Hold Space when you want to talk."
  - en turn: `when` "hear me", `say` "Yes, I can hear you clearly."

- [ ] **Step 1: Write the failing tests.**
  - `test_every_scenario_loads`: each file in `SCENARIOS_DIR` loads with en, es and ko, and non-empty greeting, after_switch and fallback.
  - `test_student_lines_match_the_contract`: for every scenario and language in Task 1's `scenario_lines`, the scenario's `student` list starts with those lines exactly (Review I9).
  - `test_load_rejects_bad_names`: `"../x"`, `"DFA"` and `""` each raise `ValueError`.
  - `test_next_turn_follows_the_demo` (en):
    - no text gives the greeting;
    - the first student line gives turn 1's `say`;
    - "I think that's it…" gives turn 2, with `show_stage` `{"view": "split"}`;
    - the first line again, after turn 1 is said, gives the fallback.
  - `test_spanish_lines_hit_their_turns`: es `scenario_lines` 1 and 2 give turns 1 and 2.
  - `test_language_switch_note_uses_after_switch`: for ko, `next_turn(script, LANGUAGE_SWITCH_PREFIX + " …", [...]).say` is ko's `after_switch`.
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
- [ ] **Step 3: Implement.** Format the scenario JSON with Biome.
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
  - In 1.12.0 the aggregator feeds every frame, system frames included, to the strategies.
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
MIN_WORDS: dict[Literal["normal", "low"], dict[Lang, int]] = {"normal": {"en": 1, "es": 1, "ko": 1}, "low": {"en": 2, "es": 2, "ko": 1}}
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
- **`normalize`:** NFC, casefold, strip `.,!?¡¿…~'"“”‘’`, collapse whitespace.
- **`is_backchannel`:** the normalized text is in the set, or it's one set entry repeated with or without spaces ("네 네", "네네", "yeah yeah"). Empty text is not a backchannel.
- **`MIN_WORDS`:** Korean keeps 1 at Fewer, because one Korean word ("잠깐만요") carries a whole interruption.
- **`BackchannelGuard`:**
  - `resolves_proposed_turn_start_frames` returns True.
  - It tracks bot speech, and starts or holds the turn as below.

  | Condition | What it does |
  |---|---|
  | `tuning.ptt` is on | Starts on VAD start or a proposed start only while `ptt_held` |
  | Start signal (VAD start or a proposed start) while the bot is quiet, or sensitivity `high` | Starts the turn, returns STOP |
  | Interim or final transcription while the bot is quiet | Starts the turn, returns STOP |
  | Transcription while the bot speaks, with a non-backchannel and at least `MIN_WORDS[sensitivity][lang]` words | Starts the turn (which interrupts), returns STOP |
  | A final backchannel while the bot speaks | Calls `trigger_reset_aggregation()` (keeping "uh-huh" out of the context), then `on_ignored(text)` |
  | An interim after a final, before the next start signal | Ignored: a late Flux handler task (P2-R14) can't reopen a finished turn |

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
  - `test_low_sensitivity_needs_two_words_except_in_korean`: in en, "wait" doesn't start and "wait what" does; in ko, "잠깐만요" starts (Review Minor 5).
  - `test_instant_sensitivity_interrupts_on_speech_start`: the bot is speaking, and a `VADUserStartedSpeakingFrame` starts the turn.
  - `test_idle_tutor_any_speech_starts_a_turn`: a VAD start or a final "네" starts a turn while the bot is quiet.
  - `test_late_interim_after_final_is_ignored`: a final, then an interim "wait", start nothing; a following `ProposedUserStartedSpeakingFrame` does.
  - `test_ptt_released_never_starts` and `test_ptt_held_starts_on_vad`.
  - `test_ptt_stop_waits_for_release_and_transcript`:
    - With tuning `ptt=True, ptt_held=True`, the frames are VAD start, final "Can you hear me now?", VAD stop, then `PushToTalkFrame(held=False)`.
    - `UserStoppedSpeakingFrame` appears only after the last frame.
  - `test_strategy_sets_per_route`: the start and stop classes for `flux`, `nova-3`, `fake` and `ptt` match the table above.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_turns.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement `turns.py`.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): backchannel-aware barge-in, sensitivity and push-to-talk turn strategies"`

### Task 6: Live providers, Flux interims, persona prompt and tools

**Files:**
- Create: `services/server/src/tassel/voice/flux.py`, `voice/providers.py`, `voice/prompts.py`, `voice/tools.py`, `services/server/tests/voice/fixtures/flux-turninfo.json`
- Test: `services/server/tests/voice/test_providers.py`, `tests/voice/test_flux_interims.py`, `tests/voice/test_prompts.py`

**Interfaces:**
- Consumes:
  - `DeepgramFluxSTTService` (constructor `api_key, should_interrupt, settings`, and `Settings(model, language_hints, keyterm, eot_threshold, ...)`) ([flux stt.py][pc-flux], [stt_base.py][pc-flux-base]). Its public `on_start_of_turn(stt, transcript)` and `on_update(stt, transcript)` handlers are registered `sync=False`: each call runs in its own task ([base_object.py L223–266][pc-base-object]);
  - `DeepgramSTTService.Settings(model, language, interim_results, keyterm, smart_format, punctuate, ...)` ([stt.py][pc-nova]);
  - `OpenRouterLLMService(api_key, settings=Settings(model, max_tokens, temperature, extra))`. `extra` is passed into `chat.completions.create`, so body fields go in `extra={"extra_body": {...}}`, and a top-level `provider` raises ([openrouter llm.py][pc-openrouter], [07][res07]);
  - `ElevenLabsTTSService(api_key, settings=Settings(model, voice, language, ...))` ([elevenlabs tts.py][pc-elevenlabs]);
  - `FunctionSchema(name, description, properties, required)` and `ToolsSchema(standard_tools)` ([function_schema.py][pc-fn-schema], [tools_schema.py][pc-tools-schema]);
  - `Language` ([language.py][pc-language]);
  - the fakes from Tasks 3–4; `VoiceSettings`, `VoiceRoute` and `resolve_mode` from Task 2; `LANGUAGE_SWITCH_PREFIX` from Task 1.
- Produces:

```python
def attach_flux_interims(stt: DeepgramFluxSTTService) -> None
    # registers on_start_of_turn and on_update handlers that push
    # InterimTranscriptionFrame(transcript, "", time_now_iso8601()) when the transcript is non-empty
OPENROUTER_PROVIDER = {"only": ["cerebras"], "allow_fallbacks": False, "require_parameters": True}
REASONING_OFF = {"effort": "none"}
def flux_settings(route: VoiceRoute) -> DeepgramFluxSTTService.Settings
def nova_settings(route: VoiceRoute) -> DeepgramSTTService.Settings
def openrouter_settings(s: VoiceSettings) -> OpenRouterLLMService.Settings
def elevenlabs_settings(route: VoiceRoute, voice_id: str) -> ElevenLabsTTSService.Settings
def stt_kind(route: VoiceRoute, s: VoiceSettings) -> SttKind
def make_stt(route, s, scenario) -> STTService   # Flux gets attach_flux_interims
def make_llm(route, s, scenario) -> LLMService
def make_tts(route, s) -> TTSService
LANGUAGE_NAMES = {"en": "English", "es": "Spanish", "ko": "Korean"}
def system_prompt(lang: Lang, tutor_name: str = "Ada") -> str
def language_switch_note(lang: Lang) -> str      # starts with LANGUAGE_SWITCH_PREFIX
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
  - that a user message starting with `[` is a note from the app, not the student; on `[language switch]`, a short acknowledgement in the new language.
- **`language_switch_note(lang)`** is `"[language switch] The student switched the session language to {Language}. Reply only in {Language} from now on, starting with one short acknowledgement."`
- **Captions in live mode show the spoken form** ("one zero one zero"). Pairs of display and spoken text wait for P5's beats.
- **`flux-turninfo.json`** is a TurnInfo sequence built from Deepgram's documented lifecycle ([Flux state machine][dg-flux-state]): StartOfTurn "Hi I", Update "Hi I'm working", EndOfTurn "Hi I'm working on a DFA". Task 20's `stt` smoke check records a real one next to it.

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
    - With every provider live and dummy keys and voices: `DeepgramFluxSTTService` with the interim handlers attached for en, `DeepgramSTTService` for ko, `OpenRouterLLMService`, `ElevenLabsTTSService`.
  - `test_stt_kind`: fake gives `"fake"`; live gives `"flux"` for en and `"nova-3"` for ko.
  - **`test_flux_interims_follow_the_recorded_sequence`** (`test_flux_interims.py`; the contract test spec §7 asks for):
    - A Flux service with `api_key="test"` and `attach_flux_interims`, with `push_frame` and `broadcast_frame` recording (the base's own `_handle_message` drives it, as 1.12.0's receive loop does).
    - Each message of `flux-turninfo.json` is fed in, with an `await asyncio.sleep(0)` between them so the handler tasks run.
    - Recorded, in order: `ProposedUserStartedSpeakingFrame`, interim "Hi I", interim "Hi I'm working", the finalized `TranscriptionFrame` "Hi I'm working on a DFA", `ProposedUserStoppedSpeakingFrame`. An empty transcript records no interim.
  - `test_prompt_rules[en|es|ko]`: the required phrases above, with `LANGUAGE_NAMES[lang]`; ko also contains "해요체".
  - `test_language_switch_note`: it starts with `LANGUAGE_SWITCH_PREFIX` and contains "Korean" for ko.
  - `test_tools`: the names are `["show_stage", "set_language"]`, with the enums above.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_providers.py tests/voice/test_flux_interims.py tests/voice/test_prompts.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add services/server && git commit -m "feat(voice): live provider factories, Flux interims via on_update, Ada's prompt and tools"`

### Task 7: The bot pipeline

**Files:**
- Create: `services/server/src/tassel/voice/memory.py`, `voice/events.py`, `voice/bot.py`
- Test: `services/server/tests/voice/test_memory.py`, `tests/voice/test_bot_pipeline.py`

**Interfaces:**
- Consumes:
  - `Pipeline([...])` ([pipeline.py][pc-pipeline]);
  - `PipelineWorker(pipeline, params=PipelineParams(...), idle_timeout_secs=...)`, from [worker.py][pc-worker]. It prepends `RTVIProcessor` itself (`enable_rtvi=None`), wires `on_client_ready → set_bot_ready()`, and exposes:
    - `worker.rtvi`, `add_observer(observer)` (L704), `queue_frame`, `queue_frames` and `cancel(reason=)`;
    - the event `on_pipeline_finished(worker, frame)` (L602), which fires when the pipeline ends or is cancelled;
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
    def remember(self, session_id: UUID, messages: list[dict], lang: Lang) -> None
        # drops system messages; keeps at most max_messages, cutting only at a user message, so the kept
        # history never starts with an assistant tool call or a tool result
class ServerEvents:
    def __init__(self, worker: PipelineWorker)
    async def send(self, event: BaseModel) -> None                             # worker.rtvi.send_server_message(envelope(event))
class VadForwarder(BaseObserver):
    def __init__(self, worker: PipelineWorker)  # first push of each VAD frame -> worker.queue_frame(RTVIServerMessageFrame(envelope(VadEvent)))
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
- **Worker:** `PipelineWorker(params=PipelineParams(enable_metrics=True, enable_usage_metrics=True, report_only_initial_ttfb=True), idle_timeout_secs=1800)`.
  - Observers that need the worker (`VadForwarder`, and Task 10's metrics) are added after construction with `worker.add_observer(...)`.
  - The scenario is `request.scenario` when it loads and the LLM is fake, else `settings.fake_scenario`.
  - Tuning comes from `request.sensitivity` and `request.ptt`.
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
- **Memory** is saved in `build_bot`'s `on_pipeline_finished` handler, which `remember`s `context.messages`. It therefore covers an end, a cancel and a crash alike.
- **`run_bot`:**
  - builds `SmallWebRTCTransport(webrtc_connection=connection, params=TransportParams(audio_in_enabled=True, audio_out_enabled=True))` ([transport.py][pc-swrtc-transport], [base_transport.py][pc-transport-params]);
  - cancels the worker on the transport's `on_client_disconnected`;
  - runs it;
  - in `finally`, calls `connection.disconnect()`.

- [ ] **Step 1: Write the failing tests.**
  - **memory:**
    - `recall is empty for an unknown session`;
    - `remember drops system messages and keeps at most 40`;
    - `the cut lands on a user message, never inside a tool pair` (Review I6). Given 45 messages where index 5 is an assistant `tool_calls` message and index 6 its `tool` result, the kept history starts with the first `user` message at or after the cut, and contains no orphan `tool` message;
    - `entries expire after the TTL` (fake clock);
    - `recall returns the language they were spoken in`.
  - **pipeline:** these run `build_bot` with a pass-through input and an output recorder that keeps every frame, under `WorkerRunner`. The test drives RTVI by queueing `InputTransportMessageFrame`s: `client-ready` with `{"version": "2.1.0"}`, then `send-text` with `{"content": …, "options": {"run_immediately": true, "audio_response": true}}`. The recorder reads `server-message` payloads from the outgoing transport message frames. Then:
    - `test_greets_on_client_ready`: a `route` event `{lang en, stt fake, llm fake, tts fake}`, then `TTSAudioRawFrame`s and the greeting's text.
    - `test_typed_line_gets_the_scripted_reply`: the first student line gets turn 1's text.
    - `test_show_stage_sends_a_stage_event`: after turn 1, "I think that's it. …" sends `{"tassel": {"kind": "stage", "view": "split"}}`.
    - `test_set_language_patches_the_session_and_tells_the_client` (`db` fixture): "Can we continue in Korean?" leaves the row's language `ko` and sends a `language` event.
    - `test_ptt_message_updates_tuning`: a `client-message` of type `tassel` with data `{"kind": "ptt", "enabled": true, "held": true}` sets `bot.tuning.ptt_held`.
    - `test_bad_client_message_is_ignored`.
    - `test_memory_is_saved_when_the_bot_ends`: after `worker.cancel()`, recall holds the user line and the reply, and no system message.
    - `test_resume_does_not_greet_again`: a second bot on the same memory sends `route` but no greeting text.
    - `test_resume_after_a_tool_call_works`: memory holding turn 2's `show_stage` call resumes, and the next line gets its scripted reply.
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
  - `services/server/src/tassel/app.py`: `create_app(settings=None, voice_settings=None)`. The lifespan builds `voice_settings or VoiceSettings.load()`, checks it, builds the registry on `app.state.voice`, and shuts it down before disposing the engine. The router is included under `/v1`. `create_app` itself never reads `.env`;
  - `packages/shared/src/api/openapi.json` and `schema.d.ts` (regenerated).
- Test: `services/server/tests/voice/test_voice_api.py`, `tests/voice/test_voice_registry.py`

**Interfaces:**
- Consumes ([request_handler.py][pc-swrtc-handler], [connection.py][pc-swrtc-conn], [runner run.py][pc-run], [transport index.module.js L2941–2961][swt-js]):
  - `SmallWebRTCRequestHandler(ice_servers: list[IceServer] | None)`;
  - `await handle_web_request(SmallWebRTCRequest(sdp, type, pc_id, restart_pc, request_data), webrtc_connection_callback)`, which returns `{"sdp", "type", "pc_id"}`. A known `pc_id` renegotiates; `restart_pc=True` builds a new peer connection with a new `pc_id`; callback errors are only logged;
  - `await handle_patch_request(SmallWebRTCPatchRequest(pc_id, candidates=[IceCandidate(candidate, sdp_mid, sdp_mline_index)]))`, which raises 404 for an unknown `pc_id`;
  - `close()`;
  - `IceServer` (aiortc `RTCIceServer(urls, username, credential)`).
  - The client sends `{sdp, type, pc_id, restart_pc, requestData}`. It PATCHes the same URL with the same `Headers`, as `{pc_id, candidates: [{candidate, sdp_mid, sdp_mline_index}]}`, every 200 ms.
  - `current_learner` and `sessions_repo.get_for` from P1; `run_bot` and `BotContext` from Task 7; `VoiceSettings.load`, `check_voice_settings` and `IceServerConfig` from Task 2.
- Produces:

```python
class OfferBody(BaseModel):   # populate_by_name
    sdp: str; type: Literal["offer"]; pc_id: str | None = None; restart_pc: bool | None = None
    request_data: OfferRequestData | None = Field(None, alias="requestData")
class OfferAnswer(BaseModel): sdp: str; type: str; pc_id: str
class IceCandidateIn(BaseModel): candidate: str; sdp_mid: str; sdp_mline_index: int
class IcePatch(BaseModel): pc_id: str; candidates: list[IceCandidateIn]
class IceServerOut(BaseModel): urls: list[str]; username: str | None = None; credential: str | None = None
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
- **ICE servers** go to aiortc and to the client with their `username` and `credential`, so P10's TURN only fills in the setting.
- **Tokens:** the offer route doesn't refresh a token itself. The client fetches the ICE servers first through P1's typed client, which refreshes a stale token once (Task 17).

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
  - `test_ice_servers_from_settings`: `ice_servers=[IceServerConfig(urls=["turn:turn.example:443?transport=tcp"], username="u", credential="c")]` gives `{"ice_servers": [{"urls": ["turn:turn.example:443?transport=tcp"], "username": "u", "credential": "c"}]}`.
  - `test_shutdown_cancels_bots`.
  - `test_startup_refuses_misconfigured_live_providers`: the lifespan with `VoiceSettings(_env_file=None, llm_provider="live")` raises `VoiceConfigError` naming `OPENROUTER_API_KEY`.
  - `test_create_app_reads_no_env_file`: with `TASSEL_VOICE_ENV_FILE` pointing at a file holding an invalid mode, `create_app()` succeeds; only entering the lifespan fails.
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
- Consumes:
  - OpenRouter chat completions (`POST https://openrouter.ai/api/v1/chat/completions`).
    - A forced named `tool_choice` is accepted by OpenRouter ([parameters][or-params]) and by Cerebras ([chat completions][cb-chat], [tool use][cb-tools]). Whether OpenRouter forwards it to Cerebras unchanged is UNVERIFIED until Task 20.
    - Tool-call arguments arrive as a JSON string in `choices[0].message.tool_calls[0].function.arguments`.
    - Errors are documented in [errors][or-errors].
  - `OPENROUTER_PROVIDER` and `REASONING_OFF` (Task 6), `FakeScenario` (Task 4), `is_backchannel` (Task 5), `ServerEvents` and `BotContext` (Task 7), `is_note` (Task 1).
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
# sessions_repo, scoped to one learner like every repo call
async def set_ai_title(db, learner_id: UUID, session_id: UUID, title: str, subject: str | None) -> TutoringSession | None
    # UPDATE … SET title, title_source='ai', subject=COALESCE(subject, :subject), last_activity_at=now()
    # WHERE id=:id AND learner_id=:learner AND title IS NULL
async def touch(db, learner_id: UUID, session_id: UUID) -> None
```

- **The request body:**
  - `model`;
  - `messages`: a system line in English ("Write a title of at most 6 words and a subject of at most 3 words for this tutoring session, in {Language}. No quotes, no final period.") and the student's words as the user message;
  - `tools: [TITLE_TOOL]`, and `tool_choice`: `{"type": "function", "function": {"name": "set_session_title"}}` or `"required"`;
  - `provider: OPENROUTER_PROVIDER`, `reasoning: REASONING_OFF`, `max_tokens: 128`, `temperature: 0.2`;
  - no `response_format`.
- **The HTTP call:** headers `Authorization: Bearer …` and `X-OpenRouter-Title: Tassel`. A 400 or 404 whose body mentions "provider" or "parameter" retries once with `"required"`. Any other error or timeout returns None, and is logged without the key.
- **`clamp_suggestion`:**
  - strip whitespace, quotes and final `.,!?。`, and collapse spaces;
  - keep at most 6 words, then at most 80 characters, cut at a word boundary when there is one;
  - the subject keeps at most 3 words and 40 characters;
  - an empty title gives None, and an empty subject gives None.
- **`is_substantive`:** at least 3 words after stripping punctuation, not a backchannel, not a note (`is_note`), and not only greetings and her name (`hi, hello, hey, hola, buenas, 안녕하세요, 안녕, ada, 에이다`).
- **`SessionActivity`** watches final `TranscriptionFrame`s, and user messages in `LLMMessagesAppendFrame` that aren't notes (typed lines; Review I5).
  - On the first substantive one, while the session is untitled, it starts a background task: `suggest` → `set_ai_title` → send `TitleEvent` only if the row changed.
  - After a failure it tries again on the next substantive line, up to `max_attempts`.
  - It calls `touch` at most every `touch_every_s`.
  - It forwards every frame and never blocks the pipeline.
- **The fixture** is a non-streaming response whose `function.arguments` is `"{\"title\": \"Strings that start with 010\", \"subject\": \"Automata · DFA\"}"`, with `finish_reason: "tool_calls"`. It is built from OpenRouter's documented response shape and stays as is. Task 20 saves a real response next to it, as `openrouter-title.recorded.json`.

- [ ] **Step 1: Write the failing tests.**
  - `test_request_pins_cerebras_and_forces_the_tool`: the exact keys above; the named `tool_choice`; and `"response_format" not in body`.
  - `test_parse_the_fixture`: `TitleSuggestion("Strings that start with 010", "Automata · DFA")`.
  - `test_parse_the_recorded_response`: skipped unless `openrouter-title.recorded.json` exists; it parses to a non-empty suggestion of at most 6 words.
  - `test_clamp`:
    - `clamp_suggestion('"Strings That Start With 010 And End Anywhere."', "Automata theory and DFAs")` gives `("Strings That Start With 010 And", "Automata theory and")`;
    - a 90-character Spanish title ends at or under 80 characters on a word boundary;
    - a Korean title of 7 eojeol keeps 6;
    - `clamp_suggestion("  ", None)` is None.
  - `test_substantive` is a table:
    - en: "Hi Ada" is False; the first demo line is True; `"[language switch] The student switched…"` is False.
    - es: "Hola Ada" is False; "Estoy haciendo un AFD" is True.
    - ko: "네" is False; "DFA 문제 풀고 있어요" is True.
  - `test_titler_retries_with_required_when_named_is_refused`:
    - An `httpx.MockTransport` first answers 404 `{"error": {"code": 404, "message": "No allowed providers are available for the selected model"}}`, then the fixture.
    - The result is the suggestion, and the second request has `tool_choice == "required"`.
  - `test_titler_never_logs_the_key` (`caplog`, after a 500).
  - `test_set_ai_title_respects_a_student_title` (`db`):
    - A row with `title_source='student'` is unchanged, and the call returns None.
    - Another learner's row is unchanged.
    - An untitled row gets `title_source='ai'` and the subject.
  - `test_titles_once_on_the_first_substantive_turn`:
    - `run_test(SessionActivity(FakeTitler(dfa-opening), …))` with final transcripts "Hi Ada", then the first demo line, then another long line.
    - One `TitleEvent` is sent, and the database row is titled.
  - `test_typed_lines_count_too`: an `LLMMessagesAppendFrame` with the demo line titles the session.
  - `test_notes_never_title`: an `LLMMessagesAppendFrame` holding `language_switch_note("ko")` doesn't call the titler.
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
- Modify: `voice/bot.py` (add the observer with `worker.add_observer`; log `client-metrics` messages)
- Test: `services/server/tests/voice/test_metrics.py`, `tests/voice/test_latency_report.py`

**Interfaces:**
- Consumes: `FramePushed(source, destination, frame, direction, timestamp)`, where `timestamp` is pipeline-clock nanoseconds ([base_observer.py][pc-observer]); `VADUserStoppedSpeakingFrame.stop_secs` ([frames.py][pc-frames]); `VOICE_BUDGETS` (Task 1). Pipecat's `UserBotLatencyObserver` covers only voice turns and is added only with tracing ([user_bot_latency_observer.py][pc-latency-obs]), so Tassel measures both kinds of turn in one place.
- Produces:

```python
class TurnMetricsObserver(BaseObserver):
    def __init__(self, *, lang: Lang, budget_ms: int, emit: Callable[[TurnMetrics], Awaitable[None]])
class MetricsLog:
    def __init__(self, path: Path | None)     # None: off; else creates the parent directory and appends one JSON line per record
    def turn(self, session_id: UUID, m: TurnMetrics) -> None
    def client(self, session_id: UUID, lang: Lang, m: ClientMetricsEvent) -> None
@dataclass
class LangSummary:
    turns: int
    client_ttfa_p50: int | None; client_ttfa_p90: int | None; server_ttfa_p50: int | None; server_ttfa_p90: int | None
    yield_p90: int | None; silence_p90: int | None; silence_instant_p90: int | None
    ttfa_budget_ms: int; within_budget: bool
def summarize(records: Iterable[dict]) -> dict[Lang, LangSummary]
def main(argv: list[str] | None = None) -> int   # python -m tassel.voice.latency_report <jsonl> [--strict]
```

- **A turn starts** at speech end, for a voice turn (the VAD stop push time minus `stop_secs`), or at an `LLMMessagesAppendFrame` with a student message (not a note), for a typed turn.
- **The fields:**
  - `stt_ms`: to the first finalized `TranscriptionFrame`.
  - `llm_ttfb_ms`: from the next `LLMContextFrame` to the first `LLMTextFrame`.
  - `tts_ttfb_ms`: from that first `LLMTextFrame` to the first `TTSAudioRawFrame`.
  - `server_ttfa_ms`: to `BotStartedSpeakingFrame`.
  - `interrupted`: an `InterruptionFrame` between `BotStartedSpeakingFrame` and `BotStoppedSpeakingFrame`.
- **It emits** at `BotStoppedSpeakingFrame`, or when the next turn starts.
- **Each frame counts once** (by `frame.id`), however many hops it crosses.
- **`summarize`** judges each number against its own budget (P2-R5); percentiles use the nearest rank. `within_budget` holds when all of these do:
  - first audio: the client p90 (or the server p90, when no client data exists) is at or under `ttfa_ms[lang]`;
  - yield: the p90 is at or under `yield_ms`;
  - silence: the p90 of records at `low` or `normal` sensitivity is at or under `silence_ms`;
  - Instant: the p90 of records at `high` is at or under `silence_instant_ms`.

  A metric with no records passes. `--strict` exits 1 when any language misses, and the printed table marks which metric missed.
- **The log path** is `VoiceSettings.voice_metrics_log` (`TASSEL_VOICE_METRICS_LOG`). Playwright empties `test-results/` at the start of a run, so `MetricsLog` creates the directory.

- [ ] **Step 1: Write the failing tests.** Synthetic `FramePushed` sequences, in seconds:
  - `test_voice_turn`:
    - Timeline: VAD stop at 1.00 (`stop_secs` 0.2, so speech ended at 0.80), final transcript 1.05, context 1.06, first LLM text 1.30, first audio 1.45, bot started 1.50, bot stopped 3.0.
    - Result: `TurnMetrics(turn=1, lang="en", input="voice", stt_ms=250, llm_ttfb_ms=240, tts_ttfb_ms=150, server_ttfa_ms=700, interrupted=False, budget_ms=1200)`.
  - `test_typed_turn`: append at 5.0 and bot started at 5.6 give `input="typed"`, `server_ttfa_ms=600` and `stt_ms=None`.
  - `test_a_note_is_not_a_turn`: an append holding `language_switch_note("ko")` starts no turn.
  - `test_interrupted_turn`.
  - `test_duplicate_pushes_count_once`.
  - `test_summarize_judges_each_budget`:
    - client first audio [800, 900, 1000, 1300, 1100]: p50 1000, p90 1300, en misses (budget 1200);
    - yields [200, 250, 280] and Normal silences [450, 500, 580] pass;
    - Instant silences [260, 320] miss (p90 320 > 300).
  - `test_strict_exit_code`: 1 when over budget, 0 when within.
  - `test_log_writes_json_lines_and_creates_the_directory` (`tmp_path / "missing" / "m.jsonl"`).
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
  - The client marks the mic as granted only once `initialize()` reports `onMicUpdated(info)` with a real `deviceId`. Capture starts after bot-ready here, so `initialize()` reports nothing; the client then reruns `initDevices()` on each connect, which is harmless.
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
  sendTrack(): MediaStreamTrack;                   // builds the graph on first call; silent until open(); a fresh track once the last was stopped
  open(opts: MicOptions): Promise<MicStatus>;      // starts capture into the graph
  setDevice(deviceId: string | null): Promise<MicStatus>;   // swaps the source node; the sent track stays the same object
  setEnabled(on: boolean): void;                   // mute (M, the dock's Mic button)
  setGate(open: boolean): void;                    // push-to-talk; sent gain = enabled && gate
  level(): number;                                 // RMS 0..1 before the gains: the dock meter shows her mic works
  sentLevel(): number;                             // RMS 0..1 after the gains: what Ada hears, for the latency meter
  readonly status: MicStatus; readonly deviceId: string | null; readonly openedAt: number | null;  // performance.now() at capture start
  on(listener: (e: MicChange) => void): () => void;
  close(): void;
}
export interface MediaManagerShape { /* every member of mediaManager.ts at small-webrtc-transport-v1.11.0 */ }
export interface TutorAudioLike { setSinks(s: { primary: string | null; presenter: string | null }): Promise<unknown>; readonly presenterSinkId: string | null }
export class TasselMediaManager implements MediaManagerShape {
  constructor(mic: Mic, audio: TutorAudioLike);   // Task 12's TutorAudio satisfies TutorAudioLike
}
export function asTransportMediaManager(m: TasselMediaManager): unknown;   // the cast, documented (P2-R3)
```

- **The graph:** capture source → analyser (`level`) → mute gain → gate gain → analyser (`sentLevel`) → destination (the sent track).
- **`open`** calls `getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: p, noiseSuppression: p, autoGainControl: p, channelCount: 1 } })`.
  - `NotAllowedError` gives `denied`.
  - `NotFoundError` or `OverconstrainedError` on a saved id retries the default once, then gives `unavailable`.
  - `NotReadableError` (the device is busy, or blocked by Windows privacy) and `AbortError` give `unavailable`.
- **On `devicechange`,** if the open device is gone, it reopens the default and emits `device-lost`.
- **The manager:**
  - `initialize()` and `connect()` make sure `mic.sendTrack()` is live.
  - `tracks()` returns `{ local: { audio: mic.sendTrack() } }`.
  - It reports no cameras and no screen share.
  - `updateMic` goes to `mic.setDevice`, and `updateSpeaker` to `audio.setSinks({ primary: id, presenter: audio.presenterSinkId })`.
  - A denied mic still lets `connect()` resolve: the transport then sends silence.

- [ ] **Step 1: Write the failing tests.**
  - `opens with echo cancellation, noise suppression and auto gain`, and `deviceId: { exact: 'mic-2' }` when one is given.
  - `the fake mic turns processing off`.
  - `the sent track exists before capture, and is silent until open()`.
  - `denied permission resolves to denied, not a throw`.
  - `a busy or blocked device resolves to unavailable` (`NotReadableError`, `AbortError`).
  - `a missing saved device falls back to the default once`.
  - `switching devices keeps the same sent track and stops the old capture` (Review Focus 1).
  - `gates multiply`: the mute gain × the gate gives 0 or 1 on the fake `GainNode`, and `sentLevel()` reads 0 while either is shut.
  - `unplugging the open mic reopens the default and reports device-lost` (Review Focus 1).
  - `a stopped sent track is replaced on the next sendTrack()`.
  - `the manager implements every member the 1.11.0 transport reads`: a fixed list of names, each a function or getter.
  - `tracks().local.audio is the mic's sent track`.
  - `enableMic(false) mutes`.
  - `updateSpeaker sets the primary sink`.
  - `no cameras, no screen share`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm install && pnpm --filter @tassel/desktop test live/mic live/media-manager`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror the shape of the transport's own test helper ([fakeMediaManager.ts][fake-mm]).
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop pnpm-lock.yaml pnpm-workspace.yaml && git commit -m "feat(voice-client): Web Audio mic and Tassel's media manager for SmallWebRTC"`

### Task 12: Ada's audio: primary and presenter sinks, ducking, level

**Files:**
- Create: `apps/desktop/src/renderer/src/tutor/live/tutor-audio.ts` (named `TutorAudio`, because P1's stage store already exports `type Speaker`)
- Test: `apps/desktop/tests/unit/live/tutor-audio.test.ts`

**Interfaces:**
- Consumes: `HTMLMediaElement.setSinkId` (Chrome 49) and `new AudioContext({ sinkId })` (Chrome 110) ([MDN setSinkId][mdn-setsinkid], [MDN AudioContext][mdn-ac]). Electron routes a non-default output through `setPermissionCheckHandler`, as `'media'` and as `'speaker-selection'`. P1's handler already allows both for the app's origin.
- Produces:

```ts
export interface Sinks { primary: string | null; presenter: string | null }   // primary null = system default; presenter null = off
export interface TutorAudioDeps { createAudio(): HTMLAudioElement; createContext(opts?: { sinkId?: string }): AudioContext }
export class TutorAudio {
  constructor(deps: TutorAudioDeps);
  attach(track: MediaStreamTrack): void;
  setSinks(s: Sinks): Promise<{ primary: 'ok' | 'fallback'; presenter: 'ok' | 'fallback' | 'off' }>;
  duck(on: boolean): void;            // the element's volume goes to 0.25 at once; the presenter gain ramps over 60 ms; 1 when off
  onDuck(listener: (on: boolean, atMs: number) => void): () => void;   // atMs = performance.now(), for LatencyMeter.markDuck
  level(): number;                    // Ada's RMS 0..1
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
  - Run: `pnpm --filter @tassel/desktop test live/tutor-audio`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(voice-client): Ada's audio with a presenter sink, ducking and level"`

### Task 13: RTVI mapping and the live tutor client

**Files:**
- Create: `apps/desktop/src/renderer/src/tutor/live/rtvi-map.ts`, `tutor/live/live-client.ts`
- Test: `apps/desktop/tests/unit/live/rtvi-map.test.ts`, `tests/unit/live/live-client.test.ts`

**Interfaces:**
- Consumes ([client-js d.ts][cj-dts], [client-js js][cj-js], [transport source][swt-src], [RTVI observer][pc-rtvi-obs]):
  - `new PipecatClient({ transport, enableMic: true, enableCam: false })`. The reconnect flow relies on its default `disconnectOnBotDisconnect: true`;
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
    - `BotOutput({ text, segment_id, spoken_status, spoken_progress: { accumulated_text, remaining_text } })`. Per sentence, a 1.12.0 server sends one `new` message (`accumulated_text: ""`), then progress messages (`in-progress`, then `completed` once `remaining_text` is empty), whose `accumulated_text` covers that sentence only;
    - `ServerMessage(data)`;
    - `TrackStarted(track, participant?)`, which fires for the bot's remote track on unmute, with no participant.
  - The transport rebuilds the peer connection itself on ICE failure, does a full rebuild 5 s after `disconnected`, and retries a failed offer after 2 s, stopping at once on a 4xx. When it gives up, it ends in state `error` and fires `Disconnected`; there is no reconnecting event.
  - Also consumes `parseServerEvent`, `voiceOfferPath`, `OfferRequestData` and `ClientMetrics` (Task 1); `Mic` and `TasselMediaManager` (Task 11); `TutorAudio` (Task 12); and `TutorClient`, `TutorEvent` and `VoiceControls` (P1 and Task 1).
- Produces:

```ts
export type RtviInput =
  | { kind: 'transport'; state: TransportState } | { kind: 'bot-ready' }
  | { kind: 'user-started' } | { kind: 'user-stopped' } | { kind: 'bot-started' } | { kind: 'bot-stopped' }
  | { kind: 'user-text'; text: string; final: boolean }
  | { kind: 'bot-output'; segmentId: string; status: 'new' | 'in-progress' | 'completed' | null; text: string; accumulated: string | null }
  | { kind: 'server'; data: unknown };
export type Effect = { type: 'duck'; on: boolean } | { type: 'reconnect'; when: 'now' | 'after-bot-stops' };
export interface MapState { lang: Lang; botSpeaking: boolean; done: string[]; segment: { id: string; spoken: string } | null }
export function initialMapState(lang: Lang): MapState;
export function mapRtvi(state: MapState, input: RtviInput): { state: MapState; events: TutorEvent[]; effects: Effect[] };
export interface PipecatLike { connect(p: unknown): Promise<unknown>; disconnect(): Promise<void>; on(e: string, h: (...a: any[]) => void): unknown;
  sendText(t: string, o?: object): Promise<string>; sendClientMessage(t: string, d?: unknown): void }
export interface LiveClientDeps {
  serverUrl: string; getToken(): Promise<string>; getIceServers(): Promise<RTCIceServer[]>;
  mic: Mic; audio: TutorAudio; micOptions(): MicOptions; offerData(): OfferRequestData; lang(): Lang;
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
  | `bot-started` | `state speaking`; clears `done` and `segment` |
  | `bot-output` `new` | moves a still-open segment's spoken words into `done`; opens `{ id, spoken: '' }`; no caption yet |
  | `bot-output` `in-progress` | `segment.spoken = accumulated`; an interim tutor caption of `[...done, spoken].join(' ')`; one `word` event per word added since the last update of this `segmentId` |
  | `bot-output` `completed` | pushes `accumulated ?? text` to `done` and clears `segment`; the same interim caption and `word` diff |
  | `bot-output` with no status | ignored (not spoken) |
  | `bot-stopped` | `state listening`; when `[...done, segment.spoken]` isn't empty it becomes a final tutor caption, cut where Ada stopped; clears both; `duck off` |
  | `user-text` | a student caption with its `final` and `lang` |

  `server` data goes through `parseServerEvent`:

  | Server event | Output |
  |---|---|
  | `title` | `title` |
  | `stage` | `stage` with `mode = view` |
  | `language` | `language`; effect `reconnect`, `after-bot-stops` while she speaks, else `now` (state lang updated) |
  | `vad` speaking while the bot speaks | `duck on` |
  | `vad` not speaking | `duck off` |
  | `backchannel` | `voice-debug`, then `duck off` |
  | `route`, `turn-metrics` | `voice-debug` |

  Anything else maps to nothing.
- **`LiveTutorClient`:**
  - **`connect(id)`:**
    1. emit `connection connecting`;
    2. fetch the ICE servers;
    3. build the transport, with the media manager over `mic.sendTrack()`, and the client;
    4. `connect` with endpoint `serverUrl + voiceOfferPath(id)`, `headers: new Headers({ Authorization: 'Bearer ' + token })`, `requestData: offerData()` and `timeout: 15000`;
    5. on `BotReady`: `mic.open(micOptions())`, then emit `mic <status>`.
  - **Reconnect:** an unrequested `Disconnected`, or the state `error`, gives `connection reconnecting` with `attempt`. After the backoff it does a full new connect, with a new transport and client. After 3 failures it emits `connection failed`; `voice.reconnect()` resets the count.
  - **A deferred `reconnect` effect** (`after-bot-stops`) waits for `bot-stopped`, or 3 s, so a spoken language switch never cuts Ada's sentence (P2-R7).
  - **`disconnect()`** never reconnects and emits `connection closed`. The mic and Ada's audio belong to the caller.
  - **`sendText`** emits a final student caption at once (P1's contract), then calls `sendText(text, { run_immediately: true, audio_response: true })`.
  - **`voice.setTalking(held)`:** `mic.setGate(held)`, then `sendClientMessage('tassel', { kind: 'ptt', enabled: true, held })`.
  - **`voice.setSensitivity` and `voice.reportClientMetrics`** send their `ClientEvent`s.
  - **`voice.connectionCount`** counts successful connects.
  - **Audio:** a `TrackStarted` of kind audio goes to `audio.attach`; `duck` effects go to `audio.duck`.

- [ ] **Step 1: Write the failing tests.**
  - **rtvi-map:**
    - `a turn runs listening → thinking → speaking → listening`;
    - `two sentences caption as one line` (Review C1): `new` s1, progress "Hi, I'm Ada." (`completed`), `new` s2, progress "What are", progress "What are we working on today?" (`completed`), `bot-stopped`. The final tutor caption is "Hi, I'm Ada. What are we working on today?", and the interim captions never go blank between the sentences;
    - `an interruption mid-sentence keeps what was said`: the same, but `bot-stopped` arrives after "What are"; the final caption is "Hi, I'm Ada. What are";
    - `one word event per spoken word, across sentences`: the two-sentence run gives `Hi,`, `I'm`, `Ada.`, `What`, `are`, `we`, `working`, `on`, `today?`, in that order;
    - `a UserTranscript and a UserInput both become student captions`;
    - `server events map as in the table`;
    - `vad ducks only while she speaks`;
    - `a language event while she speaks defers the reconnect`;
    - `garbage server data maps to nothing`.
  - **live-client** (a fake `PipecatLike`, a manual clock):
    - `connects with bearer Headers, requestData and a 15 s timeout`;
    - `opens the mic only after bot-ready`;
    - `a typed line shows at once and goes out as send-text with run_immediately`;
    - `a bot audio track goes to Ada's audio`;
    - `an unrequested disconnect reconnects after 1, 2 and 4 s, then reports failed` (Review Focus 4);
    - `an intentional disconnect never reconnects`;
    - `a spoken language switch reconnects after bot-stopped, or after 3 s`;
    - `ptt, sensitivity and metrics messages use the tassel envelope`;
    - `a denied mic still connects and emits mic denied` (Review Focus 3).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test live/rtvi-map live/live-client`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Run the same command plus `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(voice-client): live TutorClient over SmallWebRTC with sentence-aware captions and reconnects"`

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
  set(p: Partial<AudioPrefs>): void; setPresenter(on: boolean, outputId?: string | null): void; reset(): void }>>;
  // zustand persist, key 'tassel.audio-prefs', version 1 (stored as { state, version: 1 })
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
  - An Interruptions `SegmentedControl` (Fewer · Normal · Instant), with its hint.
  - A device-lost line, when `resolveDevice` reports `lost`.
- **`bindPushToTalk`:**
  - On keydown of `code === 'Space'`, it holds when all of these are true: no modifiers; not a repeat; not in `input`, `textarea`, `select` or `[contenteditable]`; and no `[role="dialog"]` open (as P1's `shortcutFor` checks). It then calls `preventDefault`, then `onHeld(true)` once.
  - On keyup: `onHeld(false)`, also with `preventDefault`, so a focused button never clicks.
  - On `blur` or `visibilitychange` to hidden: `onHeld(false)`, if held.
- **English copy** (es and ko written naturally, ko in polite 해요체):
  - `voice.settings.title` "Audio", `voice.settings.open` "Audio settings";
  - `voice.settings.input` "Microphone", `voice.settings.output` "Speaker", `voice.settings.systemDefault` "System default";
  - `voice.settings.presenter` "Presenter mode", `voice.settings.presenterHint` "Ada also plays on a second output, like room speakers. Push-to-talk turns on, because room speakers echo.", `voice.settings.presenterOutput` "Room output";
  - `voice.settings.pushToTalk` "Push-to-talk", `voice.settings.pushToTalkHint` "Hold Space while you talk.";
  - `voice.settings.sensitivityLabel` "Interruptions"; `voice.settings.sensitivity.low|normal|high` "Fewer|Normal|Instant"; `voice.settings.sensitivityHint` "Short replies like “uh-huh” never interrupt Ada, except on Instant.";
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
    - `Space with a dialog open never holds`;
    - `blur releases`;
    - `a hidden document releases`;
    - `Space on a focused button doesn't click it while bound`;
    - `modifiers are ignored`;
    - `unbind removes every listener`.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test live/audio-prefs live/devices live/audio-settings live/push-to-talk`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Before writing UI, read `docs/design-system/DESIGN.md`, `.impeccable/mocks/decision/stage.html` and the session screen's direction contract (`apps/desktop/.impeccable/surfaces/er-src-features-session-sessionscreen-tsx-a096c7a1.md`): pills, hairline borders, no shadows, 12–16 px radii, iris for Ada alone.
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
  sample(atMs: number, micRms: number, botRms: number): Omit<ClientMetrics, 'sensitivity'> | null;
  markDuck(atMs: number): void;
}
export function percentile(values: number[], p: number): number | null;   // nearest rank
export function startLatencySampler(o: { mic: Pick<Mic, 'sentLevel'>; audio: Pick<TutorAudio, 'level'>; meter: LatencyMeter;
  onMetrics(m: Omit<ClientMetrics, 'sensitivity'>): void; intervalMs?: number; now?: () => number }): () => void;   // 20 ms
export const useVoiceDebug: UseBoundStore<StoreApi<{ route: RouteEvent | null; turns: TurnMetrics[]; client: ClientMetrics[];
  backchannels: number; connections: number; micOpenedAt: number | null; push(e: VoiceDebugEvent): void;
  setMicOpenedAt(t: number | null): void; reset(): void }>>;
  // connections counts route events: each bot sends one when it becomes ready
export function LatencyHud(): JSX.Element;
export function DevConsole(props: { onSend(text: string): void }): JSX.Element;
```

- **`LatencyMeter`** watches two signals. The mic signal is `sentLevel`, what Ada hears, so speech that push-to-talk or mute withheld isn't timed.
  - **The mic:** speech starts after `micOnMs` above `micOn`. It ends at the first sample below `micOff` that stays below for `micOffMs`.
  - **Bot audio:** it starts at the first sample above `botOn`. It goes silent at the first sample below `botOff` that stays below for `botOffMs`.

  It reports in two cases.
  - **First audio:** mic speech ends while bot audio is quiet, and bot audio then starts within 10 s. It returns `{ ttfa_ms: botOnset − speechEnd }`.
  - **Barge-in:** mic speech starts while bot audio plays, and bot audio goes silent within 2 s. It returns `{ barge_in_ms: silentAt − micOnset, yield_ms: duckAt − micOnset }`; `yield_ms` is null without a duck. If bot audio keeps playing past 2 s, it was a backchannel and nothing is reported.
- **`LatencyHud`** is mono, top-left of the stage. Its `data-testid` hooks are `hud-route`, `hud-first-audio`, `hud-barge-in`, `hud-yield`, `hud-backchannels`, `hud-connections` and `hud-mic-opened-at`.
  - The route reads like `EN · FAKE · FAKE · FAKE`.
  - `hud-first-audio` shows the latest client `ttfa_ms`. For a typed turn, which has no mic speech to time, it shows that turn's `server_ttfa_ms`, labelled "server".
  - Each value is judged against its own budget (P2-R5): first audio against `ttfa_ms[lang]`, `hud-yield` against `yield_ms`, and `hud-barge-in` against `silenceBudget(sensitivity)`. The session p50/p90 sit beside them.
  - It shows the last turn's server breakdown (STT, LLM, TTS) and the counts of backchannels and connections.
  - A value over budget uses `text-live`, never iris.
- **`DevConsole`** is a labelled text field with Send. Enter sends; whitespace-only input is ignored; it clears after sending.
- **English copy:**
  - `voice.hud.title` "Latency", `voice.hud.firstAudio` "First audio", `voice.hud.bargeIn` "Barge-in", `voice.hud.yield` "Yield", `voice.hud.budget` "Budget {ms} ms";
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
  - `the HUD judges barge-in by sensitivity`: a 450 ms barge-in is within budget at Normal and over at Instant (`text-live`).
  - `the HUD marks a slow first audio`: a client `ttfa_ms` of 1500 in en gets `text-live`.
  - `connections counts route events`.
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

### Task 16: Desktop media plumbing, audio fixtures and the hermetic E2E harness

**Files:**
- Create: `apps/desktop/src/main/voice/switches.ts`, `main/voice/mic-access.ts`, `main/voice/ipc.ts`, `apps/desktop/src/shared/voice-bridge.ts`
- Modify (one-line hooks):
  - `main/index.ts`: `applyVoiceSwitches(app.commandLine)` before `whenReady`, and `registerVoiceIpc({ access: createMicAccess(...), config: readVoiceConfig() })` after it;
  - `main/windows.ts`:
    - `webPreferences.backgroundThrottling: false`, so the voice loop's timers keep running when the window is covered; the default is true ([webPreferences][el-webprefs]);
    - with `TASSEL_FAKE_MIC_ACCESS=denied` (unpackaged), `restrictPermissions` refuses only `media` requests whose `mediaTypes` include `audio`, as an OS denial does. Speaker selection and device labels stay allowed;
  - `preload/index.ts`: expose `voice`;
  - `shared/bridge.ts`: `voice: VoiceBridge` on `TasselBridge`.
- Modify: `.gitattributes` (`*.wav binary`)
- Create: `apps/desktop/tests/fixtures/audio/timelines.json`, `tests/fixtures/audio/make-fixtures.mjs`, and the committed WAVs `silence`, `barge-in-en`, `barge-in-ko`, `ptt-en`, `dfa-en`, `dfa-es` and `dfa-ko`
- Modify:
  - `apps/desktop/tests/e2e/fixtures.ts`: `launchVoice` and `startVoiceSession`;
  - `tests/e2e/global-setup.ts`: `startE2EServer`, and the hermetic server env below.
- Test: `apps/desktop/tests/unit/voice-main/switches.test.ts`, `voice-main/mic-access.test.ts`, `voice-main/fixtures.test.ts`, `voice-main/e2e-env.test.ts`, `tests/unit/windows.test.ts` (extend), `tests/e2e/fake-mic.spec.ts`

**Interfaces:**
- Consumes:
  - `app.commandLine.appendSwitch` before ready ([command-line switches][el-cmdline]). Chromium copies `use-fake-device-for-media-stream` and `use-file-for-fake-audio-capture` from the browser process's command line into the audio service, and `%noloop` plays the file once ([media_switches.cc][cr-switches]);
  - `systemPreferences.getMediaAccessStatus('microphone')` (macOS, Windows) and `askForMediaAccess('microphone')` (macOS only) ([systemPreferences][el-sysprefs]);
  - `shell.openExternal`;
  - P1's `isTrustedUrl` and IPC pattern;
  - Task 1's `scenario_lines`.
- Produces:

```ts
// shared/voice-bridge.ts
export type MicAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
export interface VoiceConfig { devTools: boolean; fakeMic: boolean; devConsole: boolean; canOpenMicSettings: boolean }
  // devTools = !app.isPackaged; devConsole = TASSEL_DEV_CONSOLE === '1'; canOpenMicSettings = micSettingsUrl(platform) !== null
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
export function readVoiceConfig(env?: NodeJS.ProcessEnv, packaged?: boolean, platform?: NodeJS.Platform): VoiceConfig;
// tests/e2e/global-setup.ts
export function e2eServerEnv(base: NodeJS.ProcessEnv, mode: 'fake' | 'live'): NodeJS.ProcessEnv;
export async function startE2EServer(opts: { mode: 'fake' | 'live' }): Promise<() => Promise<void>>;   // the default export calls it with 'fake'
// tests/e2e/fixtures.ts
export type MicFixture = 'silence' | 'barge-in-en' | 'barge-in-ko' | 'ptt-en' | 'dfa-en' | 'dfa-es' | 'dfa-ko';
export function launchVoice(opts?: { mic?: MicFixture; env?: Record<string, string> }): Promise<{ app: ElectronApplication; page: Page }>;
export function startVoiceSession(page: Page, opts: { language: Lang; type?: SessionType }): Promise<string>;  // the new session's id
```

- **`voiceSwitches`:** only unpackaged, with `TASSEL_FAKE_MIC` naming an existing file, it returns `[['use-fake-device-for-media-stream'], ['use-file-for-fake-audio-capture', '<abs>%noloop']]`. There is no `%noloop` when `TASSEL_FAKE_MIC_LOOP=1`. It returns `[]` otherwise, and logs a missing file once.
- **`micSettingsUrl`:**
  - darwin: `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`. This is the same form P3 uses for the camera; on macOS 26.6.2 the Privacy & Security extension (`com.apple.settings.PrivacySecurity.extension`, legacy id `com.apple.preference.security`) contains `Privacy_Microphone`.
  - win32: `ms-settings:privacy-microphone` ([Microsoft][ms-settings]).
  - Else null.
- **`TASSEL_FAKE_MIC_ACCESS`** (unpackaged only) replaces `systemPreferences`. The fake mic reports `granted`.
- **`e2eServerEnv(base, 'fake')`** (P2-R16):
  - copies `base`;
  - deletes the three keys and every `TASSEL_*PROVIDER*` and `TASSEL_VOICE_*` variable;
  - sets `TASSEL_PROVIDERS`, `TASSEL_STT_PROVIDER`, `TASSEL_LLM_PROVIDER`, `TASSEL_TTS_PROVIDER` and `TASSEL_TITLES_PROVIDER` to `fake`;
  - sets `TASSEL_VOICE_ENV_FILE=""`, `TASSEL_FAKE_SCENARIO=dfa-opening`, `TASSEL_FAKE_TTS=tone` and `TASSEL_VOICE_METRICS_LOG=<apps/desktop/test-results/voice-metrics.jsonl>`.

  `'live'` deletes the same overrides but sets `TASSEL_PROVIDERS=auto` and leaves `TASSEL_VOICE_ENV_FILE` unset, so the server reads `services/server/.env`. Nothing in the default config passes `'live'`.
- **`launchVoice`** wraps P1's `launchApp`, adding to its env:
  - `TASSEL_TUTOR=live` and `TASSEL_FAKE_MIC=<abs path of the fixture>` (default `silence`);
  - `TASSEL_FAKE_MIC_LOOP=1` for a fixture with `loop: true`.

  An E2E run therefore never touches a real microphone or a macOS permission prompt. Wrapping `launchApp` means P3's fake-capture pins apply too after the merge.
- **`startVoiceSession`** drives the new-session sheet with source "Just talk" and the given language, then returns the newest session's id through the API, with the app's token.
- **`timelines.json`** (exact):
  - Every clip's transcript is its `say` text unless `transcript` is given. `heard: false` marks a clip push-to-talk must drop.
  - Clip times count from mic capture, which starts at bot-ready (Global Constraints).
  - `live_term` is the word Task 20's live checks expect in each final transcript.

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
    "dfa-en": { "voice": "Samantha", "total_ms": 12000, "scenario": ["dfa-opening", "en"], "live_term": "DFA", "clips": [ { "at_ms": 1500,
      "say": "Hi Ada, I'm working on a DFA for binary strings that start with zero one zero.",
      "transcript": "Hi Ada, I'm working on a DFA for binary strings that start with 010." } ] },
    "dfa-es": { "voice": "Paulina", "total_ms": 12000, "scenario": ["dfa-opening", "es"], "live_term": "AFD", "clips": [ { "at_ms": 1500,
      "say": "Hola Ada, estoy haciendo un AFD para cadenas binarias que empiezan con cero uno cero.",
      "transcript": "Hola Ada, estoy haciendo un AFD para cadenas binarias que empiezan con 010." } ] },
    "dfa-ko": { "voice": "Yuna", "total_ms": 12000, "scenario": ["dfa-opening", "ko"], "live_term": "문자열", "clips": [ { "at_ms": 1500,
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
    - `settings links per platform, and canOpenMicSettings is false on linux`;
    - `openSettings opens only the fixed URL`;
    - `voice IPC refuses untrusted senders`.
  - **windows:**
    - `the main window keeps timers running in the background` (`backgroundThrottling === false`);
    - `with fake access denied, audio capture is refused, and speaker selection and other permissions aren't`.
  - **e2e-env** (Review I7):
    - `fake mode strips keys and pins every provider to fake`: given a base env with `OPENROUTER_API_KEY=x`, `TASSEL_LLM_PROVIDER=live` and `TASSEL_VOICE_EN=v`, the result has no key and no voice id, all five provider settings are `fake`, and `TASSEL_VOICE_ENV_FILE` is `""`;
    - `live mode reads the env file`: `TASSEL_PROVIDERS=auto` and no `TASSEL_VOICE_ENV_FILE`.
  - **fixtures** (node):
    - every WAV in `timelines.json` is RIFF PCM, 16-bit, mono, 16 kHz, of length `total_ms` ±20 ms, and silent for its last 1000 ms;
    - each fixture's heard transcripts are a prefix of Task 1's `scenario_lines` for its scenario and language (Review I9).
  - **E2E `fake-mic.spec.ts`:**
    - `launchVoice({ mic: 'dfa-en' })`, then `getUserMedia({ audio: true })` in the page gives a live audio track;
    - `enumerateDevices()` lists at least two `audiooutput` devices;
    - an `<audio>` element's `setSinkId` to "Fake Audio Output 1"'s id resolves, and `new AudioContext({ sinkId })` on "Fake Audio Output 2" starts running (de-risks Task 19's device spec);
    - `window.tassel.voice.micAccess()` is `granted`;
    - the track is still live 13 s later, after the `%noloop` file has ended;
    - `launchVoice({ env: { TASSEL_FAKE_MIC_ACCESS: 'denied' } })` makes `getUserMedia` reject with `NotAllowedError`, while `enumerateDevices()` still lists outputs.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test voice-main windows && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e fake-mic`
  - Expected: FAIL.
- [ ] **Step 3: Implement, then generate the fixtures on macOS.** Run `node apps/desktop/tests/fixtures/audio/make-fixtures.mjs`, then `--check`.
- [ ] **Step 4: Run them and confirm they pass.** Run Step 2's command. Expected: PASS, and P1's E2E specs still pass.
- [ ] **Step 5: Commit.** `git add .gitattributes apps/desktop && git commit -m "feat(desktop): fake microphone, mic access, settings links, audio fixtures, hermetic E2E server"`

### Task 17: The live client in the tutor contract and stores

*Integration: starts after Teams S, C and D have merged into `claude/p2-voice-loop`.*

**Files:**
- Modify:
  - `apps/desktop/src/renderer/src/tutor/create-client.ts`: `createTutorClient(cfg, deps?)`;
  - `tutor/use-tutor-session.ts`;
  - `features/session/stage-store.ts`;
  - `features/session/Captions.tsx`: an interim line renders the same, without the fade-in on each update;
  - `apps/desktop/tests/unit/use-tutor-session.test.tsx`: delete P1's R16 `patchSession` assertion.
- Create: `apps/desktop/src/renderer/src/features/voice/use-voice-session.ts`, `apps/desktop/tests/e2e/voice-bundle.spec.ts`
- Test: `apps/desktop/tests/unit/use-tutor-session.test.tsx` (extend), `tests/unit/stage-store.test.ts` (extend), `tests/unit/live/use-voice-session.test.tsx`, `tests/e2e/voice-bundle.spec.ts`

**Interfaces:**
- Consumes:
  - Tasks 1 and 11–16;
  - P1's built `useStageStore`, with `pushCaption(speaker, text, lang?)`, `CaptionLine { speaker, text, lang? }`, `micOn` and `toggleMic`;
  - P1's `useCurrentSession.patchLocal`, which needs no change, and `createApiClient`;
  - the generated `/v1/voice/ice-servers` route (Task 8).
- Produces:

```ts
// stage-store additions, keeping P1's signatures
connection: ConnectionStatus; mic: MicStatus | null; setConnection(s: ConnectionStatus): void; setMic(s: MicStatus | null): void;
// CaptionLine gains interim?: true
showInterim(speaker: Speaker, text: string, lang?: Lang): void;   // replaces an interim current line of the same speaker, else shifts
// pushCaption(speaker, text, lang?) now also replaces an interim current line of the same speaker instead of shifting
// create-client.ts
export interface LiveDeps { api: ApiClient; bridge: Pick<TasselBridge, 'getToken'>; voice: VoiceSessionResources;
  micOptions(): MicOptions; offerData(): OfferRequestData; lang(): Lang }
export function createTutorClient(cfg: AppConfig, deps?: LiveDeps): TutorClient;   // 'live' without deps throws
// use-voice-session.ts
export interface VoiceSessionResources { mic: Mic; audio: TutorAudio; meter: LatencyMeter }
export function useVoiceSession(opts: { sessionId: string; lang: Lang; app: AppConfig; config: VoiceConfig; api: ApiClient }): {
  resources: VoiceSessionResources; client: TutorClient | null };
```

- **`createTutorClient`** for `live` builds `LiveTutorClient` with `serverUrl` from the config and `getToken` from the bridge. `getIceServers()` is `api.GET('/v1/voice/ice-servers')`, mapping each `{ urls, username, credential }` to an `RTCIceServer`; this typed call refreshes a stale token once, as P1's client already does.
- **`useTutorSession`** routes the new variants:
  - `connection` and `mic` go to the store;
  - `language` calls `patchLocal({ language })`, since the server already saved it;
  - `word` is ignored for now (P6);
  - `voice-debug` goes to `useVoiceDebug.push`;
  - a caption with `final: false` goes to `showInterim`, and a final one to `pushCaption`;
  - `title` calls **only** `patchLocal`. R16's `patchSession` call is removed, because the server writes AI titles (P2-R4), and the client-only fake tutor's titles become display-only.
- **`useVoiceSession`** owns the session's voice resources.
  - It builds `Mic` and `TutorAudio` from `navigator.mediaDevices`, `AudioContext` and `document`.
  - It applies the prefs: input to `mic.setDevice`; outputs and presenter to `audio.setSinks`; sensitivity to `voice.setSensitivity`.
  - **Mute** (Review I2): it follows the stage store's `micOn`, from M or the dock's Mic button, with `mic.setEnabled(micOn)`. Mute wins over push-to-talk: while muted, holding Space sends nothing.
  - It binds push-to-talk while `pushToTalk` is on, sending `voice.setTalking` and `mic.setGate`; with it off, the gate stays open.
  - It reconnects when `pushToTalk` changes (P2-R8).
  - It runs `startLatencySampler` and attaches the current sensitivity to each result before sending it to `useVoiceDebug` and `voice.reportClientMetrics`. It calls `meter.markDuck(atMs)` from `audio.onDuck` when the duck turns on.
  - It builds the client through `createTutorClient(app, deps)`.
  - It feeds `mic.openedAt` to `useVoiceDebug.setMicOpenedAt`.
  - It disposes everything on unmount.
  - `offerData()` returns `{ scenario: app.fakeScript, sensitivity, ptt: pushToTalk }`, and `micOptions()` returns `{ deviceId: inputId, processing: !config.fakeMic }`.

- [ ] **Step 1: Write the failing tests.**
  - `title events no longer PATCH the session`: `api.PATCH` is never called, and `patchLocal` is.
  - `an interim caption is replaced in place; the final one replaces it too, then the next line shifts`.
  - `captions keep their language`.
  - `connection and mic events reach the store`.
  - `a language event patches the local session`.
  - `voice-debug events reach useVoiceDebug`.
  - `createTutorClient builds a LiveTutorClient for live, and the scripted client for fake`.
  - `M sends silence`: toggling the store's `micOn` calls `mic.setEnabled(false)`, and holding Space while muted keeps the gate's output at 0.
  - `useVoiceSession binds Space only with push-to-talk on, and reconnects when it changes`.
  - `useVoiceSession disposes the mic and Ada's audio on unmount`.
  - **E2E `voice-bundle.spec.ts`** (de-risks the bundle under the real CSP before Task 18; Review Minor 17):
    - `launchVoice()`, then `startVoiceSession(page, { language: 'en' })`;
    - the tile reaches Speaking;
    - no `securitypolicyviolation` event and no console error mentioning Content Security Policy appears.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test use-tutor-session stage-store live/use-voice-session && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e voice-bundle`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `pnpm --filter @tassel/desktop typecheck`.
  - Expected: PASS, and P1's tutor tests too.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(desktop): live tutor wired into the tutor contract and stage store"`

### Task 18: Voice in the session screen, and the conversation E2E

**Files:**
- Modify:
  - `renderer/src/main.tsx`: the boot loads `window.tassel.voice.getConfig()` beside P1's `getConfig()`. When `tutorMode` is `live` it passes `voice={{ app: config, config: voiceConfig }}` to `App`; otherwise it keeps P1's `createTutor`;
  - `app/App.tsx`: forwards `voice` to `SessionScreen`;
  - `features/session/SessionScreen.tsx`: with `voice`, it runs `useVoiceSession` and uses its client instead of `createTutor`. It also mounts the HUD, the dev console and `MicNotice`;
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
    - The Mic button still mutes (M), with P1's names. While push-to-talk is on and the mic is unmuted, its name is `voice.mic.holdSpace` and `pressed` follows the hold; while muted, it keeps P1's "Microphone off" state.
  - **TitleStrip:**
    - The language pill opens `LanguageMenu` (Radix Popover: English · Español · 한국어). Choosing one calls `patchSession({ language })`, then `patchLocal`, then `voice.reconnect()`, and shows `voice.language.switching` until connected.
    - A new AI title types on at about 30 ms per character, instantly under `prefers-reduced-motion` (spec §5.1).
  - **TutorTile:** `voice.connection.connecting` and `voice.connection.reconnecting` while not connected; `voice.connection.failed`, with a Retry button calling `voice.reconnect()`.
  - **MicNotice** sits above the captions while the mic is `denied` or `unavailable`. It offers "Open settings" (`window.tassel.voice.openMicSettings()`) only when `canOpenMicSettings`, and it can be dismissed.
  - **HUD:** only when `devTools`. Ctrl/Cmd+Shift+L toggles it, top-left of the stage.
  - **DevConsole:** when `devTools`, and the route's `stt` is `fake` or `devConsole` is set; bottom-left, above the dock. Neither the HUD nor the console may overlap the dock, captions or tile at 1024×680.
  - **English copy:**
    - `voice.connection.connecting` "Connecting to Ada", `voice.connection.reconnecting` "Reconnecting…", `voice.connection.failed` "Couldn't reach Ada.", `voice.connection.retry` "Retry";
    - `voice.mic.denied` "Tassel can't use your microphone. You can still type to Ada.", `voice.mic.unavailable` "Your microphone isn't available. It may be in use by another app.", `voice.mic.openSettings` "Open settings";
    - `voice.language.menu` "Session language", `voice.language.switching` "Switching to {language}…".

- [ ] **Step 1: Write the failing tests.**
  - **session-voice** (jsdom, fake resources):
    - `the dock shows the live mic level`;
    - `audio settings open from the dock`;
    - `the mic button mutes, and under push-to-talk shows Hold Space to talk`;
    - `the language menu switches and reconnects`;
    - `a failed connection offers Retry`;
    - `a denied mic shows the notice with Open settings` (Review Focus 3), and `without a settings link the notice has no button`;
    - `Ctrl+Shift+L toggles the HUD only in dev`;
    - `the dev console sends typed lines`;
    - `an AI title types on, and appears at once with reduced motion`.
  - **E2E `voice-conversation.spec.ts`:** `launchVoice()`, then `startVoiceSession(page, { language: 'en' })`.
    - The tutor tile goes from Connecting to Speaking, and the greeting caption "Hi, I'm Ada. What are we working on today?" appears whole (two sentences, one caption).
    - The dev console types the first student line, and the student caption shows it.
    - The title strip becomes "Strings that start with 010".
    - The tutor caption "Great, draw it on paper and talk me through it. I'll watch." appears whole.
    - `audio[data-testid=tutor-audio]` has a live audio track and an advancing `currentTime`.
    - After Ctrl+Shift+L (Meta+Shift+L on macOS), the HUD reads `EN · FAKE · FAKE · FAKE`, and its first-audio (server, for a typed turn) is at or under 1200.
    - The line "I think that's it. If it starts with a 1, I just wait on q0 until I see a 0." makes the stage Split, and a caption contains "1010".
    - End session → confirm: the library card shows the title. `GET /v1/sessions/{id}` gives `title_source: 'ai'` and subject "Automata · DFA".
    - At 1024×680 the dock, captions, tile, HUD and console boxes don't intersect.
    - `snap('p2-voice-conversation')`, `snap('p2-voice-1024')` and `snap('p2-library-ai-title')`, kept for the milestone review.
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm --filter @tassel/desktop test session-voice && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e voice-conversation`
  - Expected: FAIL.
- [ ] **Step 3: Implement.** Hold the UI to the session screen's direction contract (`apps/desktop/.impeccable/surfaces/er-src-features-session-sessionscreen-tsx-a096c7a1.md`), `DESIGN.md` and the stage mock.
  - Iris stays Ada's alone, for her ring, caption label and marks; the HUD's over-budget red is `--color-live`.
  - The new dock button keeps the dock a single pill.
  - Every new motion is instant under reduced motion.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run Step 2's command, then `pnpm check && pnpm e2e`.
  - Expected: PASS, and every P1 spec still passes.
- [ ] **Step 5: Commit.** `git add apps/desktop packages/shared/src/i18n scripts/dev.mjs && git commit -m "feat(desktop): voice controls in the session screen with AI title type-on"`

### Task 19: Voice E2E scenarios

**Files:**
- Create: `apps/desktop/tests/e2e/voice-barge-in.spec.ts`, `voice-ptt.spec.ts`, `voice-devices.spec.ts`, `voice-language.spec.ts`, `voice-reconnect.spec.ts`

**Interfaces:**
- Consumes: `launchVoice`, `startVoiceSession` and `MicFixture` (Task 16); the HUD's `data-testid` hooks (Task 15); `VOICE_BUDGETS` and `silenceBudget` (Task 1); the scenarios (Task 4).
- **Timing:** a spec waits relative to `hud-mic-opened-at` (the mic's `performance.now()` at capture start, just after bot-ready), so the WAV timeline and the test agree.
- **Budgets:** latency assertions use `VOICE_BUDGETS` plus `TASSEL_E2E_LATENCY_SLACK_MS` (default 0). It is a visible knob for slow CI hardware, never a silent loosening; the latency report holds the real verdict.

- [ ] **Step 1: Write the specs.**
  - **`voice-barge-in.spec.ts`:**
    - **en, Normal**, with `TASSEL_FAKE_SCRIPT=barge-in` and mic `barge-in-en`, on an English session:
      - the tile shows Speaking (the long greeting);
      - between +4.0 s and +7.0 s it stays Speaking, and `hud-backchannels` becomes 1 ("uh-huh" ignored);
      - after the +7.5 s clip the tile leaves Speaking;
      - `hud-yield` ≤ 300 and `hud-barge-in` ≤ 600 (P2-R5), plus slack; the test logs both;
      - the greeting's final caption is cut before "any time";
      - the reply "Of course. What's your question?" appears;
      - the HUD's first-audio for that reply is at or under 1200, plus slack.
    - **en, Instant** (sensitivity `high`, seeded in `tassel.audio-prefs`): "uh-huh" at +4.0 s interrupts, because Instant skips the filter; `hud-backchannels` stays 0, and `hud-barge-in` ≤ 300, plus slack.
    - **ko, Normal**, with mic `barge-in-ko` on a Korean session: "네" is ignored, "잠깐만요, 질문이 있어요." interrupts within 600 ms, and "네, 말씀하세요." appears with `lang="ko"`.
    - `snap('p2-barge-in-en')`, `snap('p2-barge-in-ko')`.
  - **`voice-ptt.spec.ts`:**
    - Setup: seed `localStorage['tassel.audio-prefs']` with zustand's envelope, `{"state": {…, "pushToTalk": true}, "version": 1}`, and reload; `TASSEL_FAKE_SCRIPT=ptt`, mic `ptt-en`.
    - Until +8 s: no student caption.
    - Then `keyboard.down('Space')` at +8.0 s and `keyboard.up('Space')` at +11.5 s.
    - The student caption "Can you hear me now?" appears, and "Yes, I can hear you clearly." appears only after the release.
    - Typing a space in the dev console types a space and never holds push-to-talk: the mic button stays unpressed (Review Focus 2).
    - With the audio popover open, Space never holds either.
    - `snap('p2-ptt')`.
  - **`voice-devices.spec.ts`:**
    - The audio panel lists the fake inputs and outputs.
    - Choosing "Fake Audio Output 1" sets the `tutor-audio` element's `sinkId` to that device's id.
    - Presenter on, with Room output "Fake Audio Output 2", sets `data-presenter-sink` to its id and turns push-to-talk on.
    - A relaunch with the same `TASSEL_USER_DATA` restores all three.
    - With `TASSEL_FAKE_MIC_ACCESS=denied`, the mic notice shows "Open settings", Ada's greeting still appears, and a typed line still gets its reply (Review Focus 3).
    - `snap('p2-audio-settings')`, `snap('p2-mic-denied')`.
  - **`voice-language.spec.ts`:**
    - **The pill:** on an English session after one exchange, the language pill → 한국어. `hud-connections` reaches 2 and `hud-route` reads `KO · FAKE · FAKE · FAKE`. Typing "왜 죽은 상태가 필요해요?" gets ko's dead-state reply, with `lang="ko"`. `GET` gives `language: 'ko'`.
    - **The spoken request:** on a new session, typing "Can we continue in Korean?" makes the caption "Sure, let's switch to Korean." appear whole (P2-R7: the reconnect waits for Ada). Then it reconnects and shows "좋아요, 이제 한국어로 계속할게요.".
    - `snap('p2-language-ko')`.
  - **`voice-reconnect.spec.ts`:** first student line → reply.
    - Typing `/drop`: `hud-connections` reaches 2 within 10 s and the tile returns to Listening. The greeting caption has appeared exactly once (no re-greeting).
    - The next scripted line gets turn 2's reply, with its `show_stage` (Review Focus 4).
    - `snap('p2-reconnect')`.
- [ ] **Step 2: Run them.**
  - Run: `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e voice-`
  - Expected: PASS. A failure here is a bug in Tasks 2–18: fix it test-first in the owning module, and keep the spec.
- [ ] **Step 3: Commit.** `git add apps/desktop && git commit -m "test(e2e): barge-in, backchannels, push-to-talk, devices, language switch and reconnect"`

### Task 20: Live smoke checks and the one-command live check

**Files:**
- Create:
  - `services/server/src/tassel/voice/smoke.py`, `services/server/tests/voice/test_smoke.py`;
  - `apps/desktop/playwright.live.config.ts`, `apps/desktop/tests/live/global-setup.live.ts`, `apps/desktop/tests/live/voice-live.spec.ts`;
  - `scripts/voice-live-check.mjs`.
- Modify:
  - `apps/desktop/package.json`: script `e2e:live` = `playwright test -c playwright.live.config.ts`;
  - root `package.json`: script `voice:live-check` = `node scripts/voice-live-check.mjs`;
  - `README.md` (a "Voice loop" section) and `CLAUDE.md` (voice commands and rules).

**Interfaces:**
- Produces: `python -m tassel.voice.smoke [--preflight] [--only stt,llm,tts,titles] [--lang en,es,ko]`. It prints one line per check, and returns exit 0 when every check either passes or is skipped for a missing key.
  - `--preflight` only reads `services/server/.env` and lists what's missing, exactly as `check_voice_settings` words it, plus any absent voice id.
  - Each check:

| Check | What it does | Pass |
|---|---|---|
| `llm` | One streamed completion with `OPENROUTER_PROVIDER` and `REASONING_OFF`; then one on a system-only context (the greeting path) | Prints the TTFB and tokens/s. `usage.completion_tokens_details.reasoning_tokens` is 0 (07 open item). The system-only call returns a non-empty greeting |
| `titles` | `OpenRouterTitler.suggest` on the demo line | Prints whether the named `tool_choice` was accepted, and saves the raw response as `tests/voice/fixtures/openrouter-title.recorded.json` |
| `stt` | Runs `DeepgramFluxSTTService` with `attach_flux_interims` on `dfa-en.wav` and `dfa-es.wav`, and `DeepgramSTTService` with Silero VAD on `dfa-ko.wav`, inside a small Pipecat pipeline | Flux gives at least 1 interim frame (P2-R14, the 07 open item) and a final transcript containing the fixture's `live_term` (DFA, AFD); Nova-3 gives a Korean final containing 문자열. It saves Flux's raw TurnInfo messages as `tests/voice/fixtures/flux-turninfo.recorded.json` |
| `tts` | `ElevenLabsTTSService` speaks one sentence per language | Prints the first-audio latency; word timings are present |

- **`voice-live.spec.ts`**, run only by `playwright.live.config.ts`, whose global setup calls `startE2EServer({ mode: 'live' })`. Per language it uses `launchVoice({ mic: 'dfa-<lang>' })` and `startVoiceSession`, and expects:
  - a student caption containing the fixture's `live_term`;
  - a non-empty AI title of at most 6 words;
  - a spoken reply;
  - at least one `turn-metrics` line in `voice-metrics.jsonl`.
- **`voice-live-check.mjs`** (cross-platform, `cross-spawn`) runs four steps, stopping at the first failure with that step's output:
  1. `smoke --preflight`;
  2. `smoke`;
  3. `pnpm --filter @tassel/desktop e2e:live`;
  4. `latency_report <apps/desktop/test-results/voice-metrics.jsonl> --strict`.

  It ends with the latency table against the §2 budgets.

- [ ] **Step 1: Write the failing tests** (no keys, no network).
  - `every check is skipped without its key`: exit 0, and the output contains `skipped: DEEPGRAM_API_KEY not set`.
  - `preflight lists every missing item`.
  - `--only and --lang parse`.
  - `a failed check exits 1` (with a stubbed check).
- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `uv run --directory services/server pytest tests/voice/test_smoke.py -v`
  - Expected: FAIL.
- [ ] **Step 3: Implement**, then write the docs.
  - **README:**
    - the keys and voice ids go in `services/server/.env`, copied from `.env.example`;
    - with `TASSEL_PROVIDERS=auto`, each provider goes live as its key appears;
    - `pnpm voice:live-check` checks everything;
    - the dev console, the HUD, push-to-talk and presenter mode;
    - on macOS, an app launched from a terminal asks for microphone access on the terminal's behalf.
  - **`CLAUDE.md`:**
    - the commands;
    - `launchVoice`, and that `pnpm e2e` never uses the real microphone or live providers;
    - never put keys in the app.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `uv run --directory services/server pytest -v && pnpm check && pnpm test && pnpm e2e`
  - Expected: PASS, and no live run happens.
- [ ] **Step 5: Commit, then push.** `git add services/server apps/desktop scripts package.json README.md CLAUDE.md && git commit -m "feat(voice): live smoke checks, one-command live check and voice docs"`, then `git push -u origin claude/p2-voice-loop`.

**When the keys arrive** (owner or agent; about 15 minutes):
1. Copy `services/server/.env.example` to `services/server/.env`. Fill in `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY` and the three `TASSEL_VOICE_*` ids, and keep `TASSEL_PROVIDERS=auto`.
2. Run `pnpm voice:live-check`. Expected: every step passes and the table shows each language against its budgets.
   - A failed smoke check names its provider.
   - A budget miss names the metric. It becomes a tuning task: Flux `eot_threshold`, VAD `stop_secs`, the Smart Turn parameters, or `max_tokens`.
3. Commit the two `.recorded.json` fixtures with a test run (`uv run --directory services/server pytest tests/voice -v`).
4. Record the table in the P2 ledger, and revisit P2-R7 (a seamless Flux→Nova-3 switch) with the live data.

---

## P2 milestone (R30)

Once Task 20 is committed:
- **App QA:** the app tester runs every voice spec plus exploratory sessions. Cover en, es and ko; 1440×900 and 1024×680; keyboard alone; mic denied; device unplugging; and repeated reconnects. Review the `p2-*` screenshots.
- **Design pass:** the design reviewer checks the dock, the audio popover, the HUD, the dev console, the mic notice, the language menu and the title type-on against the direction contract. One round of fixes, each with its regression test.
- **Owner at the Mac** (an agent's shell can't answer macOS permission prompts, roadmap working rule):
  - `pnpm dev` on the real microphone, on fakes: greeting, barge-in, a backchannel, push-to-talk, presenter mode with real outputs.
    - Once P3 has merged, `pnpm dev` defaults to P3's fake paper clip, which fakes every Chromium device. Start this run with `TASSEL_PAPER_SOURCE=deskview-helper` (PowerShell: `$env:TASSEL_PAPER_SOURCE='deskview-helper'`).
  - The mic settings link opens Privacy & Security → Microphone. Set `TASSEL_FAKE_MIC_ACCESS=denied` (PowerShell: `$env:TASSEL_FAKE_MIC_ACCESS='denied'`).
  - With keys, one live session per language.
- **Post the milestone screenshots** and the latency table to the team's Discord.

## Review response

The independent review (`.superpowers/sdd/2026-10-17-p2-voice-loop/plan-review.md`) found 1 Critical, 12 Important and 21 Minor. This revision fixes the Critical, every Important and every Minor. Where it took a different route than the review suggested, here is why:
- **I5 (notes counted as typed lines):** notes are recognised by a leading `[` (`is_note`), rather than by "only RTVI `send-text` content". RTVI's `send-text` pushes a plain `LLMMessagesAppendFrame` with no marker ([processor.py L468–495][pc-rtvi-proc]), so its origin can't be told apart downstream. The `[` convention also covers P4's vision notes.
- **I7 (E2E isolation):** pinning the four provider variables in global setup wasn't enough on its own. The live E2E also moves to its own Playwright config, so `pnpm e2e` can't go live even with keys and overrides set.
- **I11 (paper sessions after the P3 merge):** voice specs start "Just talk" sessions, instead of setting `TASSEL_PAPER_SOURCE=fake-clip`. A fake clip would turn on Chromium's fake devices for the camera, and would tie P2's specs to P3's settings.
- **Minor 5 (Korean at Fewer):** `MIN_WORDS` is per language (ko stays at 1), instead of counting Hangul syllables. That is simpler, and the backchannel lexicon already filters "네".
- **Minor 18 (WAV timing):** the clips aren't moved. Capture now starts at bot-ready, which anchors every fixture to the bot on any machine.
- **Instant's 300 ms in E2E:** asserted as the coordinator asked. `TASSEL_E2E_LATENCY_SLACK_MS` exists for slow CI hardware, and defaults to 0.

---

## Sources

Pipecat sources are at tag `v1.12.0`; client packages at the published versions. These are the files the verification helpers, the planner and the plan reviewer read on 2026-10-17.

[pc-pyproject]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/pyproject.toml
[pc-pypi]: https://pypi.org/pypi/pipecat-ai/1.12.0/json
[pc-changelog]: https://github.com/pipecat-ai/pipecat/blob/v1.12.0/CHANGELOG.md
[pc-pipeline]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/pipeline/pipeline.py
[pc-worker]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/pipeline/worker.py
[pc-runner]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/workers/runner.py
[pc-base-object]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/utils/base_object.py
[pc-swrtc-conn]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/smallwebrtc/connection.py
[pc-swrtc-transport]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/smallwebrtc/transport.py
[pc-swrtc-handler]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/smallwebrtc/request_handler.py
[pc-run]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/runner/run.py
[pc-transport-params]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/transports/base_transport.py
[pc-rtvi-proc]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frameworks/rtvi/processor.py
[pc-rtvi-obs]: https://raw.githubusercontent.com/pipecat-ai/pipecat/v1.12.0/src/pipecat/processors/frameworks/rtvi/observer.py
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
[ps-settings]: https://docs.pydantic.dev/latest/concepts/pydantic_settings/
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
