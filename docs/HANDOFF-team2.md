# Handoff for a second team's agent: Tassel, 2026-10-17

You're joining a build already in progress. Another agent fleet (the "main" controller with its builders) is working on the **live session** in this repo right now. This note gives you work that won't collide with theirs, and the rules for sharing the repo.

## What Tassel is

Tassel is a live AI tutor for the desktop. The student works on paper while Ada, the tutor, watches through macOS Desk View, talks with her, draws on a whiteboard and marks her paper. It's an Electron + React app (`apps/desktop`), a FastAPI + Postgres server (`services/server`) and a shared package (`packages/shared`).

Read these first. They're all committed:
1. `CLAUDE.md`: commands, layout, conventions and constraints. These are binding.
2. `README.md`: setup, `pnpm dev`, test commands and settings.
3. `PRODUCT.md`: who it's for.
4. `docs/superpowers/specs/2026-10-17-tassel-design.md`: the design spec, which is the authority.
5. `docs/superpowers/plans/2026-10-17-tassel-roadmap.md`: plans P1–P13.
6. `docs/superpowers/plans/2026-10-17-p{1..5}-*.md`: the detailed plans.
7. `docs/design-system/DESIGN.md`: the visual system.

## Where things are

- **The integration branch is `claude/live`.** It holds P1–P5's merged work: the live voice tutor, the Desk View paper, Ada's whiteboard and paper marks, and the vision hookup. Base your work on `origin/claude/live`.
- **The live path is still being fixed tonight:**
  - Ada sees a fresh camera frame each turn.
  - The LLM is qwen/qwen3.8-27b on OpenRouter via Cerebras.
  - Board tags must parse.
  - Pre-processing makes pencil on lined paper readable.
  
  **Don't touch these areas** until main says they've settled:
  - `services/server/src/tassel/voice/` (bot.py, prompts.py, providers.py);
  - `services/server/src/tassel/vision/` (turn_image.py, page.py, enhance.py);
  - `services/server/src/tassel/beats/` (markup.py, processor.py);
  - `apps/desktop/src/renderer/src/tutor/`.

## Work you can take (no collision with the main fleet)

Pick from the top. Each is self-contained.

1. **CI (from the roadmap's P10).** Add GitHub Actions on `macos-latest` and `windows-latest`:
   - `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm -r test`;
   - pytest against a Postgres service, with `TASSEL_TEST_DATABASE_URL`;
   - the Swift helper's tests on macOS (`node scripts/native.mjs test`);
   - the paper-synth golden-hash check on Windows, which proves the cross-OS byte parity P3 asked for;
   - the desktop build.
   
   E2E needs a display and Electron, so start it as an optional macOS job using `xvfb`-free headed runs, or leave it as a follow-up. Never put real keys in CI: the test conftests scrub them, and no test may reach a provider.
2. **P5 Task 6: her own drawing and the board read-back.** The student draws on Ada's board with tldraw tools, and Ada reads back what she drew. Its spec is in `docs/superpowers/plans/2026-10-17-p5-board-and-beats.md`, under "Task 6". It's app-side board work (`apps/desktop/src/renderer/src/board/`), and it must not change the beat or markup contracts.
3. **Windows dev path.** Check `pnpm install`, `pnpm dev` and `pnpm test` on a Windows machine, and fix what breaks. Scripts are Node with `cross-spawn`, never bash-only. Windows has no Desk View: the new-session sheet starts from screen share there.
4. **Later, once main says the live path has settled:** P2 Task 9 (AI session titles) and Task 10 (turn metrics and the server's latency report). Both are in the P2 plan, but they touch `voice/`, so wait.

## Rules for sharing the repo

- **Branches:** use your own prefix, `team2/<topic>`. Never push to `claude/*` (main owns those), and never push to `main`. Don't force-push.
- **Integration:** push your branch and tell the owner. Main merges into `claude/live`. Don't open PRs unless the owner asks.
- **Keys:** they live only in `services/server/.env`, which is git-ignored, and you create your own. Never read, print or commit a `.env` file or key. The desktop app holds no provider keys.
- **Paid APIs:** tests never call them. Any live check that spends credits needs the owner's OK first.
- **Devices:** never open a real camera or microphone from an agent run. E2E uses fake devices through `tests/e2e/capture-guard.ts`. Real-device checks are for the owner at the Mac.
- **Parallel checkouts:** give each one its own `TASSEL_E2E_PORT`, `TASSEL_E2E_DATABASE_URL` and `TASSEL_TEST_DATABASE_URL`, and use ports 8861–8869 and databases `tassel_t2_*` so you don't clash with main (8787–8853). Docker Compose (Postgres on 54329, local S3) is shared, so never run `docker compose down`.
- **Conventions:**
  - Test first.
  - Every UI string goes through the en, es and ko catalogs (`pnpm check:i18n`). English copy first: es and ko may copy the English text for now.
  - Electron stays pinned to 44.9.0.
  - Commit messages are conventional.
- **The owner's recordings:** real Desk View clips stay local to the owner's Mac and are never committed, posted or shared. You won't have them; use the synthetic clips (`pnpm gen:paper-clip`).

## Contact

Questions go to the owner, who relays them to main. When you finish an item, send the owner one line: the branch, the head sha, and what's tested.
