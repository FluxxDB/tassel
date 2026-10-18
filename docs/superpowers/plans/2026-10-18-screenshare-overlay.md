# Screenshare tutoring and desktop drawing overlay

Plan written October 18, 2026. Planning only; no implementation changes.

## Intended experience

The student opens a digital assignment in their browser, PDF viewer, or editor, chooses **Share screen**, and selects a display. Tassel sees that selected display while the student keeps working in the original app. The main Tassel window smoothly collapses away, leaving a compact floating bar with the existing tutor avatar, live captions, and essential controls. Ada can point, circle, underline, and draw arrows directly over the assignment. The student can optionally draw too.

This is a parallel input mode to Paper View. Paper View continues to use the camera, page detection, handwriting enhancement, and its existing marks. Screen mode uses clean digital frames and its own overlay lifecycle. Both retain the same tutoring session, voice conversation, avatar settings, and whiteboard.

Recommended first release: selected-display capture on Windows and macOS; window-only capture follows once reliable native window bounds are available. Do not pretend a captured window's image dimensions tell us its desktop position.

Updated requirements: the fully collapsed UI takes visual inspiration from the user's Claude overlay screenshot. **Reset annotations** is a first-class action that clears screen ink and interrupts Ada's current response, including pending generation, speech and drawing. It preserves the conversation and shared source.

## Collapsed overlay design

The supplied image was inspected at its Windows-mounted temporary path. Use the Claude bar's bottom-centered silhouette, rounded corners, density, row structure, soft border and shadow as style inspiration only. Keep Tassel's existing color palette throughout: Bone/Paper surfaces, Ink text, existing secondary-text tokens and Iris accents. Do not copy Claude's charcoal background or orange accent. The image is a visual reference only; its permission prompt and other visible text do not define Tassel behavior. The temporary screenshot is not a durable project asset.

### Layout and states

- Default position: horizontally centered, 24 DIP above the selected display's work-area bottom, avoiding the taskbar/Dock. Start around 600–720 DIP wide with a 56–64 DIP main row; clamp width to the available work area with 16 DIP side margins. These are design starting values to validate at native scale.
- Main row: existing configured avatar at left, current caption/status in the middle, then Reset annotations, microphone and restore controls. A small active-sharing indicator remains visible. Keep reset and stop-sharing reachable without opening the full app; secondary actions may use a compact menu.
- Captions: up to two readable lines, growing upward so the bottom anchor stays fixed. Interim words replace their own line. Full captions remain available in expanded view. At narrow widths prioritize captions and primary controls; move Draw, Look again and source details into a keyboard-accessible popover.
- Idle/listening: compact main row with a short listening status or most recent caption. Thinking: subtle avatar/status motion, not a large spinner. Speaking: existing speech animation and live captions. Resetting: immediate listening appearance with brief “Annotations reset” feedback; show connection trouble separately if acknowledgment is delayed.
- Sharing paused: show “Screen sharing paused” and Resume. Sharing stopped: restore expanded view by default so there is no orphaned desktop bar. User dragging remembers the position for this display; clamp again after work-area changes.
- Use existing theme tokens from `packages/shared/src/styles/tokens.css`: Bone (`#fff9f3`) or Paper (`#ffffff`) for the surface, Ink (`#222222`) for primary text, Smoke Text for secondary labels, and Iris/Iris Ink for selected controls and accents. Reuse the app's existing border and shadow treatment. Keep the surface sufficiently opaque to preserve readability over both white PDFs and dark editors; native blur is optional polish with an opaque fallback. No large panel or input composer is required while fully collapsed.
- Hit targets at least 36 DIP, explicit accessible labels and tooltips, visible focus, readable caption contrast, and reduced-motion support. Design drag regions separately from buttons/text selection. Hover must never be the only way to discover critical controls.

### Motion specification

Collapse follows a single guarded transition: prepare HUD → acknowledge first paint → animate main content toward the bar anchor → show HUD/hide main → mark overlay active. Target 280 ms initially with an ease-out curve; tune on hardware. Restore uses the reverse visual handoff and returns focus to the originating control. Keep avatar/caption state mirrored through the handoff so neither flashes empty. If the HUD fails to initialize, leave the main window usable and sharing controls visible.

Use a temporary visual shell for the shrink illusion if needed; do not scale the live session's semantic layout into unreadable intermediate states or continuously resize a transparent native window. Repeated collapse/restore requests resolve to one final desired state. Reset during either transition takes priority over decorative animation and is delivered exactly once.

## Reset annotations and interruption contract

**User meaning:** “Stop what you're doing and clear the screen.” This is a button-driven interruption of the active response and related work, not deletion of session history or an attempt to access private model reasoning.

| Action | Clears desktop ink | Interrupts Ada | Sharing afterward |
| --- | --- | --- | --- |
| Reset annotations | All tutor marks, student strokes and transient pointers | Yes: generation, speech, queued beats and screen-dependent tool work | Continues; waits for next student turn or Look again |
| Undo student stroke | Most recent student stroke only | No | Continues |
| Automatic viewport invalidation | Marks anchored to the previous viewport | Invalidates stale visual work; cancels screen-dependent work, without globally restarting unrelated speech | Continues |
| Pause sharing | All live screen marks and pending screen context | Interrupt current screen-dependent response | Paused until Resume |
| Stop sharing | All live screen marks and queued screen work | Interrupt current screen-dependent response | Track ended; expanded app restored |

### Immediate local behavior

1. Send one typed reset intent from the HUD to the session owner through validated IPC. Include session ID, source epoch, unique reset ID and the current interaction epoch.
2. The owner advances the interaction epoch synchronously, clears all live screen marks, cancels an in-progress student stroke, exits Draw mode to click-through and cancels pending drawing animations. Reset is enabled even if there are zero visible marks because Ada may still be thinking or speaking.
3. Immediately suppress old-generation audio and mark/beat delivery at the client. Clear the currently interrupted caption while retaining previous completed conversation history; return the avatar to listening. Do not show a fresh speaking caption from a discarded event.
4. Send an ordered reset control message to the server. Keep the microphone, capture grant, session connection, whiteboard and stored avatar settings intact. Do not automatically invoke another LLM response or send a spoken acknowledgment.

### Server cancellation and stale-result barrier

Proposed additive control message: `screen.reset { reset_id, session_id, source_epoch, interaction_epoch }`; acknowledgment echoes the IDs and accepted epoch. Scope it to the authenticated bot/session. Never accept an arbitrary session ID from the renderer without ownership validation. Final names must follow the existing control-message conventions.

The server records the new epoch before awaiting cancellation, then uses the existing Pipecat interruption path to stop response generation and TTS, cancel relevant thinker/Illustrator/pointer tasks and discard queued screen beats/tool results. Reset must bypass conversational interruption sensitivity: pressing the button is already an explicit instruction. Provider cancellation can be best-effort; epoch validation must reliably prevent obsolete results from reaching playback, overlays, board mutation or new durable tutor notes.

Tag new screen-related jobs and outbound effects with interaction epoch as well as source/frame/viewport identity. For shared board tools triggered by the interrupted response, suppress uncommitted stale actions while retaining already committed whiteboard content. An epoch check at task launch alone is insufficient: check again immediately before delivery or mutation. Local playback also needs an epoch boundary so already buffered media cannot keep playing; validate the transport's actual buffer interruption behavior in the spike.

Existing code has server `InterruptionFrame` handling in `voice/bot.py` and `voice/thinker.py`. The inspected `tutor/live/media-manager.ts` exposes `interruptBotAudio()` but its inspected implementation is empty. Treat immediate client audio interruption as an implementation task to prove, rather than assuming that method already stops sound. Coordinate this shared change with ongoing voice work.

Duplicate reset IDs are idempotent. Multiple resets are monotonic: late acknowledgments or responses never reduce the active epoch. Do not replay obsolete resets into a newly joined session. If disconnected, local clearing and playback suppression still work; persist the highest pending epoch for reconciliation on reconnect to the same session, and block old-epoch events until reconciled. Offer a compact retry/status notice when needed; never resurrect cleared ink to match the server.

### Resuming after reset

Leave Ada listening. On the next student utterance or explicit **Look again**, capture a fresh clean frame under the new epoch and answer from that view. The same source may still be selected; reset alone does not require the system picker again. If sharing is paused, reset must not resume it. Retain completed conversation and prior committed board artifacts, but annotate the interrupted turn as cancelled so future context does not treat unfinished instructions as completed work. Reset is local to this screen session; it does not change Paper View's clear behavior.

## Repository and branch review

Fetched `origin --prune` and examined every fetched remote branch's ancestry, tip, and outstanding diff relative to `origin/claude/live`. Local `main` and remote `main` remain at `dafe610`; they do not contain the working tutor. The implementation baseline should be the live integration branch, reviewed here at `234b64e`, rather than main. This is a point-in-time review: refresh before implementation and integration. Unpushed work in other checkouts is outside this audit.

Refresh following the user's palette clarification: ran `git fetch --all --prune` successfully. All remote branch references are current as of this refresh; the only changed tip since the prior review was `claude/floating-tiles`, advancing from `e925eb0` to `ebda220`. Reviewed its new commit and changed files: paper detection now tolerates sheet movement and resting hands, with detector/synthetic-fixture tests. Keep screen viewport invalidation separate from that paper-specific logic. Fetching updates remote-tracking refs; it does not merge unrelated branches into local main or alter the working tree.

| Branches | Finding and integration boundary |
| --- | --- |
| `claude/live` | Working integration baseline: voice, paper, board, marks, snapshots, stage management, avatar and memory. |
| `claude/p1-ui`, `claude/p2-client`, `claude/p2-desktop`, `claude/p2-server`, `claude/p2-voice-loop` | Ancestors of live. Reuse shell and voice/media plumbing. |
| `claude/p1-foundation` | One outstanding team handoff document; reviewed it. It identifies live as baseline and voice/vision/beats/tutor as shared hot spots. |
| `claude/p3-native`, `claude/p3-paper-view`, `claude/p3-server`, `claude/p3-vision`, `team2/windows-webcam` | Ancestors of live. Keep camera/helper, webcam testing and paper capture semantics intact. |
| `claude/p4-automata-vision`, `claude/p4-base`, `claude/p4-core`, `claude/p4-gates`, `claude/p4-perception` | Ancestors of live. Do not route digital frames through paper geometry, pencil enhancement or DFA-specific detection. |
| `claude/p5-board-and-beats`, `claude/p5-live`, `claude/p5-live-app`, `claude/p5-marks`, `claude/p5-scene` | Ancestors of live. Reuse synchronized drawing/voice timing and preserve wire contracts. |
| `claude/p5-board` | Two commits outside ancestry, including a merge, with multiple merge bases. Live already merged its trace work (`42e3df0`). Do not treat the large three-dot diff as wholly missing work or blindly merge it. |
| `claude/vision-lite`, `claude/vision-sharpen`, `claude/vision-lined` | Ancestors of live. These improvements remain paper-only. |
| `claude/board-memory`, `claude/board-snapshot`, `claude/diagram-render`, `claude/illustrator`, `claude/live-board`, `claude/pointer`, `claude/stage-manager`, `claude/test-select` | Ancestors of live. Preserve board persistence, snapshot identity, student controls, Illustrator, pointer IDs, stage pinning and targeted-test policy. |
| `claude/floating-tiles` | Five commits ahead of live (`ebda220` tip); touches voice director, thinker, bot, prompts, beat markup, paper detector and synthetic fixtures. Includes redo, Illustrator diagram edits, spoken view requests and paper movement/hand tolerance. Avoid implementing competing floating-board behavior or changing these contracts independently; keep screen detection separate from paper heuristics. |
| `codex/tutor-memory`, `team2/avatar-customization` | Ancestors of live. Render the existing configured Avatar and memory state rather than a new avatar implementation. |
| `codex/tutor-personality` | Two commits outside live ancestry; personality UI, API/schema, migrations and voice prompt wiring. Avoid those files except coordinated additive integration. |
| `landing-page` | One outstanding commit, mostly `apps/web`, with root package/lockfile edits. No product overlap; avoid unnecessary dependency changes. |
| `main` | Ancestor of live; foundation only. |

Only local branch is `main`. Existing untracked launcher scripts, setup/coordination docs and `output/` were left untouched. No branches were checked out or merged.

## Existing stack and useful seams

- Desktop: Electron 44.9.0, React 19, TypeScript, electron-vite, Tailwind, Radix and Zustand on live. Use existing visual tokens and CSS motion; no new animation framework needed.
- Voice: Pipecat client and SmallWebRTC transport, Python Pipecat server, existing captions, avatar speech state and timed beats. Keep one connection alive throughout collapse/restore.
- Drawing: tldraw 5.5.2 for the editable whiteboard, SVG/custom shapes for paper marks, Graphviz for diagrams. Reuse lightweight SVG mark primitives and beat timing for the desktop overlay; keep tldraw on its existing board.
- Server/storage: FastAPI, Pydantic, Postgres/SQLAlchemy, object storage and existing authenticated frame/snapshot machinery. Add screen-specific contracts alongside paper contracts.
- Tests: Vitest, React Testing Library, Playwright/Electron and pytest; existing fake-device guards and synthetic imagery.
- `main/paper/display-media.ts` already registers Electron display capture. On Windows/Linux it currently chooses the first screen; that is insufficient for this feature's explicit display selection. macOS uses the system picker when available.
- `paper/sources/screen.ts` already wraps `getDisplayMedia`; extract/reuse low-level stream helpers without making Screen View a paper pipeline.
- `paper/upload/frame-uploader.ts` explicitly refuses screen frames. `use-paper-capture.ts` also excludes screen from turn-frame registration. Preserve both guards; do not simply enable screen uploads globally.
- `vision/turn_image.py` builds paper-specific `PageView` and paper board context, including page processing. Screen needs its own image/context adapter.
- `features/session/stage-store.ts` and `voice/stage.py` coordinate paper/board/split and user pinning. Desktop presentation must be an independent state axis.
- Current `main/windows.ts` creates the regular main window; it does not implement the desktop overlay proposed here.

## Architecture decisions

1. **Separate capture source, stage layout and desktop presentation.** Track work source as paper or screen; preserve existing paper/board/split wire meanings initially. Add presentation state `expanded | collapsing | overlay | restoring`. Tutor stage requests cannot silently expand the app or change what is shared. When Ada needs the board while collapsed, show an unobtrusive “Open board” action using existing stage hints.
2. **Keep the main renderer as session owner.** Hiding the main window must not unmount SessionScreen, VoiceSession, capture or the board. Overlay renderers receive a minimal typed state snapshot over validated preload IPC and send validated control intents back. Zustand stores and audio clocks are not automatically shared across windows. Include sequence numbers and time references when mirroring speech/beat state; never create a second bot, microphone stream, or audio player.
3. **Two overlay surfaces.** A compact interactive HUD contains avatar, captions, share/pause, mic, draw and restore controls. A display-sized transparent annotation window passes clicks through by default. Student Draw mode deliberately enables input; Escape returns click-through. Use the same sandbox, origin and sender checks as the app. Do not expose general Electron APIs to the renderer.
4. **Start with one selected display.** Record display identity, pixel dimensions, desktop DIP bounds, scale and source epoch. Map model-image pixels to normalized capture coordinates, then to desktop DIPs and overlay-local coordinates. Handle negative monitor origins, scaling, rotation and downsampled frames. Pause and reselect on display removal or ambiguous source mapping.
5. **Revision-bound marks.** Every frame and mark references session, source epoch, frame ID and viewport revision. Clear/hide marks immediately when local frame comparison detects scrolling, zooming, major edits or navigation; only show new marks when their referenced view still matches. Without a browser extension we cannot assume access to the PDF DOM or exact scroll offsets. Short-lived marks and a frozen annotated preview are the safe fallback when motion detection is uncertain.
6. **Explicit sharing lifecycle.** Selecting “Share with Ada” authorizes screen frames for this screen-mode session. Show the active source and pause/stop control. Begin with a fresh frame on each student turn and explicit “look here”; defer continuous upload until measured. On pause/stop/source change, cancel pending capture and invalidate stale in-flight responses. The tutor must never describe an old image as current.

## Build sequence

### 1. Validate the native overlay and capture geometry first

Create a disposable spike against the pinned Electron version: source selection, transparent always-on-top HUD and annotation window, click-through, draw/Escape behavior, hidden-main capture/audio continuity, and selected-display mapping on Windows and macOS. Test full-screen apps and monitor scaling on actual hardware.

Check whether Tassel surfaces contaminate its own capture. Electron content protection is platform-dependent, particularly on macOS with ScreenCaptureKit. Do not promise universal exclusion. Prefer proven source exclusion; if unavailable, omit overlay-occupied regions from model frames and avoid uploads while drawings are visible, accepting a brief mark expiry before the next clean frame. Validate that this prevents recursive annotations without repeatedly flashing the HUD. If it cannot, require a clean-source capture solution before shipping live desktop drawing.

Deliverable: verified platform matrix and working geometry sample. This resolves the largest uncertainty before server integration.

### 2. Add screen source lifecycle and explicit picker

Proposed modules: `renderer/src/screen/` for source, store and capture policy; `main/screen/` for source selection and grants; `shared/screen-bridge.ts` for typed IPC. Use a feature flag while integrating.

Reuse the existing display-media registration through one dispatcher. Do not register a second handler on the same Electron session that replaces the paper handler. Grants must be scoped to the requesting trusted frame, selected source and one request; cancellation and expired choices deny capture. Preserve fake-device guards. Screen sharing requests no system audio; the existing microphone stays in charge.

Keep paper sessions untouched. A source switch stops the previous feed before starting the next and leaves voice/board state alive. If selection fails or is cancelled, stay expanded and offer retry.

### 3. Build the compact bar and collapse transition

Proposed modules: `main/overlay/` and `renderer/src/overlay/` plus a narrow overlay bridge. Extract reusable avatar/caption presentation only where needed; avoid modifying avatar customization or personality workflows.

On successful capture, pre-render the HUD, animate the main app's visible content toward the HUD anchor over roughly 250–350 ms, hand off to the ready HUD, then hide the main window. Restore reverses the handoff. Animate CSS transforms/opacity rather than repeatedly resizing a transparent native window. Respect reduced motion with an immediate or short-fade handoff. Preserve main-window bounds, keyboard focus, caption continuity and avatar state. Prevent duplicate transitions on repeated clicks.

Only the compact bar, captions, avatar and current annotations remain visible. Controls can reveal on hover/focus, but pause sharing, restore and keyboard escape paths must stay discoverable. Drag the HUD within the selected display's work area.

### 4. Feed digital frames into the tutor

Add a separately authenticated screen-frame path and screen turn-image adapter, using existing storage/auth utilities where suitable. Define screen source, consent/grant state, frame ID, capture timestamp, viewport revision, dimensions and downsample transform. Validate image size/type and session ownership. Update generated API types through the repository generator rather than hand-editing them.

Do not pass screen frames through page flattening, lined-paper enhancement, handwriting stillness or paper sharpness thresholds. Preserve color and readable small text; tune image size against representative digital assignments, with a higher-resolution crop for “look here” if required. Reuse the provider stack and turn orchestration behind a small work-source adapter, coordinated with voice/vision owners. Reject late frames and late marks from old source epochs.

Start with turn-triggered capture and a bounded latest-frame queue. Screen pause also clears tutor access to cached screen context; restoring the app alone does not stop sharing. Stop sharing ends the track and clears the grant, queued frames and desktop marks.

### 5. Add tutor and student drawing

First tools: pointer pulse, circle, underline, arrow, freehand, clear and undo student stroke. Use normalized screen coordinates with frame/revision identity. Adapt existing SVG geometry and synchronized beat playback; never relabel a screen frame as paper or overload paper mark IDs. Keep model coordinates constrained to the image it actually saw.

Student strokes are overlay ink and do not edit the PDF/browser document. Keep live screen marks ephemeral; screenshots or board copies are explicit actions through existing snapshot/board seams. Ada's pointer can pass through; student ink captures input only while Draw is enabled. On viewport change, clear both kinds of screen ink rather than leaving misleading highlights on different text.

Implement Reset annotations as the interruption contract above, rather than as a canvas-only clear. Prototype the client audio cutoff and server acknowledgment during phase 1; deliver the full epoch/cancellation barrier before enabling live tutor drawing. No confirmation dialog: reset must be immediate and usable repeatedly. A proposed configurable shortcut is Ctrl/Cmd+Shift+Backspace, subject to collision testing and successful global registration; the visible button always works. Escape remains reserved for leaving Draw mode and closing transient menus.

### 5a. Concrete implementation slices

| Slice | Proposed files or existing seam | Reviewable result |
| --- | --- | --- |
| Native proof | New `main/overlay/` spike and fake screen fixture | Click-through, clean capture, monitor mapping, audio cutoff evidence |
| Contracts | New `shared/screen-bridge.ts`, `shared/overlay-bridge.ts`; additive server control models | Typed source, presentation, reset/ack and epoch contracts with validation tests |
| Source ownership | New `screen/screen-store.ts`, `screen/capture-controller.ts`; existing display-media dispatcher | One selected source, explicit grant, cancellation and teardown |
| Presentation | New `overlay/OverlayBar.tsx`, `overlay/overlay.css`, `overlay/presentation-store.ts`; narrow SessionScreen integration | Reference-inspired bar and uninterrupted collapse/restore |
| Mirroring | New overlay state relay and preload subscription cleanup | Avatar, captions and controls stay synchronized across windows |
| Screen frames | New server screen adapter plus authenticated frame route; existing turn routing seam | Fresh digital image per turn without paper enhancement |
| Reset | New client reset coordinator; shared audio interruption seam; server interruption adapter | Immediate local clear/audio cutoff plus acknowledged cancellation and stale-effect rejection |
| Marks | New `screen/annotations/` layer and viewport invalidation | Tutor primitives and student ink with revision/epoch checks |
| Integration | Localized catalogs, focused tests, source/restore controls | End-to-end fake demo and native acceptance checklist |

File names are proposed boundaries, not an instruction to duplicate an equivalent module found during implementation. Keep the screen reset coordinator responsible for sequencing; React components dispatch intent rather than independently clearing state and cancelling transport. Retain one session owner as the authority for epochs. Revalidate branch ownership before touching shared voice and tool code.

### 6. Integrate and verify

Keep edits primarily in new screen/overlay modules. Shared hot spots are SessionScreen, Dock/source selection, display-media registration, preload/bridge, tutor frame routing, screen context and localized strings. Integrate these as small additive changes after refreshing live and outstanding branches. Coordinate floating-tiles and personality changes before touching voice bot/prompts or beat markup. Do not merge every historical feature branch.

Required automated checks:

- Geometry tests: mixed DPI, negative origins, downsampling, rotation and source epoch changes.
- Lifecycle/IPC tests: trusted sender validation, cancellation, paused uploads, stale responses, teardown, and exactly one voice client across hide/restore.
- Fake-source Electron E2E: select source → collapse → captions/avatar continue → annotate → viewport change clears marks → restore → stop. Verify Draw/Escape and click-through mode transitions with platform-appropriate assertions.
- Server tests: ownership, invalid images, size limits, timestamp/revision handling, stale-source rejection and source-aware context selection.
- Reset race tests: reset during thinking, TTS buffering, speech, a delayed tool result, frame upload, student stroke and collapse/restore. Assert immediate clear, exit from Draw, interruption delivery, no automatic new response and no reappearing marks/audio/captions from the old epoch.
- Reset reliability tests: duplicate clicks/IDs, out-of-order acknowledgments, reset with no marks, offline reset/reconnect, paused sharing, session change and teardown. Verify already committed whiteboard content and conversation remain available.
- Overlay design checks: native-scale width/position, dark and light backgrounds, long captions in en/es/ko, keyboard-only controls, reduced motion, work-area changes and no focus theft while the student types in the assignment.
- Regression: paper uploader still rejects screen frames; paper turn capture, webcam/helper, stage pinning, board snapshots, redo and avatar/memory/personality remain functional.
- Run targeted suites per repository policy, type checks and i18n validation; broaden when shared contracts change. Automated tests use fakes and no paid providers or real capture devices.

Owner-run native acceptance: work in a PDF/browser while speaking; taskbar/Dock and full-screen behavior; captions stay synchronized; mixed-scale monitors; permission denial/revocation; source closed; monitor unplugged; app quit and end-session stop all streams. Inspect a captured model frame to confirm overlay exclusion/masking. Record these as manual evidence, not simulated E2E success.

## Acceptance criteria

- The student opens a digital assignment, selects a display and keeps working in the original application.
- Tassel visibly collapses to a compact bar with configured avatar and live captions; restore preserves the conversation and board.
- Ada uses a fresh digital frame without paper processing and points/draws at the correct visible content.
- Click-through is the default; drawing is deliberate and Escape reliably exits it.
- Scrolling, resizing, zooming and source changes never leave old marks attached to new content.
- Pause/stop prevents further screen use and invalidates queued work; capture ends on session termination.
- Paper View, board pinning, avatar customization and existing voice features continue to work.
- Fully collapsed appearance follows the supplied Claude reference's bottom-centered rounded bar shape and layout, using Tassel's existing Bone/Paper, Ink and Iris palette, configured avatar and captions. No Claude-specific color palette is introduced.
- Reset annotations is always reachable, clears ink within the next rendered frame under normal load, and locally cuts off obsolete speech with an initial target of 150 ms or less from the accepted click. Measure actual transport/device latency and report it; do not claim this target from mocked tests.
- Reset cancels Ada's current response and pending visual effects; no obsolete event can redraw or resume that response. Ada waits for the student or Look again while sharing stays active.

## Scope and complexity

The image-understanding path should be simpler than Paper View because it removes camera noise, page geometry and handwriting cleanup. Native window layering, capture exclusion and viewport alignment still need dedicated validation. Build these before polishing animation. Defer arbitrary moving-window tracking, DOM/accessibility extraction, continuous screen streaming, document-persistent annotations and a new floating editable whiteboard.

## Sources and inspiration

Repository: `docs/research/02-desktop-camera-vision.md`, `docs/research/03-whiteboard-visuals-avatar.md`, live capture/marks/stage code, and the branch handoff. Existing research supplies inspiration, not proof of platform behavior.

Current primary documentation checked for this plan:

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer): desktop/window capture through display-media plumbing.
- [Electron session](https://www.electronjs.org/docs/latest/api/session): `setDisplayMediaRequestHandler`, selected sources and experimental system picker behavior.
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window): transparent windows, mouse handling, visibility and background throttling.
- [Electron BaseWindow](https://www.electronjs.org/docs/latest/api/base-window): always-on-top, click-through and content-protection platform behavior. Verify on the pinned runtime and target OS before relying on exclusion.

Interaction inspiration: presentation annotation tools' deliberate draw/pass-through toggle, compact screen-sharing control bars, and Tassel's own SVG paper marks and word-timed board effects. No replacement capture vendor, drawing framework or model provider is necessary for the initial implementation.
