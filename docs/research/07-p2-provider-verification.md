# P2 voice loop: provider and library verification (2026-10-17)

*Five research helpers checked these against primary docs, package registries and source code on 2026-10-17, for the P2 (Voice loop) plan. A sixth helper, on Pipecat's server core (transports, pipeline and runner, RTVI), was stopped before it reported, so that area still needs checking. VERIFIED means read in a primary source today. UNVERIFIED means inferred or not fetched. No paid API calls were made.*

## Decisions this forces on the P2 plan

1. **Pin Pipecat 1.12.0, not 1.6.x.** The spec (§4.2) says "Pipecat 1.6.x (pinned)". 1.12.0 (2026-09-26) is current; Flux turn signalling changed in 1.8 and eager end-of-turn arrived in 1.9. The P2 plan needs a ruling to bump the pin.
2. **Korean can't use Flux.** Flux Multilingual covers en, es, fr, de, hi, ru, pt, ja, it and nl. Korean runs on Nova-3 `ko` with Silero VAD and Smart Turn v3.2. English and Spanish run on Flux `flux-general-multi`, with no Smart Turn on top (it would stop Flux driving turns).
3. **AI titles need a forced tool call.** Cerebras on OpenRouter doesn't accept `response_format` or `structured_outputs`.
4. **Turn reasoning off on every LLM call:** `reasoning: {"effort": "none"}`. Qwen3.8 reasons by default at effort `xhigh`.
5. **The browser client needs a custom `mediaManager`.** SmallWebRTC's default `DailyMediaManager` downloads Daily's call-machine bundle and runs it with `Function()`, which our CSP blocks (no `unsafe-eval`). It also fails offline.
6. **Presenter mode can't use two `<audio>` elements on different devices.** Chromium shares one WebRTC audio renderer per page, so the last `setSinkId` wins. Use one `<audio>` plus an `AudioContext({sinkId})`.
7. **Move title writing to the server in P2.** P1's ruling R16 persists the fake tutor's title with a client PATCH, which records `title_source = student`. The server-side titler should write `title_source = ai`, and the client PATCH goes away.

## Pipecat server: services (VERIFIED against source at v1.6.0, v1.12.0 and main `bebb672`)

**Renames since 1.0:**
- Config moved into `settings=<Service>.Settings(...)`; `InputParams`, `LiveOptions`, `voice_id=` and `model=` are deprecated until 2.0.
- `PipelineTask` is now `PipelineWorker` (`pipecat.pipeline.worker`) and `PipelineRunner` is now `WorkerRunner` (`pipecat.workers.runner`), since 1.3.0.
- Short imports were removed: use the full path, e.g. `pipecat.services.openai.llm`.

**Deepgram Flux STT**
- **Class:** `DeepgramFluxSTTService` in `pipecat.services.deepgram.flux.stt`.
- **Constructor:** `api_key`, `url="wss://api.deepgram.com/v2/listen"`, `sample_rate`, `flux_encoding="linear16"`, `should_interrupt=True`, `enable_eager_end_of_turn=False` (1.9+), `settings=`.
- **Settings:** `model` (`flux-general-en` or `flux-general-multi`), `eot_threshold`, `eager_eot_threshold`, `eot_timeout_ms`, `keyterm=[...]`, `language_hints=[Language.ES, ...]`, `numerals`, `min_confidence`.
- **Turns:** since 1.8 Flux emits proposed start/stop frames and tells the user aggregator to use `ExternalUserTurnStrategies`. Passing your own `user_turn_strategies` replaces that. VAD is optional (metrics only).
- **Live updates:** `language_hints`, `keyterm` and the thresholds change without reconnecting. Changing `model` or `redact` reconnects once the user stops speaking.

**Deepgram Nova-3 (Korean)**
- **Class:** `DeepgramSTTService` in `pipecat.services.deepgram.stt`.
- **Settings:** `model="nova-3-general"`, `language=Language.KO`, `interim_results=True`, `endpointing`, `utterance_end_ms`, `keyterm`.
- **Finalize:** it sends Deepgram's `Finalize` on `VADUserStoppedSpeakingFrame`, so pair it with Silero VAD.

**Switching mid-session**
- Use `STTUpdateSettingsFrame(delta=...Settings(language=...))`; for Nova-3 it reconnects after the current turn and replays buffered audio.
- To swap services, use `ServiceSwitcher(services=[...], strategy_type=ServiceSwitcherStrategyManual)` with `ManuallySwitchServiceFrame`.
- UNVERIFIED risk: after switching from Flux to Nova-3, Flux's external turn strategies may stay in place. Test that path.

**ElevenLabs TTS**
- **Class:** `ElevenLabsTTSService` uses `/v1/text-to-speech/{voice}/multi-stream-input` with one `context_id` per bot turn, closing the context at turn end and on interruption.
- **Settings:** `voice`, `model="eleven_flash_v2_5"`, `language`, `stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed` (0.7–1.2), `apply_text_normalization`.
- **Alignment:** Pipecat sums the per-chunk timings into running offsets and emits words as `TTSTextFrame`s with `pts`. Korean words are split on whitespace.
- **Changing voice, model or language** (`TTSUpdateSettingsFrame`) reconnects immediately, so do it between turns.

**OpenRouter LLM**
- **Class:** `OpenRouterLLMService` in `pipecat.services.openrouter.llm`, `base_url="https://openrouter.ai/api/v1"`.
- **On released versions,** put routing in `Settings(extra={"extra_body": {"provider": {...}, "reasoning": {"effort": "none"}}})`. A top-level `provider` key raises `TypeError`. A `Settings(provider=...)` field exists only on unreleased main.

**Turn detection**
- **Smart Turn v3.2:** `LocalSmartTurnAnalyzerV3` (`pipecat.audio.turn.smart_turn.local_smart_turn_v3`). The 8.7 MB ONNX model ships in the package, and it covers 23 languages including Korean and Spanish. It runs in 10–100 ms on CPU.
- **Silero VAD:** `SileroVADAnalyzer` (`pipecat.audio.vad.silero`), passed through `LLMUserAggregatorParams(vad_analyzer=...)`. The transport-level option was removed in 1.0. Defaults: `stop_secs=0.2` (recommended with Smart Turn), `start_secs=0.2`, `confidence=0.7`, `min_volume=0.6`.
- **Backchannel filter:** `MinWordsUserTurnStartStrategy(min_words=3, use_interim=True)` from `pipecat.turns.user_start`, in `UserTurnStrategies(start=[...])`. It applies only while the bot speaks. Words are counted by spaces, so "네" counts as 1. The old `MinWordsInterruptionStrategy` was removed in 1.0.
- **Muting and push-to-talk:**
  - `user_mute_strategies=[...]` replaces `STTMuteFilter`, which was removed in 1.0.
  - `STTMuteFrame(mute=True)` stops audio reaching the STT service.
  - There is no server-side push-to-talk; write a custom mute strategy toggled at runtime.
- UNVERIFIED: whether v1.12.0 Flux sends interim transcripts on `Update` events, which `use_interim=True` depends on.

Sources: https://github.com/pipecat-ai/pipecat (tags v1.6.0, v1.12.0), https://docs.pipecat.ai/api-reference/server/services/stt/deepgram, https://github.com/pipecat-ai/smart-turn

## Pipecat browser client and Chromium (VERIFIED from npm tarballs and source)

**Versions** (all published 2026-10-16):

| Package | Version |
|---|---|
| `@pipecat-ai/client-js` | 1.14.0 |
| `@pipecat-ai/small-webrtc-transport` | 1.11.0 (peer `client-js ~1.14.0`, dep `@daily-co/daily-js ^0.94.0`) |
| `@pipecat-ai/client-react` | 1.9.0 |
| `@pipecat-ai/websocket-transport` | 1.8.0 |

Electron 44.9.0 runs Chromium 152.0.7977.167.

**Connecting**
- Call `connect({ webrtcRequestParams: { endpoint, headers, requestData, timeout }, iceConfig: { iceServers } })`. `webrtcUrl` and `connectionUrl` are deprecated.
- `headers` must be a `Headers` instance. A plain object throws inside an async path, and `connect` then never resolves unless `timeout` is set.
- **Offer body:** `{sdp, type, pc_id, restart_pc, requestData}`. Trickle ICE PATCHes the same endpoint every 200 ms.
- **CORS** on the offer endpoint: allow origin `app://tassel`, headers `authorization` and `content-type` explicitly, and methods POST and PATCH.

**Events**
- `UserTranscript`, `BotLlmText` and `BotTtsText` are deprecated in 1.14.0. Use `UserInput` `{text, input_type: transcription|chat|backchannel, final, …}`, `BotOutput` `{text, text_type, segment_id, will_be_spoken, spoken_status, spoken_progress}`, and the `SttRawText`, `LlmRawText` and `TtsRawText` events.

**Bot audio**
- The transport creates no `<audio>` element. The bot track arrives through `TrackStarted`, and the app attaches it.
- `updateSpeaker` doesn't reroute it; call `setSinkId` on the element yourself.

**Echo cancellation**
- The transport never calls `getUserMedia` itself; Daily's remote bundle sets the constraints. Supply your own `mediaManager` to control echo cancellation, noise suppression and auto gain.

**Fake media for E2E** (Chromium 152 source)
- **Flags:** `--use-fake-device-for-media-stream` plus `--use-file-for-fake-audio-capture=<path.wav>[%noloop]`.
- **WAV:** 8, 16 or 32-bit integer PCM or float; 24-bit is rejected. Turn off audio processing or the file plays back distorted.
- **Permissions:** `--use-fake-ui-for-media-stream` skips the permission delegate, so Electron's `setPermissionRequestHandler` isn't called. Don't combine it with `--auto-accept-camera-and-microphone-capture`; that crashes on purpose.
- **Where to set them:** set the switches with `app.commandLine.appendSwitch` at the top of a CommonJS main, or pass them as Playwright `args` (UNVERIFIED).
- **Fake devices:** `enumerateDevices` returns fake inputs plus "Fake Default Audio Output" and "Fake Audio Output 1/2".

**Platform**
- **`app://` scheme:** must be privileged `standard` and `secure`, or `navigator.mediaDevices` is undefined. P1's `registerAppScheme` already sets `standard: true, secure: true`.
- **Mic permission (UNVERIFIED):** `getMediaAccessStatus('microphone')` works on macOS and Windows. `askForMediaAccess` is macOS-only. Packaging (P10) needs `NSMicrophoneUsageDescription` and the `com.apple.security.device.audio-input` entitlement.

## Deepgram (VERIFIED from developers.deepgram.com)

**Flux**
- **Endpoint:** `wss://api.deepgram.com/v2/listen`, with models `flux-general-en` and `flux-general-multi`.
- **`language_hint`:** repeatable, and only on `-multi`; on `-en` it returns 400. Flux has no `language=` parameter.
- **Hints mid-stream:** `{"type":"Configure","language_hints":[...]}`; an empty list goes back to auto-detect.
- **Detected language per turn:** TurnInfo `languages` and `languages_hinted`. Treat both as optional.

**Flux parameters**
- `encoding`: linear16, linear32, mulaw, alaw, opus or ogg-opus.
- `sample_rate`: 16000 recommended, mono, in 80 ms chunks.
- `eot_threshold`: 0.5–1.0, default 0.7.
- `eager_eot_threshold`: 0.3–0.9, must be ≤ `eot_threshold`.
- `eot_timeout_ms`: default 5000.
- `keyterm`: up to 500 tokens.
- `numerals`, `profanity_filter`, `redact`.

**Flux messages**
- **TurnInfo:** `event` is Update, StartOfTurn, EagerEndOfTurn, TurnResumed or EndOfTurn. Fields: `turn_index`, `transcript`, `words[]`, `end_of_turn_confidence`, and `trigger` (model, manual or timeout) on EndOfTurn.
- **Client messages:** `CloseStream`, `ForceEndTurn` and `Configure`. `CloseStream` sends no EndOfTurn.

**Nova-3 Korean**
- **Model:** `model=nova-3&language=ko` (or `ko-KR`), improved on 2026-08-04.
- **Keyterms:** supported, with no Korean-specific evidence of how well. Limits: 500 tokens, 20–50 terms suggested.
- **No code-switching:** Korean and English can't mix in one stream (`language=multi` covers only Flux's 10 languages).
- **Defaults:** `endpointing` 10 ms; `utterance_end_ms` 1000–5000 (needs `interim_results=true`).

**Auth and SDK**
- **Server:** `Authorization: Token <key>`.
- **Temporary tokens:** `POST /v1/auth/grant {"ttl_seconds": N}` (default 30 s, maximum 3600), used as `Bearer <jwt>`. Whether Bearer works on `/v2/listen` is UNVERIFIED.
- **Python SDK:** `deepgram-sdk` 7.13.0 (needs Python ≥ 3.10); Flux through `client.listen.v2.connect`.

Sources: https://developers.deepgram.com/reference/speech-to-text/listen-flux, https://developers.deepgram.com/docs/flux/language-prompting, https://developers.deepgram.com/docs/flux/configuration, https://developers.deepgram.com/docs/models-languages-overview, https://developers.deepgram.com/changelog

## ElevenLabs (VERIFIED from elevenlabs.io/docs)

- **Model:** `eleven_flash_v2_5` is current; Turbo v2.5 is the deprecated one. It covers 32 languages including en, es and ko.
- **Latency:** about 75 ms model time. Time to first audio over a WebSocket is 100–150 ms in North America, Europe and Southeast Asia, and 150–200 ms in Northeast Asia.
- **`language_code`:** enforces the language for the model and normalization. Unsupported values are ignored.
- **Text normalization:** off by default on Flash v2.5, and turning it on is Enterprise-only. So the LLM must spell out symbols and numbers, as the spec already says.
- **multi-stream-input:**
  - **URL:** `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/multi-stream-input`. Always pass `model_id` (the default is multilingual v2).
  - **Auth:** the `xi-api-key` header.
  - **Client messages:** `{text, context_id, flush?}`, `{context_id, close_context: true}`, `{close_socket: true}`.
  - **Server messages:** `{audio, alignment, normalizedAlignment, contextId}` and `{isFinal: true, contextId}`.
  - **Alignment keys:** `charStartTimesMs`, `charDurationsMs` and `chars`. Times restart at 0 for each chunk.
  - **Limits:** at most 5 contexts per connection; the inactivity timeout defaults to 20 s and goes up to 180 s.
  - **Barge-in:** close the old context and drop late chunks by `contextId`.
- **Concurrency:** Creator allows 10 Flash streams and Pro 20. Only generation time counts.
- **Python SDK:** `elevenlabs` 2.73.0.

Sources: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-multi-stream-input, https://elevenlabs.io/docs/overview/models, https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/multi-context-web-socket

## OpenRouter (VERIFIED from openrouter.ai docs, OpenAPI spec and endpoints API)

**The model**
- `qwen/qwen3.8-27b` (canonical `qwen/qwen3.8-27b-20260814`) has 20 providers, Cerebras among them.
- **Cerebras endpoint** `cerebras/fp16`:
  - 65,536 context and 32,768 max output.
  - $0.99/M input and $1.49/M output.
  - P50 0.58 s latency and 490 tokens/s; with reasoning effort none, 0.21 s and 538 tokens/s.
- **Parameters Cerebras accepts:** `reasoning`, `max_tokens`, `temperature`, `top_p`, `stop`, `seed`, `tools`, `tool_choice`, and the penalties. **Not** `response_format` or `structured_outputs`.

**Routing**
- **Pin with no fallback:** `"provider": {"only": ["cerebras"], "allow_fallbacks": false, "require_parameters": true}`.
- **Things that can rule Cerebras out:** sending `tools` or `response_format` narrows the provider pool, and `max_tokens` above 32,768 excludes Cerebras.
- **Errors:**
  - When no provider matches, you get 404 "No allowed providers…" or 503.
  - Mid-stream errors arrive with HTTP 200, as a chunk with a top-level `error` and `finish_reason: "error"`.
  - `error.code` may be a string or an integer.

**Streaming**
- The stream carries `: OPENROUTER PROCESSING` keep-alive comments and ends with `data: [DONE]`.
- Usage always arrives in the last chunk before `[DONE]`.
- Tool calls arrive in `delta.tool_calls[]`; concatenate `function.arguments` by `index`.

**Latency and headers**
- `sort: "latency"` and `preferred_max_latency` are soft preferences; there is no hard cap.
- `session_id` keeps a conversation on one provider for about 10 minutes.
- **Headers:** `Authorization: Bearer <key>`, plus optional `HTTP-Referer` and `X-OpenRouter-Title`. The response carries `X-Generation-Id`.

Sources: https://openrouter.ai/qwen/qwen3.8-27b, https://openrouter.ai/docs/guides/routing/provider-selection, https://openrouter.ai/docs/api_reference/streaming, https://openrouter.ai/docs/api_reference/errors-and-debugging, https://openrouter.ai/docs/guides/best-practices/latency-and-performance

## Still to verify before or during P2

- **Pipecat server core:**
  - the SmallWebRTC transport on the server (`SmallWebRTCConnection` and the offer endpoint);
  - `PipelineWorker`/`WorkerRunner` wiring;
  - the RTVI processor and observer;
  - transcript and metrics frames, and how P2 maps them onto Tassel's `TutorEvent`s.
- **Live behavior:**
  - whether Cerebras really returns zero reasoning tokens with effort `none`;
  - Bearer tokens on Flux;
  - Flux interim transcripts on 1.12.0;
  - the Flux-to-Nova-3 switch path.
