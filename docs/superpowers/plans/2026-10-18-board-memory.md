# Board memory implementation plan

Goal: persist emitted board actions per session and let the thinker see current student edits.
Architecture: an app-owned latest-PNG registry supplies a background thinker callback; a per-bot debounced history writer records emitted beat markers and restores context and renderer actions.
Spec: Lane 5 request in this session. No commits, no secrets or real capture.

- [x] Snapshot contract: failing endpoint/registry tests; implement authorized 2 MiB PNG upload, timestamp waiter, board-snapshot event and shared fixtures; regenerate API.
- [x] Thinker: failing tests for board-only routing and copied-message isolation; implement board_page callback with exact caption and silent absence.
- [x] History: failing tests for debounce, clear, cap, replay and database roundtrip; implement JSONB migration, owned repository writes and BoardHistory.
- [x] Bot integration: failing tests for emitted-only recording, snapshot request/wait, restore once and shutdown flush; wire registry, processor and lifecycle. Add actions server contract and existing TutorEvent mapping (missing in checkout).
- [x] Verify full server suite, migration up/down, ruff and shared tests; review changes and deliver uncommitted COMMIT block.

Review focus: cancelled turns must not leak images; pending/unemitted tags must not persist; targeted clear must preserve other items; reconnect restoration must precede new board actions; shutdown must await the final write.

Validation: full server suite 1501 passed, 1 skipped (TASSEL_TEST_SKIP_SAY=1); shared 278 passed; RTVI mapping 22 passed; migration down/up verified; API regenerated; Python lint/format, shared and desktop typechecks, and changed TypeScript Biome checks passed. No commits.
