# Graph Report - docs  (2026-10-17)

## Corpus Check
- 9 files · ~73,611 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 299 nodes · 687 edges · 10 communities
- Extraction: 90% EXTRACTED · 9% INFERRED · 1% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.86)
- Token cost: 459,804 input · 0 output

## Community Hubs (Navigation)
- Design System and Fonts
- Vision Pipeline and DFA Verifier
- Decision Gate and Mission
- Real-time Voice Loop
- Desk View and Electron Overlay
- Vultr Infrastructure and Models
- Avatar and Lip-Sync
- Learning Engine and Memory
- tldraw Session Whiteboard
- Avatar Reference Illustration

## God Nodes (most connected - your core abstractions)
1. `Pipecat (self-hosted voice framework)` - 18 edges
2. `Color token set` - 16 edges
3. `tldraw 5.5` - 15 edges
4. `OpenAI Decisions API (POST /v1/decisions)` - 14 edges
5. `Fellix typeface` - 13 edges
6. `ElevenLabs (text-to-speech)` - 13 edges
7. `Learning engine (Elo + FSRS-6 + post-session LLM pass)` - 13 edges
8. `Session whiteboard (tldraw 5.5 behind a Board wrapper)` - 13 edges
9. `Judge-visible Vultr architecture` - 12 edges
10. `Tassel (AI tutoring and learning platform)` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Thin board wrapper (keeps Excalidraw as fallback)` --semantically_similar_to--> `DecisionGate interface`  [INFERRED] [semantically similar]
  research/03-whiteboard-visuals-avatar.md → superpowers/specs/2026-10-17-tassel-design.md
- `Language-neutral concept slugs (dfa.accept-state, ...)` --semantically_similar_to--> `i18next catalogs (en/es/ko) with CI completeness check`  [INFERRED] [semantically similar]
  research/04-vultr-fonts-learning-engine.md → superpowers/specs/2026-10-17-tassel-design.md
- `Stage layout ('One stage, her work first': Paper / Board / Split)` --references--> `9999px pill radius for actions and tags`  [INFERRED]
  superpowers/specs/2026-10-17-tassel-design.md → design-system/DESIGN.md
- `Library (home) screen` --references--> `Filled Pill Button (Primary)`  [INFERRED]
  superpowers/specs/2026-10-17-tassel-design.md → design-system/DESIGN.md
- `Geist Sans` --conceptually_related_to--> `Vercel (similar brand)`  [INFERRED]
  research/04-vultr-fonts-learning-engine.md → design-system/DESIGN.md

## Hyperedges (group relationships)
- **Live voice loop (STT routing, fast LLM, Flash TTS, barge-in over SmallWebRTC)** — research_01_voice_loop_and_models_pipecat, superpowers_specs_2026_10_17_tassel_design_stt_language_routing, research_01_voice_loop_and_models_deepgram_flux_multilingual, research_01_voice_loop_and_models_deepgram_nova_3_ko, research_00_flagged_items_qwen3_8_27b, research_01_voice_loop_and_models_elevenlabs_flash_v2_5, research_01_voice_loop_and_models_barge_in, research_01_voice_loop_and_models_smallwebrtc [EXTRACTED 1.00]
- **Vision interrupt pipeline (detector, decision gate, deep check, verifier, policy, injection)** — superpowers_specs_2026_10_17_tassel_design_handwriting_change_detector, superpowers_specs_2026_10_17_tassel_design_decision_gate, superpowers_specs_2026_10_17_tassel_design_deep_check, superpowers_specs_2026_10_17_tassel_design_dfa_verifier, superpowers_specs_2026_10_17_tassel_design_tutor_policy, research_01_voice_loop_and_models_llm_messages_append_frame [EXTRACTED 1.00]
- **DFA demo flow: read, verify, trace, redraw** — research_03_whiteboard_visuals_avatar_handwritten_dfa_reading, research_03_whiteboard_visuals_avatar_dfa_checker, research_03_whiteboard_visuals_avatar_shortest_counterexample, research_03_whiteboard_visuals_avatar_blame_step, research_03_whiteboard_visuals_avatar_trace_animation, research_03_whiteboard_visuals_avatar_graphviz_layout, research_03_whiteboard_visuals_avatar_semantic_board_commands [EXTRACTED 1.00]
- **Customizable Tutor Features Shown in the Reference** — source_ghh_avatar_reference_side_ponytail_hairstyle, source_ghh_avatar_reference_dot_eyes, source_ghh_avatar_reference_peach_skin_tone [INFERRED 0.85]
- **Reference Parts Mapped to the Avatar's SVG Layers** — source_ghh_avatar_reference_side_ponytail_hairstyle, source_ghh_avatar_reference_lavender_hair_tie, source_ghh_avatar_reference_peach_skin_tone, source_ghh_avatar_reference_dot_eyes, source_ghh_avatar_reference_closed_smile_mouth, source_ghh_avatar_reference_violet_gradient_top [INFERRED 0.85]

## Communities (10 total, 0 thin omitted)

### Community 0 - "Design System and Fonts"
Cohesion: 0.06
Nodes (65): Blog Post Sidebar Card, Blush #fce0ee (--color-blush), Bone #fff9f3 (--color-bone), Carbon #000000 (--color-carbon), Centered editorial layout (1200px max, 48-64px section gaps), Color token set, CSS custom properties token block, Dark Pill Button (on hero) (+57 more)

### Community 1 - "Vision Pipeline and DFA Verifier"
Cohesion: 0.09
Nodes (41): Anthropic (similar brand), Claude Haiku 5.5, Claude Opus 5.5 (claude-opus-5-5), Holding line ('one moment, let me check'), Two-tier model split (fast live model + Opus background), Vision-flagged mistake flow, Annotation coordinate mapping, Frame token cost and change-only sampling (+33 more)

### Community 2 - "Decision Gate and Mission"
Cohesion: 0.13
Nodes (28): Choice question, Undocumented Decisions API language support, GPT-6 Astra, GPT-6 Luna (gpt-6-luna), Jev (TypeSafe AI decision model), Jev image-input conflict, noul question type, OpenAI Decisions API (POST /v1/decisions) (+20 more)

### Community 3 - "Real-time Voice Loop"
Cohesion: 0.11
Nodes (32): Backchannel filter (minimum-words rule), Barge-in handling, coturn TURN relay, Deepgram (speech-to-text), Deepgram Flux Multilingual (flux-general-multi), Deepgram Nova-3 Korean (ko), Electron safeStorage, ElevenLabs (text-to-speech) (+24 more)

### Community 4 - "Desk View and Electron Overlay"
Cohesion: 0.12
Nodes (30): AVCaptureDeskViewApplication, macOS camera permission (TCC), Chromium fake-camera switches, Cluely, Window content protection, macOS Desk View (.deskViewCamera), Desk View window capture (getDisplayMedia + useSystemPicker), Electron 44.x (+22 more)

### Community 5 - "Vultr Infrastructure and Models"
Cohesion: 0.14
Nodes (28): Cerebras (inference provider), OpenRouter, Qwen3.8 27B (qwen/qwen3.8-27b), ElevenLabs Flash v2.5, deepseek-v4.1-flash, Judge-visible Vultr architecture, KCGen-KT (LLM-generated knowledge components), LLMKT (LLM-tagged knowledge tracing) (+20 more)

### Community 6 - "Avatar and Lip-Sync"
Cohesion: 0.14
Nodes (21): ElevenLabs character timestamps (chars, charStartTimesMs), Eleven v4 Turbo, Beat clock (one clock for drawing and lip-sync), Hangul syllable decomposition (code point - 0xAC00), Idle blinking and breathing, phonemize (ARPAbet phonemes), Rhubarb-compatible cue JSON (mouthCues, words, markers), Rhubarb Lip Sync tool (+13 more)

### Community 7 - "Learning Engine and Memory"
Cohesion: 0.12
Nodes (21): Bayesian Knowledge Tracing (BKT), Language-neutral concept slugs (dfa.accept-state, ...), Elo per-concept mastery, FSRS-6 spaced-repetition scheduling, KLI framework (knowledge components), Learning engine (Elo + FSRS-6 + post-session LLM pass), Learning schema (concept, learner_concept, evidence, misconception, tutor_note, session), Memory panel (mastery bars, misconception chips, review due) (+13 more)

### Community 8 - "tldraw Session Whiteboard"
Cohesion: 0.27
Nodes (15): tldraw animateShape, Thin board wrapper (keeps Excalidraw as fallback), Custom geo shapes (ellipse and double-ellipse DFA states), dagre / ELK layout alternatives, User-vs-tutor edit tagging (store.listen source 'user', mergeRemoteChanges), Excalidraw 0.18.1, Graphviz DFA layout (@viz-js/viz renderJSON), tldraw OverlayUtil (unsaved highlights) (+7 more)

### Community 9 - "Avatar Reference Illustration"
Cohesion: 0.24
Nodes (9): Avatar Reference Color Palette, Closed Smile Mouth, Dot Eyes, Lavender Hair Tie, Peach Skin Tone, Side Ponytail Hairstyle, Soft Flat Illustration with Gentle Gradients, Tutor Avatar (+1 more)

## Ambiguous Edges - Review These
- `OpenAI Decisions API (POST /v1/decisions)` → `Multi-language support (English, Spanish, Korean)`  [AMBIGUOUS]
  research/00-flagged-items.md · relation: implements
- `Cerebras (inference provider)` → `Main models: Opus 5.5 for deep thinking, OpenRouter Cerebras Qwen3.8 (~550 tok/s) for live chat`  [AMBIGUOUS]
  research/00-flagged-items.md · relation: references
- `Eleven v4 Turbo` → `ElevenLabs character timestamps (chars, charStartTimesMs)`  [AMBIGUOUS]
  research/03-whiteboard-visuals-avatar.md · relation: conceptually_related_to
- `SmallWebRTC transport` → `Electron 44.x`  [AMBIGUOUS]
  research/01-voice-loop-and-models.md · relation: conceptually_related_to
- `Electron 44.x` → `tldraw license key requirement`  [AMBIGUOUS]
  research/03-whiteboard-visuals-avatar.md · relation: conceptually_related_to
- `Window content protection` → `Cluely`  [AMBIGUOUS]
  research/02-desktop-camera-vision.md · relation: conceptually_related_to

## Knowledge Gaps
- **30 isolated node(s):** `Slate Plum #574853 (--color-slate-plum)`, `Linear (similar brand)`, `Runway (similar brand)`, `Score question (ordered levels)`, `TypeSafe AI` (+25 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 33 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `OpenAI Decisions API (POST /v1/decisions)` and `Multi-language support (English, Spanish, Korean)`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **What is the exact relationship between `Cerebras (inference provider)` and `Main models: Opus 5.5 for deep thinking, OpenRouter Cerebras Qwen3.8 (~550 tok/s) for live chat`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Eleven v4 Turbo` and `ElevenLabs character timestamps (chars, charStartTimesMs)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `SmallWebRTC transport` and `Electron 44.x`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Electron 44.x` and `tldraw license key requirement`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Window content protection` and `Cluely`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Learning engine (Elo + FSRS-6 + post-session LLM pass)` connect `Learning Engine and Memory` to `Design System and Fonts`, `Vultr Infrastructure and Models`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._