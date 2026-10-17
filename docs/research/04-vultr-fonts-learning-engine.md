# Vultr, fonts & learning engine research

Researched 2026-10-17. Vultr prices and model lists were read live today from Vultr's public APIs and (via the browser pane) vultr.com; everything else from the primary pages in Sources. UNVERIFIED marks what I could not confirm.

## Bottom line

- **Vultr can carry the whole backend, visibly.** Serverless Inference (OpenAI-compatible) lists 24 live models including Qwen3.8, DeepSeek V4.1 Flash, a multilingual embedder ($0.05/M), Whisper STT, a streaming Korean-capable TTS and Cloudflare's **Clef decision models** (`clef-flash` takes images: the spec's "decision model that looks at the frame"). Managed PostgreSQL has pgvector from $15/mo (Seoul available); Object Storage is S3-compatible at $18/mo for 1 TB + 1 TB egress; VKE's control plane is free; Container Registry has a free plan.
- **Inference runs only in US regions (sea/atl/sjc):** fine for extraction, embeddings and frame decisions; keep Deepgram + ElevenLabs for the live loop.
- **Fellix and PP Fraktion Mono are license-blocked.** Displaay's trial is "internal testing and evaluation only, not for commercial or public-facing projects"; Pangram's free tier is personal use only and any app (mobile or desktop) embedding the font needs an App license. Use **Geist Sans + Geist Mono** (OFL, variable 100–900, ~70 KB each, Spanish covered).
- **Korean: Pretendard Variable** (OFL, wght 45–920, 2.0 MB, Inter-based Latin, Source Han-based Hangul) restricted to Hangul with `unicode-range`; Wanted Sans Variable (400–1000) is the alternative. SUIT covers only 2,350 syllables; IBM Plex Sans KR and Spoqa Han Sans Neo are static, and CSS renders 520 as **600** without a variable axis.
- **Learning engine: Elo per concept + FSRS-6 scheduling + one LLM post-session pass.** Fitting BKT/Elo parameters needs ≥100 students (Pelánek), so use fixed parameters. Concepts are language-neutral slugs with en/es/ko labels; notes and misconceptions live as pgvector embeddings from Vultr's multilingual embedder.
- **The design-system folder is a real Refero Styles export of hume.ai** (`com.refero.extraction`, "extended" = the page's Compact/Extended toggle). Refero references **web and iOS** only; nothing for macOS apps or overlays, so "Refero style" can only mean the Hume tokens plus web-app patterns.
- **No public Vultr hackathon rubric exists.** Sponsor tracks are loose "Best Use of Vultr" prizes; Vultr's own showcase praises projects using Vultr as "the entire control plane" (Serverless Inference + Compute + Container Registry + Object Storage + VPC).
- Spec items that fail: the OpenAI Decisions API reportedly runs on GPT-6 **Luna**, not "Astra"; Vultr's marketing pricing contradicts the live API; the legacy free VM tier is application-based and possibly inactive.

## Findings

### 1. Vultr products (live, 2026-10-17)

**Serverless Inference.** OpenAI-compatible API, vector store + RAG (`POST /v1/vector_store {name}`, `POST /chat/completions/RAG`), tool calling. `GET /v1/models` is public and the only consistent source: the product page advertises "$0.55/million input, $2.75/million output", the pricing page lists an older model set (MiniMax-M2.7, Kimi-K2.6, GLM-5.1), and the RAG docs still name deepseek-r1. Live catalog (USD per 1M tokens in/out; datacenter):

| Model | Modalities | Price | DC |
|---|---|---|---|
| `qwen3.8-flash-next` / `qwen3.8-27b` (262K ctx) | text, image, file, video → text | $0.10/$0.20 · $0.15/$1.00 | sea |
| `deepseek-v4.1-flash` (1M) | text, image, file → text | $0.15 / $0.60 | sea |
| `glm-5.3-flash` / `glm-5.3` (1M) | multimodal → text | $0.10/$0.35 · $0.75/$3.00 | sea |
| `nemotron-3-nano-omni-30b-a3b-reasoning` | audio, video, image, text → text | $0.10 / $0.25 | atl |
| `qwen3-embedding-4b` (32K, truncatable dims) | embeddings | $0.05 | sjc |
| `bge-reranker-v2-m3`, `vultron-retriever-*` | rerank | $0.05–0.10 | sjc/atl |
| `clef` / `clef-flash` (text, ≤8 images) | decisions (`noul`/`choice`/`score`) | $0.10 / $0.05 | atl |
| `whisper-large-v3-turbo` | audio → transcript (batch) | ≈ $0.04 per audio-hour | sjc |
| `qwen3-tts-12hz-1.7b` (streaming; voices incl. `sohee`, `design`, `clone`) | text → speech | ≈ $1.01 per audio-hour | atl |

Qwen3-TTS's model card lists 10 languages including Korean, Spanish and English; `sohee` is a Korean female voice; cloning from ~3 s of audio. Clef (Apache-2.0, 27B/9B) returns probabilities for typed questions over text + images, API-compatible with Typesafe AI's Jev.

**Compute** (plans API): Cloud Compute `vc2-1c-1gb` $5/mo; High Performance `vhp-1c-1gb` $6, `vhp-1c-2gb` $12 (NVMe); Optimized from $28; VX1 from $43.80. **Cloud GPU**: A16 16 GB $0.471/h ($344/mo, 9 regions), L40S 48 GB $1.671/h, A100 80 GB $2.397/h, 8×H100 $23.92/h, 8×B200 $68/h, plus AMD MI325X/MI355X. `vc2-1c-0.5gb-free` appears in the API, but the free tier (2023) is application-based and a July 2026 tracker marks it inactive: UNVERIFIED, do not plan on it.

**Managed Databases**: PostgreSQL, MySQL, Valkey (Redis-compatible), Kafka; "starting at $15/month"; PITR backups, 99.99% SLA, VPC-only, PgBouncer; pgvector is registered as `vector` (enable per database as `vultradmin`). **Object Storage**: S3 API, no request charges; Standard $18/mo = 1 TB storage + 1 TB egress, then $18/TB stored and $0.01/GB egress; Archival $6, Premium $36, Performance $50, Accelerated $100 per TB/mo; hubs in 14 regions (Tokyo, Singapore; no Seoul). **VKE**: "provides the control plane free of charge"; pay for nodes, Block Storage ($1/mo per 10 GB) and Load Balancers ($10/mo). **Container Registry**: OCI, Docker Hub proxy cache, Seoul included; a storage-limited free plan exists (limit UNVERIFIED). New accounts get **$200 credit pre-applied**.

**Hackathon tracks.** No Vultr rubric is published anywhere. MLH "Best Use of Vultr" (HackUTD, Hacklanta, HackPSU) is judged on a blurb ("push the limits of what can be built when infrastructure is no longer the bottleneck"). RAISE YOUR HACK 2025's Vultr track used generic criteria (Application of Technology, Presentation, Business Value, Originality; $5k/$3k/$1k + $1k credits). Milan AI Agent Olympics gave $200 credits per participant for 30 days. lablab's "Vultr: Agent Rush Hackathon" runs Nov 3–8 2026, tracks TBA. Vultr's Agent Arena recap (Oct 8 2026) shows what Vultr likes: Serverless Inference as model layer, Cloud Compute/VPC as control plane, Container Registry and Object Storage around it.

**Judge-visible architecture.** Agent/API server (Node + Pipecat, image in Vultr Container Registry) on one `vhp-2c` VM in Seattle, same region as inference; sessions, learning engine and embeddings in Managed PostgreSQL + pgvector; Desk View captures, whiteboard snapshots and Manim renders in an Object Storage bucket with signed URLs; Serverless Inference for embeddings, post-session extraction (`deepseek-v4.1-flash` or `qwen3.8-27b`, both read Korean and images), `clef-flash` for "interrupt now?" on changed frames, `qwen3-tts` as Korean TTS fallback, Whisper for the clean post-session transcript. Add a "Powered by Vultr" panel showing each service, region and latency. VKE is unnecessary for a demo.

### 2. Fonts

**Fellix** (Displaay, 2015): 8 weights/16 styles plus a variable font (Weight + Slant), from €45 per style, €198/€288 family tiers, Spanish covered. Trial: "Internal testing and evaluation only. Not for commercial or public-facing projects." Embedding needs the App + Game license, priced by company size (minimum 3 people). A demo, pitch video or public repo is public-facing: **blocked unless purchased**, and 520 exists only in the variable font.

**PP Fraktion Mono** (Pangram Pangram, 2020): variable, 7 weights (Regular 390, Medium 450, Semibold 560). FAQ: "free to try for personal use as long as it is not used in a commercial project" (school projects and dev testing count as personal), but an App license is "needed for any application (mobile or desktop) and software where the font is embedded", one per app sized by MAU, from $40, one-year term for companies. Shipping it inside Electron crosses that line: **treat as blocked**.

**Geist Sans / Mono**: OFL-1.1; npm `geist` 1.8.1 ships `dist/fonts/geist-sans/Geist-Variable.woff2` (69 KB) and `GeistMono-Variable.woff2` (71 KB); `wght` 100–900 plus `ital`, so `font-weight: 520` is an exact instance. Google Fonts' `latin` subset is U+0000–00FF, which contains á é í ó ú ñ ü ¡ ¿: **Spanish covered**. Use the npm files directly, not `next/font`.

**Korean candidates** (all OFL-1.1):

| Font | Variable axis | Hangul coverage | Variable woff2 | Notes |
|---|---|---|---|---|
| Pretendard 1.3.9 | 45–920 | Source Han Sans-based (11,172 not stated: UNVERIFIED) | 2.06 MB | Latin from Inter; dynamic subsets; `npm i pretendard` |
| Wanted Sans 1.0.3 | 400–1000 | Source Han Sans-based (count UNVERIFIED) | 1.29 MB | "Std" variant is Latin-only |
| SUIT 2.0.5 | 100–900 | **2,350 + 318 syllables** | 0.62 MB | rare syllables would fall back |
| Noto Sans KR | 100–900 | full | 10.4 MB TTF | heavy to bundle |
| IBM Plex Sans KR | static 100–700 | — | — | cannot hit 520 |
| Spoqa Han Sans Neo | static, 4 weights | — | — | cannot hit 520 |

MDN's fallback rule: for a requested weight above 500 the browser takes the lightest *heavier* available weight first, so 520 on a static family renders as 600. Only variable families qualify. Pretendard wins on axis range, ecosystem and its Inter-derived Latin (same low-contrast grotesque family as Geist); pick Wanted Sans for a more geometric Hangul. No pair publishes metric compatibility: check x-height side by side and use `size-adjust` on the Hangul face if needed.

**Recommended stack** (self-hosted `@font-face` in the renderer): `--font-sans: "Geist", "Pretendard Variable", system-ui` with Pretendard limited to `unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7FF, U+3000-303F` so Latin, digits and Spanish always render in Geist; `--font-mono: "Geist Mono", "Pretendard Variable"` for lab labels (Korean has no uppercase; use Pretendard 12px for Korean eyebrows); weights 400/520; `:lang(ko) { letter-spacing: 0; line-height: 1.6 }` because −0.025em tracking damages Hangul. Payload ≈ 2.2 MB, or ≈ 0.3 MB with Pretendard's dynamic subsets.

### 3. Learning engine and tutor memory

Borrow from **OATutor** (MIT; `bktParams` per knowledge component, `skillModel.json`), **Pelánek 2016** (Elo lets you "build a reasonably behaving system quickly and cheaply" but "needs at least 100 students to get good estimates of item difficulty"), **ts-fsrs** (MIT, FSRS-6), the **KLI framework** (defines knowledge components), **LLMKT** (LLM tags KCs and correctness per dialogue turn, then runs KT), **KCGen-KT** (LLM-generated KCs beat human-written ones), **Mitton et al. 2026** (misconceptions: generate → embed-retrieve → rerank) and **Mem0** (ADD/UPDATE/DELETE/NOOP against the 10 most similar memories).

**Schema** (Postgres + pgvector): `concept(id, slug, domain, parent_id, labels{en,es,ko}, description{…}, embedding)` with slugs like `dfa.transition-totality`, `dfa.accept-state`, `dfa.dead-state`, `dfa.trace-string`; `learner_concept(learner_id, concept_id, theta, n_obs, fsrs{stability,difficulty,due}, last_seen)`; `evidence(session_id, concept_id, correct, confidence, source speech|whiteboard|paper, quote, ts)`; `misconception(concept_id, labels, embedding)` + `learner_misconception(status active|resolved, evidence_ids)`; `tutor_note(learner_id, kind preference|goal|context|strategy, text, lang, embedding, superseded_by)`; `session(title, topic, type, lang, summary{en,es,ko}, transcript_url, frames_prefix)`.

**Update loop.** (1) Live: the tutor LLM calls `record_evidence(concept_slug, correct, confidence, quote)` whenever the student demonstrates or misses a KC in speech, whiteboard or paper. (2) Per evidence: `P = 1/(1+e^-(θ−d))`, `θ += U(n)·(correct − P)` with Pelánek's `U(n) = 1/(1+0.05·n)`; `d` is a fixed per-KC difficulty (−1…+1) because no population data exists; shifted logistic `1/k + (1−1/k)·P` for k-option questions; the UI bar is the logistic of θ. (3) End of session: one JSON-schema LLM pass over transcript + frame captions returns KC tags with correctness, misconception candidates matched by cosine similarity before insert, and notes merged Mem0-style. (4) FSRS-6 rates each touched concept (Again/Hard/Good/Easy from the evidence ratio) and sets `due`; the next session opens with due concepts. (5) Rendering: prompts receive the learner's language and labels in that language; nothing is stored in a fixed language, and the multilingual embedder lets a Korean note answer a Spanish query. Demo: a Memory panel with mastery bars, misconception chips ("thinks a missing transition means reject"), notes and "review due", in Korean.

### 4. Refero

Refero is a design-research library of real product **screens** and **flows** for **web and iOS** (the MCP requires `platform: web | ios`) plus **Styles**, a beta library of >2,000 AI-readable design systems extracted from live sites, exported as DESIGN.md, a Tailwind v4 `@theme` block, CSS variables and tokens with a Compact/Extended toggle. The local folder matches exactly (DESIGN.md, `theme.css`, `variables.css`, `tokens.json` with `com.refero.extraction {url: hume.ai, variant: extended, extractedAt: 2026-06-03}`), and the Hume AI page on styles.refero.design shows the same fonts and hex tokens. "Refero style" therefore means this Hume extraction. Other things the team may mean: screens/flows for onboarding, library lists, settings and overlays (web patterns transfer; there is no macOS category); the free **Refero Skill** (`npx skills add https://github.com/referodesign/refero_skill --skill refero-design`); and the MCP, which needs Pro (40% student discount; Free has no MCP). The Hume style describes a marketing site (48px display, 1200px hero); a dense tutoring UI should take the tokens, not the layout.

## Spec claims that don't check out

- "openai's decision model (astra under the hood)": coverage of the Decisions API beta (Oct 6 2026) says it runs on GPT-6 Luna; Astra is a separate model. UNVERIFIED against OpenAI docs. Vultr-hosted `clef-flash` offers the same predicate/choice/score contract with images.
- "We have free credits": only the $200 new-account credit is verifiable; hackathon credit amount and expiry are unknown; the legacy free VM tier is not dependable.
- Fellix "400 and 520": 520 needs the variable font, and both Hume fonts are license-blocked here.
- Vultr's three Serverless Inference price/model lists disagree; budget from the API.
- "Refero style for the entire app": Refero has no desktop-app references.
- The track that "requires Vultr" could not be identified; no public rubric exists.

## Recommendation for a fast build

Day 1 morning: stand up the architecture in Findings 1 (VM + Container Registry, Managed PostgreSQL with `CREATE EXTENSION vector`, one bucket, `OPENAI_BASE_URL=https://api.vultrinference.com/v1`); Deepgram/ElevenLabs/Opus 5.5 stay for the live loop. Day 1 afternoon: `npm i geist pretendard`, copy the three variable woff2 files, swap `--font-fellix`/`--font-pp-fraktion-mono` for Geist/Geist Mono, add the Hangul `unicode-range` and `:lang(ko)` rules; everything else in DESIGN.md stands. Day 2: learning engine in TypeScript (six tables, a 30-line Elo function, ts-fsrs, one extraction prompt, pgvector cosine search), seed the DFA concepts with en/es/ko labels and two misconceptions, build the Memory panel, run the Korean DFA homework twice so the second session visibly remembers. Evening: "Powered by Vultr" panel and `clef-flash` interrupt decisions on changed Desk View frames.

## Open questions for the product owner

1. Which hackathon and track; is there a rubric or a required Vultr service; how many credits, expiring when?
2. Must the live voice loop run on Vultr, or may it run locally for demo latency?
3. Buy Fellix (€288 + App + Game license) and PP Fraktion Mono (App license from $40), or ship Geist?
4. Pretendard or Wanted Sans, and is zero tracking for Korean an acceptable deviation from the Hume tokens?
5. OpenAI Decisions API or Vultr-hosted Clef for the interrupt decision (cost, latency, homework-frame privacy)?
6. Retention policy for Desk View frames in Object Storage, and server-side Postgres versus local SQLite with sync for an offline-safe demo?

## Sources

Vultr: `https://api.vultrinference.com/v1/models`; `https://api.vultr.com/v2/plans`; https://www.vultr.com/pricing/; https://www.vultr.com/products/cloud-inference/, /products/managed-databases/, /products/object-storage/, /products/container-registry/; https://docs.vultr.com/products/serverless/inference/vector-store/rag-chat-collection; https://docs.vultr.com/products/serverless/inference/vector-store/create-collections; https://docs.vultr.com/support/products/managed-databases/how-to-fix-the-pgvector-could-not-open-extension-control-file-error; https://docs.vultr.com/product-overviews; https://docs.vultr.com/support/products/container-registry/what-is-the-default-storage-limit-on-the-free-plan; https://blogs.vultr.com/agent-arena-hackathon-cerebral-valley-2026; https://blogs.vultr.com/serverless-inference; https://www.vultr.com/free-tier-program/; https://www.mlh.com/events/hackutd-ae/prizes; https://lablab.ai/event/raise-your-hack; https://lablab.ai/ai-hackathons/milan-ai-week-hackathon; https://lablab.ai/ai-hackathons/vultr-hackathon/live. Decision models and TTS: https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/; https://huggingface.co/Cloudflare/clef; https://unite.ai/openai-releases-decisions-api-in-public-beta-powered-by-gpt-6-luna; https://propakistani.pk/2026/10/07/openai-launches-decisions-api-with-up-to-10x-faster-responses/; https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base.

Fonts: https://displaay.net/help/licenses; https://displaay.net/typeface/fellix; https://displaay.net/trials; https://pangrampangram.com/pages/faq; https://pangrampangram.com/pages/eula; https://pangrampangram.com/products/fraktion-mono; https://vercel.com/font; https://github.com/vercel/geist-font; https://api.fontsource.org/v1/variable/geist; https://data.jsdelivr.com/v1/packages/npm/geist@1.8.1?structure=flat; https://fonts.googleapis.com/css2?family=Geist:wght@100..900; https://github.com/orioncactus/pretendard; https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable.css; https://data.jsdelivr.com/v1/packages/npm/pretendard@1.3.9?structure=flat; https://github.com/wanteddev/wanted-sans; https://github.com/sun-typeface/SUIT; https://sun.fo/suit; https://api.fontsource.org/v1/fonts/noto-sans-kr; https://api.fontsource.org/v1/fonts/ibm-plex-sans-kr; https://github.com/google/fonts/tree/main/ofl/notosanskr; https://github.com/spoqa/spoqa-han-sans; https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight.

Learning engine: https://github.com/CAHLR/OATutor; https://arxiv.org/abs/2105.00385; https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf (DOI 10.1016/j.compedu.2016.03.017); https://github.com/open-spaced-repetition/ts-fsrs; https://kilthub.cmu.edu/articles/journal_contribution/The_knowledge-learning-instruction_framework_bridging_the_science-practice_chasm_to_enhance_robust_student_learning_/6470522; https://arxiv.org/abs/2409.16490; https://arxiv.org/abs/2502.18632; https://arxiv.org/abs/2602.02414; https://arxiv.org/html/2504.19413v1.

Refero: https://doc.refero.design/; https://doc.refero.design/mcp/examples; https://doc.refero.design/mcp/business; https://doc.refero.design/help/plans; https://doc.refero.design/skill; https://styles.refero.design/; https://styles.refero.design/style/2e67105f-9f9a-45b5-9281-29734e753bd6; https://skills.sh/clementwalter/refero-design/refero-styles; https://notes.nicolasdeville.com/ai/refero-styles/.
