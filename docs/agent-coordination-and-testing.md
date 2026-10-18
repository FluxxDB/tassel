# Agent coordination and current-app testing

Repository audit: 2026-10-17. Local main: `dafe610`; cached
`origin/claude/live`: `7e0ceb9`. Remote refs were inspected locally, not fetched;
the other developer may have newer work. No existing agent was contacted or reassigned.

## What the branches mean

The roadmap calls P1–P13 **plans**, used as delivery phases. Feature suffixes
subdivide each plan. P2 is voice, P3 paper capture, P4 automata/vision, P5 board
and synchronized explanation cues. `claude/live` is the integration branch.

Local main is an early foundation snapshot: root dev/e2e scripts are still
placeholders. The integrated branch contains the session UI, real voice,
paper capture, board commands, and a lightweight page-image path.
The live README still describes P1 and fake defaults; executable code is newer.

## Proposed ownership for active work

These are proposed boundaries, not assignments to the other developer's agents.
Before starting a lane, check that its existing branch owner is done or agree
on the exact remaining task. Do not start a second implementation of an active lane.

| Lane | Existing branch family | Exclusive implementation area | Deliverable |
|---|---|---|---|
| Voice server | p2-server / p2-voice-loop | `services/server/src/tassel/voice/**`, matching voice tests | Unscripted conversation, provider errors, interruption and language switching |
| Voice client | p2-client / p2-desktop | renderer `tutor/live/**`, `features/voice/**`; dedicated main/preload voice modules | Actual microphone/audio, device controls, reconnect and cleanup |
| Capture | p3-native / p3-paper-view / p3-vision / p3-server | `native/**`, renderer `paper/**`, server `frames/**`, `packages/paper-synth/**` | Actual paper capture, source selection, change detection and stored frames |
| Exact correctness | p4-core | server `domains/dfa/**`, matching domain tests | DFA verification on unfamiliar examples, independently of the LLM |
| Perception and intervention | p4-perception / p4-gates / p4-automata-vision | server `vision/**`, renderer `vision/**`, matching tests | Read-back, confidence handling, pause-triggered evaluation and tutor intervention |
| Board and annotations | p5-board / p5-marks / p5-live | renderer `board/**`, server `beats/**`, matching tests | Generated diagrams and marks synchronized to speech |
| Avatar | future P6 | new renderer `avatar/**`, shared `avatar/**` | Authored tutor animation and mouth cues |
| Integration and QA | one designated owner | shared wiring files and cross-lane E2E | Integrated app verified at an exact commit |

Capture, perception, and board currently meet in the vision-lite/page-image
code. Give all server `vision/**` edits to one owner at a time; split individual
files explicitly if those agents must overlap. Likewise, multiple P5 branches
are not automatically disjoint: reserve board core, marks, and server beats
separately. Each lane owns its matching tests, except central E2E fixtures.

### Files reserved for the integration owner

- Root/package manifests, workspace configuration and `pnpm-lock.yaml`.
- `services/server/src/tassel/app.py`, shared settings and router registration.
- `apps/desktop/src/main/index.ts`, shared IPC/preload bridges, app composition.
- Renderer `features/session/SessionScreen.tsx`, `Stage.tsx`, stage store,
  `tutor/create-client.ts`, and `tutor/use-tutor-session.ts`.
- `packages/shared/src/api/openapi.json` and `schema.d.ts`: regenerate once
  after server merges; never combine generated conflicts by hand.
- Shared event contracts, catalog keys, migration ordering, launch scripts,
  central E2E setup and CI.

Implementers describe required wiring in their handoff; the integration owner
applies it. For unavoidable shared-file edits, explicitly transfer ownership
before editing. A branch does not prevent two agents from writing the same files.

### Work protocol

1. One checkout/worktree and one branch per writer. For new Codex work, use
   `codex/<lane>-<task>` from an agreed integration commit. Never switch the
   branch under another running agent. Reviewers use separate checkouts.
2. Record owner, base SHA, allowed paths, exact task, interface assumptions,
   acceptance checks, and output commit in a small task card.
3. Freeze producer/consumer interfaces first: TutorClient events, stored frame
   identity and timestamps, vision results, board commands and audio cue timing.
   Contract changes go through the integration owner and affected consumers.
4. Keep each PR/commit set independently runnable. Tests use fakes at subsystem
   boundaries; a separate acceptance run must exercise real providers/devices.
5. Merge in dependency order: capture + voice, then vision hooks, then live
   intervention/read-back and board synchronization. Avatar can run alongside.
   Check already-merged ancestry before merging old phase branches again.
6. After each merge: relevant tests/typechecks, then integration E2E at the final
   SHA. Use one merge owner to prevent simultaneous integration changes.
7. Isolate runtime state as well as source: unique E2E port and database per
   checkout, unique Electron user-data directory, and explicit artifact paths.
   `TASSEL_E2E_PORT` and `TASSEL_E2E_DATABASE_URL` are supported. Default Compose
   ports and databases are shared: designate an infrastructure owner or use
   customized Compose ports/URLs. One real camera/microphone test owner at a time.
8. Do not run blanket cleanup, reset another checkout, or stop another agent's
   server. Keep secrets in server settings, never in task cards or app logs.

## Testing the current integrated app

Use a separate clone to preserve this checkout and other agents' work:

```sh
git clone --branch claude/live <repository-url> tassel-live-test
cd tassel-live-test
pnpm install
```

Prerequisites from repository configuration: Node >=22.18, pnpm 12.6.0, uv,
Docker Desktop; macOS real Desk View additionally needs Swift/Xcode tools and
a compatible camera. On Windows, run the desktop tooling in a Windows terminal.

### Repeatable synthetic smoke test (PowerShell)

```powershell
$env:TASSEL_TUTOR = "fake"
$env:TASSEL_PROVIDERS = "fake"
$env:TASSEL_PAPER_SOURCE = "fake-clip"
pnpm dev
```

This intentionally runs the scripted DFA and generated paper clip. Use it to
check navigation, captions, stage controls, board presentation and session cleanup.
It cannot establish real tutoring or real vision quality.

### Actual voice test (PowerShell, Windows)

Copy `services/server/.env.example` to `services/server/.env` and fill in
Deepgram, ElevenLabs, and OpenRouter credentials (OpenAI is an alternative LLM
provider). Do not put credentials in renderer settings. Set
`TASSEL_PROVIDERS=live` in the server file to fail when required keys are missing;
remove inherited per-provider fake overrides as well.

```powershell
Remove-Item Env:TASSEL_PROVIDERS -ErrorAction SilentlyContinue
$env:TASSEL_TUTOR = "live"
$env:TASSEL_PAPER_SOURCE = "auto"
$env:TASSEL_REQUIRE_FAKE_CAPTURE = "0"
pnpm dev
```

Choose a Talk session to test real speech and responses. Ask an unrelated
question to prove it is not replaying the DFA script. Windows has no Desk View;
the fake clip enables a test paper session but also substitutes fake microphone
devices, so it cannot validate actual speech input. The complete real screen
share experience is P7 work, so do not assume Windows screen tutoring is finished.

### Actual voice and paper (macOS)

With real-provider settings in the server file, and fake switches cleared:

```sh
TASSEL_TUTOR=live TASSEL_PAPER_SOURCE=auto \
TASSEL_VOICE_ENV_FILE="$PWD/services/server/.env" pnpm live
```

The current live launcher is macOS-only. It starts Docker services, migrations,
builds desktop/helper, starts the backend and renderer, and opens Electron via
LaunchServices so Electron receives camera/microphone permissions. Quit the app
or Ctrl+C to stop the processes it started. Avoid running another app stack on
the same ports. The launcher reads the provider file; its existence alone does
not prove its settings select live providers.

Acceptance: start a Paper session; speak a new problem; change your drawing;
pause for upload; ask what it sees; request a diagram; interrupt its speech;
switch language; end and verify capture/audio stop. Try a second unfamiliar
problem and an unreadable page. Repeatable fake E2E success is not evidence
that these real-device checks pass.

### Automated checks (integrated branch)

```sh
docker compose up -d --wait db s3
pnpm check
pnpm test
pnpm e2e
```

Tests use dedicated test/E2E databases; configure unique databases/ports for
parallel checkouts. E2E deliberately refuses real capture. Run targeted checks
during implementation, and the integrated suite before calling a merge ready.

## What is still simulated or limited

- Explicit fake tutor mode uses `dfa-opening`, `board-demo`, or `marks-demo`.
  Server voice fakes are independently selectable: selecting a live desktop
  client alone does not establish real providers.
- The current example is a **DFA**. PDA/Turing-machine support is planned in P11.
- The live tutor prompt is general and not locked to that DFA. Diagram commands
  are currently specialized around DFA/NFA and paper annotations.
- Live has lightweight page-image/numbered-mark context for student turns.
  The full exact verifier, decision gate and proactive interruption orchestrator
  exist on the separate P4 branch; they are not all present in cached live.
- The tutor tile still uses `AvatarPlaceholder.tsx`; P6 is an authored animated
  woman tutor, not a real webcam video. Distinguish that cosmetic placeholder
  from the student's paper source, which can be actual capture on macOS.

This audit read source and Git history. No app, provider call, or automated suite
was run: this shell has no Node, pnpm, or uv on PATH. Runtime behavior remains
to be validated on the developer machines.
