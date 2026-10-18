# Screen tutoring and collapsed overlay

Implemented on `codex/screenshare-overlay`, based on `origin/claude/live` at `234b64e`.

## Run and use

On Windows, close any existing Tassel window, then run `Start-Tassel.cmd`. It is the single shared launcher for all app features and starts the current checkout. `pnpm start` uses the same code. The saved avatar profile, primary development database and provider-settings path are shared across worktrees through the ignored `.local/start.json`. See `docs/startup.md`. Feature-specific CMD files have been removed.

For a normal development environment, run the existing `pnpm dev` from this checkout with the desired provider configuration. Choose a Screen session (or Share screen inside an existing session), then:

1. Click Share screen and choose a display. Capture starts only after selection.
2. Tassel prepares its HUD and annotation window, then animates into the compact bar.
3. Work in the assignment. Ada receives a fresh digital frame when a student turn needs the screen. Look again explicitly asks her to inspect it.
4. Draw enables student ink. Escape returns to click-through. Undo ink removes the last student stroke.
5. Reset annotations immediately clears screen ink, exits Draw and suppresses Ada's current speech, captions and pending drawing. The server cancels generation/thinker work. Ada waits for the next utterance or Look again.
6. Pause stops screen uploads. Reset while paused keeps sharing paused. Stop sharing ends capture, destroys the overlay windows and restores Tassel. Open Tassel restores the full app without ending the session.

The collapsed bar borrows the Claude reference's shape/layout while using Tassel's existing Bone/Paper, Ink and Iris tokens. The configured avatar is mirrored from the session owner. Board requests can expose an Open board action; the desktop presentation remains separate from paper/board/split pinning.

## Implementation boundaries

- `src/main/overlay/`: trusted IPC, selected-display grants, native HUD and click-through ink windows, placement and teardown.
- Renderer `screen/`: session-owned capture, reset epochs, viewport revision checks, clean frame uploads and expanded preview geometry.
- Renderer `overlay/`: compact HUD, existing Avatar and lightweight SVG annotations. No second voice connection or audio player.
- Server `screen/`: authenticated ephemeral screen grants and JPEG ingestion. Screen images are held in memory for the active bot and are not sent through paper enhancement or stored in the paper frame table.
- Voice integration: existing frame-request seam dispatches to the active screen source first; paper still uses its existing sender and uploader guards. Digital drawing uses an additive `draw_screen` tool with exact frame IDs and normalized coordinates.
- The existing avatar profile split was corrected in the local regular/voice/webcam launchers: they now use `.local/avatar-app-data`, matching the avatar editor. No saved appearance was rewritten.

## Second-pass review

Reviewed implementation against `docs/superpowers/plans/2026-10-18-screenshare-overlay.md`, followed by regression fixes and another app run.

| Finding | Resolution |
| --- | --- |
| Native cleanup attempted `hide()` on a destroyed window (the user's exception screenshot). | Check native lifetime and clear references before destruction; regression test plus repeated Electron teardown. |
| Reset could clear ink while leaving buffered voice audible. | Immediate primary/presenter muting and a fresh-turn epoch barrier; actual Pipecat interruption propagation is tested. Ordinary voice interruption resumes on the next response. |
| Late reset acknowledgments, frames or tool results could outlive the viewport/source. | Monotonic interaction epochs, frame/revision checks, queued control ordering and upload cancellation. |
| Failed server cancellation could be acknowledged by a duplicate reset. | Preserve the pending cancellation barrier and retry it before acknowledgment. |
| Source selection could complete after cancellation. | Operation guard stops late streams and prevents collapse. |
| Repeated collapse/restore could race preparation. | Prepare before animation, serialize preparation, and version presentation transitions. |
| Expanded preview marks ignored letterboxing. | Project marks into the actual `object-fit: contain` rectangle. |
| The compact bar clipped wrapping controls. | Compact icon controls, revised native dimensions, native-scale bounds assertion and screenshot review. |
| The default avatar could replace the saved appearance. | Mirror the owner's profile and test a saved long-hair/dress profile in both session and HUD; unify the local launcher profile paths. |
| Starting screen capture could overlap paper capture. | Suspend paper and disable Camera while sharing; restore the prior camera state on Stop. |
| Fresh board images were lost on coarse Windows monotonic timestamps. | Use a snapshot revision barrier, retaining timestamp compatibility for other callers; test identical-clock updates. |

## Validation

- Desktop build succeeds on the pinned Electron/Vite stack.
- All desktop TypeScript configurations pass (main, renderer, tests and worker).
- Focused desktop regressions: 77 tests pass across screen lifecycle/geometry, voice interruption, audio sinks, capture guards and SessionScreen.
- Board, screen and full voice server area: 533 passed, one skipped. Uses an isolated test database and fake providers. Existing SDK deprecation warnings remain.
- Real Electron acceptance spec with a synthetic assignment and isolated fake API: share → collapse → draw → reset → pause → reset while paused → resume → restore → collapse again → stop. It checks saved-avatar mirroring, native window visibility, palette and bar bounds, and exits without page errors. See `apps/desktop/tests/e2e/screen-overlay.spec.ts`; run `pnpm --filter @tassel/desktop e2e:screen` after building. This standalone spec needs no database.
- Biome, Ruff, locale validation, test-area registration and diff whitespace checks pass for the changed implementation.

## Hardware acceptance still required

Automated checks use fakes and never open the owner's screen, camera, microphone or paid providers. Actual macOS permission prompts, full-screen Spaces behavior, mixed-DPI/rotated monitors and clean capture exclusion need owner-run validation. The current fallback hides desktop ink briefly for a requested frame and masks the HUD region; validate the actual captured image and latency on each target platform. The capture-exclusion guarantee and the proposed 150 ms audio-cutoff target are not claimed from fake tests.

The first release intentionally selects a whole display. Moving-window tracking, DOM extraction, continuous uploads, persistent document annotations and a floating editable whiteboard remain outside this version. Digital drawings use a dedicated frame-bound tool; speech-word synchronization for these tool marks can be refined after hardware acceptance.
