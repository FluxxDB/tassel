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
6. Pause stops screen uploads while preserving speech and annotations. Reset while paused keeps sharing paused. Stop sharing ends capture, destroys the overlay windows and restores Tassel. Open Tassel restores the full app without ending the session.

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

Automated checks use fakes and never open the owner's screen, camera, microphone or paid providers. Actual macOS permission prompts, full-screen Spaces behavior, mixed-DPI/rotated monitors and clean capture exclusion need owner-run validation. Capture keeps desktop ink visible, relies on native capture exclusion and masks the HUD region; validate the actual captured image and latency on each target platform. The capture-exclusion guarantee and the proposed 150 ms audio-cutoff target are not claimed from fake tests.

The first release intentionally selects a whole display. Moving-window tracking, DOM extraction, continuous uploads, persistent document annotations and a floating editable whiteboard remain outside this version. Digital drawings use a dedicated frame-bound tool; speech-word synchronization for these tool marks can be refined after hardware acceptance.

## Annotation bug review (2026-10-18)

The screen tool now defines full-image normalization using the actual JPEG dimensions,
including browser chrome and margins. Circles take opposite bounding-box corners;
underlines take endpoints below the text. Incomplete and zero-area shapes are rejected.
A drawing must reference a fresh frame delivered for the current user turn, and image-free
provider retries no longer advertise `draw_screen`.

Real Electron acceptance now verifies tutor ellipse and underline positions in landscape
and portrait viewports. This confirms the renderer's normalized projection, independently
of model localization. Synthetic tests cannot establish how accurately the live model
locates a particular question on the owner's display; that still needs a live retest.

## Stale-request review (2026-10-18)

An interrupted response can leave consecutive user messages without an assistant message
between them. Request assembly previously concatenated all of them, including requests
already processed. It now stops at the last processed user message, initializes that boundary
from reconnect history, and explicitly identifies the current request to the speaking model.
Fresh adjacent transcript fragments still join, and historical messages remain available.

Screen reset also clears interrupted-task tutor notes and replaces its prior reset instruction
instead of accumulating copies. Regressions reproduce the Hypershot request being prepended
to a later unrelated question, verify reconnect behavior, and exercise note cleanup through
the voice pipeline.

Validation for this review: 563 voice/screen server tests passed, one skipped; nine desktop
screen unit tests passed under bundled Node 24; desktop build and typechecks passed; the
synthetic-screen Electron acceptance test passed. Test-area registration, Ruff, Biome for
the changed acceptance spec, and diff whitespace checks passed. The server suite emitted
SDK deprecation warnings and an aioice shutdown task exception after its passing tests.


## Overlay usability and identity update (2026-10-18)

- Scrolling changes the geometry revision and rejects pending marks from the old frame, but
  leaves existing annotations and speech alone. Ink stays at its screen position until Reset
  annotations, Undo ink, or Stop sharing. Pausing/resuming capture uses `/screen/activity`
  with the existing cancellation epoch and an increasing revision; it never cancels speech.
- Captures exclude native overlay windows, then composite the student's completed strokes into
  the JPEG. Tutor marks remain excluded to avoid self-grounding. Frames remain on demand;
  two overlapping requests now wait for their own fresh capture instead of skipping an upload.
- The screen tool accepts text, rectangles and freehand paths in addition to circles, arrows,
  underlines and pointers. Bounds, shape cardinality and text lengths are validated. Text and
  pointers use actual viewport dimensions so wide/portrait screens do not stretch lettering.
- Captions follow the newest lines until the user scrolls upward, then follow again when the
  user returns to the bottom. Pause/play, pencil and rounded undo icons have accessible names.
  Idle copy reports sharing status and the configured tutor name.
- The native owner shrinks for 160 ms, then the bar moves for 240 ms with smooth acceleration
  and deceleration. Restore reverses the sequence. The arrival uses the avatar-save rainbow
  gradient. Reduced-motion users get immediate native transitions and no pulse. Original owner
  size/minimum size/maximized state and the HUD destination survive repeated transitions.
- The saved avatar name is the UI identity in en/es/ko and is included in voice offers. A
  validated `tutor-name` event updates it during a session without reconnecting. The talker's
  next prompt uses the new identity; demo captions and fake greetings use it too. `Ada` remains
  only the canonical initial avatar setting and authored test/demo source text, not live UI copy.

### Research and measurement

The installed tldraw editor already supports programmatic shape creation; its official
[agent starter kit](https://tldraw.dev/starter-kits/agent) demonstrates create/update/delete,
freehand and text actions. Its [hidden-UI mode](https://tldraw.dev/examples/hide-ui) retains
editor tools and keyboard shortcuts. No replacement software is needed for a future full
editable desktop canvas. This update extends the existing lightweight transparent annotation
renderer; it does not install a second agent stack or replace the existing tldraw board.
Native click-through remains enabled unless student Draw mode is active.

Incorrect-target research found no deterministic projection offset in landscape/portrait
Electron checks. The tool instructions now require checking the target's label and surrounding
content in the current frame. Live semantic localization can still be wrong; synthetic tests
cannot establish accuracy for the owner's YouTube thumbnail or Photoshop window.

Measurement does not change model/provider choices or optimize latency. Renderer console
`[screen-timing]` entries report capture, JPEG encoding, upload acknowledgement and mark delivery
using local monotonic time, linked by frame ID. Server development transcripts (when
`TASSEL_TRANSCRIPT_DIR` is enabled) add `screen_frame_wait` and `screen_draw` frame age alongside
existing first-token/first-audio metrics. No image or annotation text is added to timing logs.
Use live traces to assess Wi-Fi/provider delay; fake timings are not live latency estimates.

Validation uses synthetic devices, an isolated test database and fake providers. Two extra
review passes covered transition cancellation/lifetime, repeated restore positions, capture
concurrency, pause revisions, locale identity updates and caption scrolling. Full repository
Biome also sees pre-existing untracked `output/banner` files; these were left unchanged.

Final validation: 657 server tests passed, one skipped; 236 affected desktop tests and 286
shared tests passed. The final Electron acceptance run passed with caption scrolling, preserved
ink, repeated transitions and landscape/portrait projection checks. Synthetic timing recorded
173 ms capture and 14 ms JPEG encoding; the fake upload was 0 ms and is not a network benchmark.
Build, desktop typechecks, tracked-code Biome, Ruff, locale consistency, API regeneration
comparison, test-area registration and diff whitespace checks passed.


## Missing screen and capture flicker follow-up (2026-10-18)

Reproduced a frame arriving after 2.1 seconds being discarded by the server's two-second
fresh-frame wait, even though the renderer allows an eight-second upload. The server now
waits up to 12 seconds for a fresh frame, allowing dispatch/capture/encoding overhead.
Epoch/source freshness checks and reset cancellation remain in effect; old frames are not
used as a fallback.

Native capture IPC now only reads the HUD mask. It never hides or re-shows the ink window,
and the renderer no longer waits 160 ms for ink to disappear. Existing native content
protection remains enabled; student strokes are still explicitly composited into the JPEG.
Electron documents platform-specific capture exclusion behavior in its
[BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable).

Both regressions failed before the fix and pass after it. Validation: 16 server screen tests,
15 desktop screen unit tests, build, typechecks, Biome, Ruff and native Electron acceptance.
The native acceptance test watches the ink window's actual hide event during capture, and
a separate unit test exercises the live JPEG HTTP upload branch using synthetic devices and
mocked HTTP rather than bypassing uploads in fake mode. Real Wi-Fi/provider and desktop
capture behavior still require an owner retest; no real devices or paid providers were used.
