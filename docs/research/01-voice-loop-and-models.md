# Voice loop & models research

*Voice-loop sub-team, 2026-10-17. Covers Q1–3 and Q6–8; Q4–5 are in `00-flagged-items.md`. [Sn] tags point to Sources. "Vendor" means the vendor's own claim, ESTIMATE means our own number, and UNVERIFIED means not confirmed in a primary source.*

## Bottom line

- **Run the voice loop on Pipecat, self-hosted on a Vultr VM.** It gives us barge-in handling, Korean-capable turn detection, word timestamps and custom events. It doesn't reduce provider credits, and Pipecat Cloud costs extra and doesn't run on Vultr. Choose it because it's better, not because it's cheaper. [S28][S33][S40]
- **Speech-to-text needs two Deepgram models.** Flux Multilingual covers English and Spanish and has built-in end-of-turn detection. Korean needs Nova-3 `ko`, which has neither that detection nor code-switching. Korean turn-taking is the top demo risk. [S1][S2][S6]
- **Text-to-speech: ElevenLabs Flash v2.5.** It speaks English, Spanish and Korean, starts audio in ~200 ms, costs $0.04 per 1K characters, and returns per-character timings for lip-sync. Eleven v4 Turbo (2026-09-28) needs a different socket, so try it later. [S12][S13][S22]
- **Accent must be chosen per language.** A voice keeps its original accent in every language it speaks. [S21]
- **Opus 5.5 exists** (`claude-opus-5-5`, $4/$20 per million tokens, reads images, "Moderate" latency, thinking always on). Use it for background work, never for live replies. [S42]
- **Jev exists** (TypeSafe AI), and its docs say it is English-first. The spec is right on this point. [S45]
- **ElevenLabs Agents is a Plan B only.** It costs $0.08/min plus the LLM, replaces Deepgram, and has no clean way to make the tutor interrupt on its own. [S18][S24]
- **Keys stay on Vultr.** Electron holds only a session token. [S11][S19]

## Findings

### 1. Deepgram (speech-to-text)

| Model | Korean | Spanish | End-of-turn detection | Price per min (promo / standard) |
|---|---|---|---|---|
| Flux `flux-general-en` | no | no | model-based, ~260 ms (vendor) | $0.0065 / $0.0077 |
| Flux Multilingual `flux-general-multi` (GA 2026-04-29) | **no** | yes | model-based, under 400 ms (vendor) | $0.0078 (promo; standard not listed) |
| Nova-3 monolingual | **yes** (`ko`, `ko-KR`) | yes | silence-based `endpointing` | $0.0048 / $0.0077 |
| Nova-3 `language=multi` | no | yes | silence-based | $0.0058 / $0.0092 |

Sources: [S1][S2][S4][S10]

- **Flux Multilingual** covers 10 languages (en, es, fr, de, hi, ru, pt, ja, it, nl) and can switch between them mid-conversation. No code-switching option includes Korean. [S1][S2]
- **Flux events.** Flux runs on `/v2/listen` and sends `EagerEndOfTurn`, `TurnResumed` and `EndOfTurn` events. `eot_threshold` defaults to 0.7 and `eot_timeout_ms` to 5000. Eager mode adds 50–70% more LLM calls. [S3][S4]
- **Nova-3 turn ends.** Nova-3 ends a turn on silence: `endpointing`, default 10 ms, sets `speech_final`. Its Korean models were improved on 2026-08-04. [S5][S7]
- **Key terms.** Keyterm prompting (up to 500 tokens, +$0.0013/min) can boost words like "DFA" and "상태" (state). We haven't confirmed how English terms inside Korean speech get transcribed, so test it. [S8][S9]
- **Credit and limits.** New accounts get $200 of free credit, and you can run 150 concurrent streams. [S10]
- **Client-side calls are safe.** The server mints short-lived tokens (30 s by default) with `POST /v1/auth/grant`. A token only has to be valid when the socket opens. [S11]

### 2. ElevenLabs (text-to-speech)

- **Latency.** Flash v2.5 takes ~75 ms (vendor), or 197 ms measured with network. Its 32 languages include Korean, US/UK/AU/CA English and Spain/Mexico Spanish. v4 Turbo takes ~150 ms to first speech (vendor) and covers 90+ languages. v3 Conversational takes ~280 ms and Multilingual v2 ~1 s. Turbo v2.5 is deprecated. [S12][S17][S22]
- **Streaming text in.** The `stream-input` WebSocket takes text in pieces. Send `flush: true` at each clause end; otherwise it waits for 120 characters before speaking. `multi-stream-input` can cancel one utterance on barge-in without dropping the connection. v4 Turbo works only on the Text-to-Dialogue socket, which allows one voice per connection and buffers ~40 characters plus 8 words before audio starts. [S13][S14][S15][S16]
- **Lip-sync data.** Each audio chunk carries `chars`, `charStartTimesMs` and `charDurationsMs`. Times restart at each chunk, so keep a running offset. For Korean, split each syllable into its parts with Unicode arithmetic and map the vowel to a mouth shape. Pipecat already emits word timings in sync with playback. [S13][S38][S50]
- **Voices.** A voice keeps "its original accent" across languages [S21]. So offer accents within each language (US/UK English, Mexican/Castilian Spanish) using native female voices. Pin `language_code` and listen-test every Korean voice. Flash doesn't normalize numbers, so the LLM must spell out "q0" or "δ". [S12][S20]
- **Price and limits.** Flash and v4 Turbo cost $0.04 per 1K characters; multilingual models cost $0.08. Creator ($22/month) includes 550K Flash characters and 10 concurrent streams; Pro ($99) includes 2.475M and 20. Sockets close after 20 s idle. Client tokens are single-use and expire after 15 minutes. [S12][S18][S19]
- **ElevenLabs Agents (all-in-one).** What fits: client tools could drive the whiteboard, `sendContextualUpdate` passes vision notes without triggering a reply, `onAudioAlignment` gives character timings, and a custom LLM plugs in via an OpenAI-compatible URL. The catch: forcing a reply needs `sendUserMessage`, which looks like a student turn. Speech recognition is ElevenLabs' own, with Korean unconfirmed, and it costs $0.08/min plus the LLM. Fallback only. [S18][S23][S24][S25][S26][S27]

### 3. Pipecat

- **What it is.** A Python framework (BSD-2, v1.6.0). It has services for Deepgram (Flux and Nova), ElevenLabs, OpenRouter, Cerebras, OpenAI and Anthropic, plus JS, React and mobile clients and SmallWebRTC, Daily, LiveKit and WebSocket transports. [S28][S29][S30]
- **Barge-in.** When the student starts talking, Pipecat cancels the LLM and TTS and drops audio that hasn't played. Only the words actually spoken go into the conversation history. A minimum-words rule or Krisp's filter stops "네"/"uh-huh" (short acknowledgements) from cutting the tutor off. This matters in Korean, where listeners give such acknowledgements constantly. [S33]
- **Turn detection.** Smart Turn v3.2 is bundled and on by default, and runs on top of Silero voice-activity detection. It has 8M parameters, covers 23 languages including Korean and Spanish, and takes ~65 ms on a CPU. With Flux, Pipecat uses Flux's own end-of-turn events instead. [S35][S36][S39]
- **Transports and Electron.** SmallWebRTC needs no third-party service but does need STUN/TURN, and its docs aim it at development and testing. The docs suggest Daily for production; WebSocket copes worse with packet loss. The client packages (`@pipecat-ai/client-js`, `@pipecat-ai/small-webrtc-transport`) are browser libraries. There are no Electron docs, but Electron's renderer is Chromium (low risk, UNVERIFIED). [S30][S31][S32]
- **Injecting non-speech events.** The client's `sendClientMessage` arrives at the server's `on_client_message`. The server then queues `LLMMessagesAppendFrame(run_llm=True)` for an LLM reply or `TTSSpeakFrame` for a fixed line. It cuts the bot off with `broadcast_interruption()` or `InterruptionWorkerFrame`, and pushes whiteboard and mouth-shape data with `send_server_message`. Queued frames are dropped when the student interrupts, so keep vision findings in shared state. [S33][S34][S37]
- **Cost.** Provider fees are the same as with a hand-rolled loop, and self-hosting costs only the VM. Pipecat Cloud adds $0.01/min, about the size of the whole STT+TTS bill, and doesn't run on Vultr. [S40]
- **Recommendation.** Self-host Pipecat and pin the version, because the APIs are being renamed (task → worker). Hand-rolling would mean rebuilding interruption, history trimming, turn detection and timestamp sync ourselves.

### 4. OpenAI "Decisions API" / "Astra"
Covered by the lead in 00-flagged-items.md

### 5. OpenRouter + Cerebras + Qwen
Covered by the lead in 00-flagged-items.md

### 6. Claude Opus 5.5

- **Confirmed.**
  - **Availability:** `claude-opus-5-5`, released 2026-09-22 on the Claude API, Bedrock, Google Cloud and Foundry.
  - **Capabilities:** text and image input, 1M-token context, 128K-token output.
  - **Price:** $4/$20 per million tokens.
  - **Thinking:** always on. Effort runs from `low` to `max`; the default is `medium`.
  - **Latency:** Anthropic labels it only as "Moderate", with no millisecond figures.
  - **Fast mode:** $8/$40. It makes output up to 2.5× faster; the docs say the gain is in output speed, not time to first token. [S41][S42][S43]
- **Image cost.** A 1000×1000 desk photo is 1,296 tokens, about $0.005. [S44]
- **API gotcha.** Opus 5.5 rejects forced tool calls, so use structured outputs to get JSON verdicts. [S42]

| Opus 5.5 (background, takes seconds) | Fast model `qwen/qwen3.8-27b` (per 00-flagged-items.md), live |
|---|---|
| Check the DFA from the photo and transcript. Return a structured verdict: which state or transition is wrong, plus an input string that proves it | Every spoken turn, short acknowledgements, and holding lines like "잠깐만요, 확인해 볼게요" ("one moment, let me check") |
| Plan the whiteboard explanation as tldraw steps | Narrate Opus's verdict step by step |
| Session summary, learning-engine memory, title and topic | Clarifying questions and encouragement |

Expect each Opus answer to take seconds (ESTIMATE; measure at `low` and `medium` effort). Claude Haiku 5.5 (from $0.10/$0.50, "Fastest", reads images) is Anthropic's option for quick tasks. [S41]

### 7. "Jev"
- **What it is.** TypeSafe AI's "System One" decision model, which returns typed choices and scores rather than prose.
- **Versions.** `jev-1.13.0` (alias `jev-latest`) and `jev-1.14.0` (alias `jev-preview`, available since 2026-10-14).
- **Price.** $0.042 per million input tokens; output is free.
- **Languages.** The docs say: "English is the primary training language… Other languages, including CJK scripts, are handled but not equally well."
- **Images.** Only behind a `TypeSafe-Danger-Zone-Images` header that the docs say isn't production-ready. That settles the image-input conflict raised in 00-flagged-items.md.
- **Verdict.** The spec's claim is accurate. [S45][S46][S47]

### 8. Architecture and latency budget

**Where each part runs**
- **Electron renderer:** the Pipecat client over SmallWebRTC (echo cancellation on), audio playback, the avatar's mouth-shape scheduler, the tldraw whiteboard, and camera change detection in a Web Worker. Changed frames go up over HTTPS, not the WebRTC data channel, which can stall on some networks. [S31]
- **Electron main process:** stores the session token with `safeStorage` and asks macOS for mic and camera access. [S48][S49]
- **Vultr VM (CPU only, in the region nearest the venue; Vultr has 32, including Seoul):** the Pipecat bot holding all provider keys, WebRTC setup, a coturn TURN relay, frame intake, the decision gate, the Opus checker and the database. [S51]

**A. Student stops talking → first tutor audio**

| Stage | English / Spanish | Korean |
|---|---|---|
| Mic → Vultr | 30–60 ms | 30–60 ms |
| End of turn | Flux 260–400 ms (vendor) | silence 200 ms + Smart Turn 65 ms + Nova-3 final (under 300 ms, vendor) |
| Fast LLM, first phrase | 200–400 ms (ESTIMATE) | 200–400 ms |
| Flash v2.5 first audio | ~200 ms | ~200 ms |
| Vultr → speaker | 50–100 ms | 50–100 ms |
| **Total** | **0.75–1.15 s** | **0.85–1.35 s** |

**B. Student talks over the tutor.** Voice detection takes ~200 ms, cancelling and flushing under 50 ms, and the network ~50 ms. Target: the tutor is silent within ~300 ms. Filtering short acknowledgements costs a few hundred ms more but avoids false stops (ESTIMATE). The tutor's own voice echoing into the mic is the main cause of false stops, so use headphones for the demo.

**C. Vision flags a mistake.**
1. The renderer compares frames 2–5 times a second and waits 0.5–1 s for the pen to lift.
2. The frame uploads (~100 ms).
3. The decision gate runs (Decisions API predicate, ~0.8 s per image according to 00-flagged-items.md).
4. The fast model says a holding line within ~0.5 s while Opus checks the DFA, which takes seconds.
5. The fast model narrates the result and whiteboard commands stream to the client.

If the student is mid-sentence, the tutor waits for a pause of at least 0.6 s unless the mistake is severe.

**Keys.** No provider key ships in Electron; every provider call is made on the server. If we ever stream from the client, give it 30-second Deepgram tokens and 15-minute single-use ElevenLabs tokens. LLM keys never leave the server. [S11][S19]

**Voice cost.** About $0.01–0.025 per session-minute before the LLM: STT $0.005–0.009, plus TTS $0.005–0.015 if the tutor talks 40% of the time (ESTIMATE). ElevenLabs Agents costs several times more. [S10][S18]

## Spec claims that don't check out
1. **That Deepgram handles all three languages with conversational turn-taking (implied).** Korean works only on Nova-3, which has no built-in end-of-turn model and no code-switching. [S1]
2. **"Pipecat if cheaper in credits."** It isn't cheaper; it's better. Pipecat Cloud costs more and doesn't run on Vultr. [S40]
3. **"Female voice with a choice of accent."** This works only as a per-language accent choice. [S21]
4. **These check out:** "Jev is trained on English first" and "opus5.5". For the Decisions API / Astra and Qwen3.8 claims, see 00-flagged-items.md.

## Recommendation for a fast build (1–2 days)
1. **Day 1 AM:** set up a Vultr Ubuntu VM with Pipecat 1.6.x pinned, SmallWebRTC and coturn, and connect `@pipecat-ai/client-js` in the Electron renderer. Get the English loop working (Flux → fast LLM → Flash v2.5) and measure time to first audio.
2. **Day 1 PM:** add the Korean setup: Nova-3 `ko` with Silero and Smart Turn; key terms (DFA, 상태 "state", 전이 "transition", 수락 상태 "accept state"); a native Korean female voice with `language_code=ko`; the acknowledgement filter for barge-in; and word timings streamed to the avatar.
3. **Day 2 AM:** build the vision path (frame change → decision gate → Opus DFA check → `LLMMessagesAppendFrame(run_llm=True)`) and send whiteboard commands through server messages.
4. **Day 2 PM:** rehearse the Korean DFA demo on the venue network with headphones. If UDP is blocked, use TURN over TCP 443 or the WebSocket transport. Keep push-to-talk as a fallback.

Defer: Flux eager end-of-turn, v4 Turbo, Daily, and ElevenLabs Agents.

## Open questions for the product owner
1. One fixed language per session, or Korean and English mixed mid-sentence?
2. Where will the demo run, and on what network? This sets the Vultr region and whether we need TURN.
3. May the tutor interrupt mid-sentence, or only at pauses?
4. Does "accent" mean regional accents within each language, or one accent across all three?
5. Is a Python server (Pipecat) acceptable to the team?
6. Which ElevenLabs plan? Creator allows 10 concurrent streams; will judges run sessions at once?
7. Is ElevenLabs Agents acceptable as a fallback, given it drops Deepgram?

## Sources
- [S1] Deepgram models & languages: https://developers.deepgram.com/docs/models-languages-overview
- [S2] Flux Multilingual launch (2026-04-29): https://deepgram.com/learn/deepgram-launches-flux-multilingual-press-release
- [S3] Flux end-of-turn configuration: https://developers.deepgram.com/docs/flux/configuration
- [S4] Flux quickstart (~260 ms EOT; eager mode +50–70% LLM calls): https://developers.deepgram.com/docs/flux/quickstart
- [S5] Deepgram changelog 2026-08-04 (Nova-3 Korean): https://developers.deepgram.com/changelog/2026/8/4
- [S6] Multilingual code-switching: https://developers.deepgram.com/docs/multilingual-code-switching
- [S7] Endpointing: https://developers.deepgram.com/docs/endpointing
- [S8] Keyterm prompting: https://developers.deepgram.com/docs/keyterm
- [S9] Deepgram Korean STT page: https://deepgram.com/product/speech-to-text/korean
- [S10] Deepgram pricing ($200 credit, 150 streams): https://deepgram.com/pricing
- [S11] Deepgram temporary tokens: https://developers.deepgram.com/guides/fundamentals/token-based-authentication
- [S12] ElevenLabs models (latency, languages, normalization, concurrency): https://elevenlabs.io/docs/models
- [S13] ElevenLabs stream-input WebSocket: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- [S14] ElevenLabs multi-context WebSocket: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-multi-stream-input
- [S15] ElevenLabs realtime TTS guide: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
- [S16] ElevenLabs realtime Text-to-Dialogue guide: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd
- [S17] Eleven v4 launch: https://elevenlabs.io/blog/eleven-v4 and https://elevenlabs.io/docs/changelog/2026/9/28
- [S18] ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- [S19] ElevenLabs single-use tokens: https://elevenlabs.io/docs/api-reference/tokens/create
- [S20] ElevenLabs TTS reference (`language_code`): https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- [S21] ElevenLabs Multilingual v2 launch (accent retention, 2023): https://elevenlabs.io/blog/elevenlabs-comes-out-of-beta-and-releases-eleven-multilingual-v2-a-foundational-ai-speech-model-for-nearly-30-languages
- [S22] Vapi Humanness Index, Flash v2.5 (197 ms): https://humannessindex.vapi.ai/models/elevenlabs-flash-v2-5
- [S23] ElevenLabs Agents JS SDK: https://elevenlabs.io/docs/libraries/conversational-ai-sdk-js
- [S24] ElevenLabs Agents client-to-server events: https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events
- [S25] ElevenLabs Agents tools: https://elevenlabs.io/docs/eleven-agents/customization/tools
- [S26] ElevenLabs Agents custom LLM: https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm
- [S27] Scribe v2 Realtime in Agents: https://elevenlabs.io/blog/scribe-v2-realtime-in-elevenlabs-agents
- [S28] Pipecat repo: https://github.com/pipecat-ai/pipecat
- [S29] pipecat-ai latest version: https://pypistats.org/packages/pipecat-ai
- [S30] Pipecat transports: https://docs.pipecat.ai/pipecat/learn/transports
- [S31] Pipecat SmallWebRTC (server): https://docs.pipecat.ai/api-reference/server/services/transport/small-webrtc
- [S32] Pipecat SmallWebRTC (JS client): https://docs.pipecat.ai/api-reference/client/js/transports/small-webrtc
- [S33] Pipecat interruptions: https://docs.pipecat.ai/pipecat/fundamentals/interruptions
- [S34] Pipecat frames: https://docs.pipecat.ai/api-reference/server/frames/overview
- [S35] Pipecat Smart Turn: https://docs.pipecat.ai/api-reference/server/utilities/turn-detection/smart-turn-overview
- [S36] Smart Turn repo (v3.2, 23 languages): https://github.com/pipecat-ai/smart-turn
- [S37] Pipecat client/server messages: https://docs.pipecat.ai/client/js/api-reference/messages
- [S38] Pipecat ElevenLabs TTS: https://docs.pipecat.ai/api-reference/server/services/tts/elevenlabs
- [S39] Pipecat Deepgram STT (Flux): https://docs.pipecat.ai/api-reference/server/services/stt/deepgram
- [S40] Pipecat Cloud pricing: https://www.daily.co/pricing/pipecat-cloud
- [S41] Claude models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- [S42] Claude Opus 5.5: https://platform.claude.com/docs/en/models/opus-5-5/overview
- [S43] Claude fast mode: https://platform.claude.com/docs/en/build-with-claude/fast-mode
- [S44] Claude vision (image tokens): https://platform.claude.com/docs/en/build-with-claude/vision
- [S45] TypeSafe Jev models (versions, languages, price): https://docs.typesafe.ai/models.md
- [S46] TypeSafe Jev images: https://docs.typesafe.ai/images.md
- [S47] TypeSafe docs index: https://docs.typesafe.ai/llms.txt
- [S48] Electron systemPreferences (askForMediaAccess): https://www.electronjs.org/docs/latest/api/system-preferences
- [S49] Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- [S50] Unicode Standard ch. 3, §3.12 Hangul syllable composition: https://www.unicode.org/versions/latest/
- [S51] Vultr company page (32 regions; Seoul since 2020): https://www.vultr.com/company/about-us/
