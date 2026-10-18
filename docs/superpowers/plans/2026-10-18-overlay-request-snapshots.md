# Overlay drawing with request-scoped screenshots

Written October 18, 2026. Planning only; no runtime changes in this document.

## Saved baseline

- Branch: `codex/screenshare-overlay`.
- App implementation baseline: `acd9346` (`fix(screen): generate complete overlay artwork with Astra`).
- Complete workspace checkpoint: `7886b42` (`chore: checkpoint workspace before overlay snapshot fix`). Includes previously untracked local documentation and banner assets.
- Annotated rollback tag: `checkpoint/overlay-before-request-snapshots-2026-10-18`.
- Inspect the baseline without disturbing ongoing work with `git show checkpoint/overlay-before-request-snapshots-2026-10-18` or check it out in a separate worktree. If later fixes need undoing on a shared branch, revert those fix commits rather than resetting the checkout.

## Goal

Use the screenshot delivered for a user request as temporary visual memory for that drawing job. Finish generating and applying new artwork against that snapshot even when later captures arrive. Subsequent requests use newer screenshots. Support arbitrary drawings through the existing illustrator; add no molecule-specific paths or prompts.

Existing drawings remain persistent editable objects. Receiving a screenshot, scrolling, or changing captions must not clear them. Explicit reset, stopping sharing, and switching sources must still prevent cancelled jobs from appearing later.

## What currently fails

1. `voice/bot.py` stores only the turn's frame ID. `current_screen()` also requires that ID to match `screen.frame`, which is the latest uploaded frame.
2. `draw_screen_artwork()` checks again after the illustrator returns, including `screen.frame is frame`. A newer capture can discard otherwise valid generated artwork.
3. `screen/controller.ts` independently requires incoming new drawings to match `lastFrameId` and the current viewport revision. Fixing only the server leaves a second rejection barrier.
4. `screen/drawing.py:deliver()` reads the current revision at delivery. A snapshot-bound command must carry its captured identity explicitly instead of mixing an old frame with a new revision.
5. Viewport sampling advances the revision when screen pixels change. Such changes must not cancel independent artwork merely because its placement screenshot is older.
6. The provided log shows a molecule tool invocation and later spoken retry promises without corresponding new artwork calls. Frame lifecycle fixes alone cannot fix those unsupported claims. The log does not expose enough result details to prove every spoken diagnosis.

## Proposed behavior

Distinguish new artwork from annotations of existing screen content. This distinction follows the existing tool boundary, not the drawing subject.

| Event | New artwork (`draw_screen_artwork`) | Target annotation (`draw_screen` with target) |
| --- | --- | --- |
| New capture arrives | Finish using the request snapshot | Allow replacement captures in the same viewport revision |
| Scroll or detected viewport change | Finish at the snapshot's normalized overlay placement | Reject outdated grounding; obtain a new view if still requested |
| Reset, source switch, stop, or sharing pause | Cancel pending application | Cancel pending application |
| New user request | Use the new turn's view; preserve normal explicit interruption behavior | Use the new turn's view |
| Already applied objects | Preserve until edited or explicitly cleared | Preserve until edited or explicitly cleared |

New artwork is overlay content, so scrolling during generation may leave its chosen location over different page content. Accept that tradeoff for reliable general drawing. Do not add automatic page tracking or silently reposition it. Content-specific circles and pointers retain viewport checks to avoid marking an unrelated target.

## Implementation sequence

### 1. Define a bounded request snapshot and lifecycle contract

- In `voice/bot.py`, retain the immutable delivered `ScreenFrame` for the turn rather than only its ID. Bind each drawing job to that frame before awaiting generation. Verify the model supplied the frame belonging to its turn, not any arbitrary historical frame.
- Include source, source/session epoch, viewport revision, and the drawing cancellation generation in the job identity. Reuse existing lifecycle invalidation where sufficient; introduce a separate cancellation token only where viewport changes and explicit cancellation currently share a counter.
- Keep image bytes only in active turn/job references. Release on completion, failure, cancellation, or session end. Do not persist screenshots or build an unbounded frame history.
- Specify an internal positioning policy for commands: independent overlay artwork versus viewport-anchored annotations. Set this in trusted handlers; do not let the LLM choose whether lifecycle checks apply.

### 2. Generate and deliver against the captured job

- Update `draw_screen_artwork()` to supply the pinned image to the existing illustrator and validate the original session/source/cancellation identity after generation. Remove latest-frame identity and viewport-revision equality requirements for independent artwork.
- Update target grounding to use its pinned frame and validate its viewport identity after resolution. A replacement frame within the same viewport must not cause rejection by itself.
- Change `screen/drawing.py:deliver()` to accept the captured command identity and positioning policy. Preserve its acknowledgement timeout and cleanup. Never stamp a late result with a newer session or revision.
- Handle legacy low-level drawing calls conservatively; make their positioning policy explicit rather than allowing omitted fields to bypass checks.
- Preserve geometry validation, screenshot coordinate conventions, illustrator routing, and the existing persistent edit path.

### 3. Teach the desktop to accept valid snapshot artwork

- Update the shared screen-message contract and its runtime validation together with server delivery.
- In `screen/controller.ts`, require matching source/session/cancellation generation and an active sharing state for every new drawing.
- Independent artwork may reference the pinned older capture and viewport revision. Grounded annotations must match the captured viewport revision; neither should require equality with the latest capture ID merely because another upload completed.
- Prevent replay or duplicate application using bounded command/request identity tracking. Keep explicit cancellation effective between generation, message arrival, mutation, and acknowledgement.
- Audit pause/resume, reset, source changes, and stop so stale work cannot reappear after resuming or selecting the same display again. Keep existing ink preservation and edits intact.

### 4. Make results and speech truthful

- Keep success contingent on the owner acknowledgement. Return distinct reasons for cancellation, changed viewport for a target, invalid geometry, generation failure, and acknowledgement timeout.
- Pass desktop rejection reasons through to the tool result where supported; avoid replacing every failure with a guessed screen-change explanation.
- Tighten tool instructions so a retry means an actual call, and completion or screen stability is never asserted without evidence. Avoid endless automatic retries; any permitted retry is bounded and remains tied to the user's request.
- Record frame/job identity, positioning policy, generation duration, and final result in existing opt-in diagnostics without image bytes. This should distinguish a discarded generation from a response that never invoked the tool.

## Verification and acceptance

Use deterministic fakes to pause the illustrator or pointer while captures and lifecycle events occur.

- Server: start artwork from frame A, upload B/C while generating, finish A, and confirm delivery and success only after acknowledgement. Repeat with a viewport revision change.
- Desktop: apply independent artwork from A after B is uploaded and after viewport sampling advances the revision. Confirm normalized placement and exactly one application.
- Grounding: accept a replacement capture within the same viewport; reject a changed viewport during target resolution or delivery.
- Cancellation: reset, pause/resume, stop, and source switch during generation or delivery must reject the late result and never resurrect cleared ink. Check commands already queued when cancellation happens.
- Persistence: existing ink survives capture, scrolling, and captions; move/recolor/remove still work without a fresh screenshot.
- Failure reporting: invalid geometry, illustrator timeout, desktop rejection, and missing acknowledgement cannot produce an applied/finished result.
- Synthetic Electron: delayed arbitrary illustration plus multiple captures, followed by a move; exercise cancellation and persistent ink. Cover freehand/text and structured diagrams without subject-specific code.
- Run affected server screen/voice suites, desktop screen/overlay tests, shared-contract checks, desktop typechecks and relevant lint. Broaden checks if contract changes affect additional consumers.
- Live acceptance: request several unfamiliar drawings, scroll while one generates, move it right, then cancel another via reset. Confirm captions match actual outcomes. Synthetic checks cannot establish real-provider visual quality or latency.

## Delivery boundaries

Implement the snapshot and client/server acceptance changes together as one coherent runtime change, with regression coverage. Follow with speech/result handling if it remains independently reviewable. Update `docs/screen-overlay-whiteboard.md` to describe the final behavior. Keep the baseline tag intact and record verification results in the implementation handoff. No runtime implementation is authorized by this planning document alone.
