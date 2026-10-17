# Tassel roadmap

> Spec: `docs/superpowers/specs/2026-10-17-tassel-design.md`. Product truth: `PRODUCT.md`.
> The design covers several independent subsystems, so it is built as a sequence of plans. Each plan ends with working software that is exercised in the running app, with screenshots posted to Discord. Each plan is written when its predecessors' interfaces are stable, and the owner has authorized self-approval of plans.

## Plans

| # | Plan | Delivers (exercised in the app) | Depends on |
|---|---|---|---|
| **P1** | **Foundation** (`2026-10-17-p1-foundation.md`) | Monorepo; shared design tokens, fonts and EN/ES/KO strings; sessions server (FastAPI + Postgres); typed API client; Electron shell; library; new-session sheet; the session stage on a scripted fake tutor; E2E harness with screenshots | n/a |
| P2 | Voice loop | A Pipecat bot with fake and live providers. **Speech-to-text:** Deepgram Flux for English and Spanish; Nova-3 `ko` with Smart Turn for Korean. **LLM:** Qwen3.8 through OpenRouter (Cerebras). **Speech:** ElevenLabs Flash v2.5 with alignment. **Client:** a WebRTC `TutorClient`. **Behavior:** barge-in and backchannel filtering, AI titles, device pickers, presenter mode and push-to-talk, latency metrics | P1 |
| P3 | Paper view | The Swift Desk View helper (TCC spike first). A `PaperSource` that reads from the helper, window capture, a fake clip or the screen. A synthetic clip of the DFA being drawn. The change-detector worker with a heatmap. Frame upload and storage (local S3 in dev) | P1 |
| P4 | Automata core + vision brain | DFA/NFA verifier (exact). Opus transcription schema with snapping to circles found by Set-of-Mark. Decision gate (OpenAI / Clef / fake) with an evaluation harness. The interruption policy and its etiquette. Injection into the voice loop. The "How I read your DFA" read-back | P2, P3 |
| P5 | Board & beats | tldraw (license key) behind a `Board` wrapper, automata shapes and Graphviz layout, semantic board commands, beat cue documents (mouth cues and markers), paper marks on frozen frames, `show_stage`, trace animations | P1 (live in P2/P4) |
| P6 | Tutor avatar | Authored layered SVG, a 9-shape mouth pack, lip-sync scheduler, idle motion, customization screen, per-language voice and accent with preview | P1 (live cues in P2) |
| P7 | Screen share | Overlay bar window, screen-pointer layer, floating board card, Apple Vision OCR regions in the helper, the on-request frame flow, the Windows path | P3, P5 |
| P8 | Learning engine & memory | Tables, Elo + FSRS-6, `record_evidence`, post-session extraction on Vultr, "What Ada remembers" panel, session review timeline, library card thumbnails (the last paper or board snapshot) | P2 |
| P9 | Languages & accessibility | Bilingual captions, per-language prompts, Korean typography audit, keyboard and screen-reader audit, web-design-guidelines review, the onboarding flow (language, permissions, consent and retention copy, the Desk View check on P3's parts, first-run customization through P6) | Ongoing; final pass after P7 |
| P10 | Vultr & packaging | Image → Container Registry, VM + coturn, Managed Postgres + Object Storage + Serverless Inference, "Powered by Vultr" panel, macOS packaging and signing, CI on macOS and Windows | P2–P4 |
| P11 | Automata extensions | PDA/TM bounded verification, transcription notations, stack and tape trace visuals | P4, P5 (design pass first) |
| P12 | Cell biology module | Design pass, then plan: diagram library, label checking, rubric judging, process animations | P5, P7 |
| P13 | Organic chemistry module | Design pass, then plan: recognition ensemble, RDKit checks, molecule rendering, mechanism arrows | P5 |
| M | Demo rehearsal | The §9 script end to end on the demo Mac (English plus the Korean segment), latency budgets measured, fixes | All of the above |

## Parallel tracks

After P1, these run at the same time in separate sessions or worktrees, because they touch disjoint directories:

| Plan | Touches |
|---|---|
| **P2** | `services/server/src/tassel/voice/**`, `apps/desktop/src/renderer/src/tutor/live/**` |
| **P3** | `native/**`, `apps/desktop/src/renderer/src/paper/**`, `services/server/src/tassel/frames/**` |
| **P5** | `apps/desktop/src/renderer/src/board/**`, `packages/shared/src/beats/**` |
| **P6** | `apps/desktop/src/renderer/src/avatar/**`, `packages/shared/src/avatar/**` |

P1 fixes the shared contracts these tracks meet at: the `TutorClient` events, the session API, the design tokens and the i18n catalogs.

## Working rules (every plan)

- TDD per task; a fresh implementer subagent per task and a fresh reviewer per task (superpowers:subagent-driven-development).
- Every feature is exercised in the running app (Playwright `_electron`) before it is called done. Screenshots go to Discord.
- **Mac and Windows parity for everything except Desk View.** No bash-only scripts.
- **macOS permissions follow the app that launched the process.** Electron launched by Playwright from an agent shell inherits the agent's permissions, which have no camera. Camera-dependent checks therefore launch Electron through LaunchServices (`open -a`) or use the fake clip.
- **Commits:** frequent, on `claude/<plan>` branches, pushed after each plan's milestone. Never pushed to main.
