# Decision layer implementation plan

Goal: implement the approved decision-layer spec, in this worktree, offline and without commits.
Spec: docs/superpowers/specs/2026-10-17-decision-layer.md

Architecture: a bounded director runs before page capture and tutor preparation. The client selects sharp captures; the server bounds model images. A deterministic checker guards all emitted tags and checks complete proposed DFAs before they reach beats.

- [x] Director: test strict schema, timeout/failure fallback, destinations, fast turns, stage and context wiring; implement voice/director.py and bot/thinker integration.
- [x] Vision: test gated requests, notes retention and soft failures, Laplacian burst selection/retry, ten-second ink throttle and image budget; implement small paper capture helpers and server image changes.
- [x] Checker: test action mismatches, size limits, exact DFA checks and one repair; implement voice/action_checker.py and thinker/output integration.
- [x] Verify: pnpm check, desktop/shared unit tests, full pytest with supplied database and say disabled. Report one COMMIT block per layer; do not commit.

Review focus: stale page images on board turns; cancellation during director/repair; malformed model JSON; failed capture with useful notes; later edge edits bypassing DFA validation.

Verification: pnpm check passed; desktop 1,156 passed; shared 260 passed; pytest 1,294 passed, 1 skipped with the requested database and TASSEL_TEST_SKIP_SAY=1. Pytest also printed six dependency deprecation warnings and an aioice shutdown task diagnostic, with exit status 0. No live calls, app/camera/mic launch, .env reads or commits.
