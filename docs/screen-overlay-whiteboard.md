# Screen overlay whiteboard

The transparent desktop overlay uses the existing `TldrawCanvas`, board scene,
checked board actions, layout code, custom DFA/diagram figures and diff engine.
The former SVG annotation renderer is removed. Screenshots remain model input;
the native canvas never paints a screenshot over the real desktop.

## Coordinates and drawing tools

- Screen coordinates are fractions of the entire delivered screenshot, including
  window chrome and margins. They map to the selected display's local canvas.
  Desktop monitor origins never become local drawing coordinates.
- The native Windows ink window restores the complete display bounds after it is
  shown. Initial window sizing can otherwise shrink it to the work area.
- Screen cameras are locked at the origin. The engine also observes tldraw's own
  viewport measurement, because the parent's resize observer can run first and
  otherwise leave an incorrect zoom behind.
- `draw_screen` grounds a named existing target with the existing pointer client
  against the current delivered image. It rejects ambiguous targets and changed
  frames. The talker does not need to guess coordinates before grounding.
- `draw_screen_artwork` sends a plain-language request and the full captured image
  to the shared Astra illustrator. It generates either checked board actions with
  placement or general freehand paths, shapes, arrows and written text. The talker
  cannot bypass this generator by submitting new artwork through `draw_screen`.
- Regular structured diagrams and automaton constructions also use `gpt-6-astra`.
  Legacy fast-illustrator profile settings do not override shared drawing routing.
- The low-level `draw_screen_board` and `draw_screen_illustration` handlers remain
  available for calls already in flight; they are no longer advertised to the tutor.
- Purple is the default, including DFA labels. Explicit colors apply to paths,
  writing and structured board items. Board text follows the session language.

## Persistent objects and controls

The owner keeps stable object IDs and synchronizes a bounded, ephemeral inventory
to the authenticated screen session. Path inventories contain bounds rather than
every vertex. Student ink is composited into captured frames without hiding the
native overlay. Existing structured item specifications stay in screen context.

`edit_screen` lists, removes, moves, recolors or clears existing objects. Edits do
not need a fresh screenshot and remain available while capture is paused or an
image request fails. New drawings use the screenshot delivered for their request. Tool
success waits for an acknowledgement that the session owner applied the command;
reset invalidates pending acknowledgements. Batches validate before mutation.

Scrolling invalidates pending target annotations without clearing existing ink. Independent
artwork finishes against its request snapshot even when later captures or viewport changes arrive.
Capture does not hide ink. Optimistic student strokes stay visible until the
owner confirms them or acknowledges rejection; unrelated caption updates do not
remove them. Native focus and mouse interception change when drawing mode changes,
rather than on every caption update.

The expanded dock has a separate minimize button. Its screen-sharing button starts
or stops sharing, and both presentations retain an explicit stop control. Existing
caption scrolling, configured tutor names and transition animations are preserved.

## Verification

Regression coverage includes shared engine records and bindings, late viewport
measurement, portrait/landscape positioning, negative display origins, explicit
colors, transparent notes, stale commands, paused removal, authenticated inventory
and acknowledgement endpoints, and optimistic ink acceptance/rejection.

The fake-device Electron test exercises drawing, capture without hiding ink,
pause/resume, clear, restore/minimize/stop, actual DFA figures and written text,
transparent canvas styling, and automatic/manual caption scrolling. Screenshots
are synthetic, and no real camera, microphone, display capture or paid provider
call is used by this verification.

Validation in this change:

- 499 affected desktop tests passed, followed by the added optimistic-ink regression.
- 286 shared tests passed.
- 578 screen/voice server tests passed; one skipped.
- Synthetic Electron overlay flow passed, with subpixel geometry tolerances.
- Desktop typechecks, Biome, Ruff, language catalogs, test-area registration and
  regenerated API consistency passed.

An earlier whole-server run passed 1,771 tests, with four failures requiring
Windows symlink privileges and five setup errors in the untouched network-isolation
tests. These are outside the screen/voice suites. An aioice shutdown warning was also emitted during the voice API tests.

Timing instrumentation remains available for capture, encoding, upload, frame
delivery, pointer resolution and drawing arrival. Synthetic hidden-window JPEG
encoding measured about 1–2 seconds; fake upload measured zero milliseconds.
These measurements do not measure a real network or provider, and latency tuning
is intentionally outside this change. Live visual-target accuracy and physical
multi-monitor/DPI behavior still need an owner-run check on the real desktop.

## Rejected drawing troubleshooting

The whiteboard tool schemas explicitly advertise string types and item ID, label
and text limits. Pydantic plain validators previously erased these types from
JSON Schema even though runtime validation still required them. The structured
screen drawing tool also includes a valid DFA invocation example.

Desktop acknowledgements distinguish changed sessions/frames from invalid edits,
board actions, board structures and mark batches. These bounded reason codes reach
the tool callback. Unconfirmed delivery is described separately from invalid input.
Opt-in development transcripts record `screen_tool_result` with tool name, argument
field names, frame ID, action kind and the result, without image bytes or paths.
Stale geometry remains rejected; these diagnostics do not relax positioning checks.

## Astra generation and the missing-drawing regression

The supplied live trace showed complete board actions encoded as JSON strings,
followed by fallback stroke arrays cut off at the conversation's 400-token cap.
Complete container strings are decoded before normal validation; truncated JSON is
rejected without guessing missing geometry. Screen tool calls have a separate
minimum output allowance. New artwork now uses short plain-language tool arguments,
with the shared Astra illustrator generating validated geometry from the screenshot.
Drawing generation allows 8192 completion tokens and a bounded 30-second deadline.
The request snapshot is retained during generation. Source/session and explicit pause/reset
cancellation are checked before delivery; completion claims still require desktop acknowledgement. Screen generation logs its model and
elapsed time. Rendering guidance stays out of spoken explanations.

Regression checks cover native and JSON-encoded arguments, truncation, request token
budgets, Astra routing for regular diagrams and DFAs, screenshot-aware mixed shapes,
acknowledgement gating and stale-frame rejection. The synthetic Electron flow also
renders freehand, rectangle and text artwork at multiple display aspect ratios.


## Request snapshots and movable overlay

New artwork retains the turn's screenshot in ephemeral memory, with its original source,
epoch and viewport revision. New captures and scrolling do not discard it. Placement remains
at the normalized screen position chosen from that snapshot; it does not track page scrolling.
Target annotations keep strict viewport/frame checks. Reset, source changes, stop and pause
still reject obsolete artwork, including results arriving after sharing resumes. Existing
objects remain editable without a screenshot. The tutor must invoke a tool to retry and must
wait for desktop acknowledgement before claiming completion.

The HUD bar is a native drag region, with buttons and caption scrolling excluded. Its reverse
transition starts at its current dragged position and retains the existing animation timings.
Every collapse from the regular window targets the standard centered position above the
selected display's work-area bottom, regardless of where the HUD was dragged previously.


Validation for request snapshots: 54 targeted server tests and 14 desktop unit tests passed.
The synthetic Electron overlay flow passed with drag-region checks, moved HUD restoration,
and standard-position recollapse. Desktop main/renderer/test typechecks, changed-file lint,
and the desktop production build passed. New regression cases cover capture replacement,
scrolling during generation, reset and pause cancellation, and post-resume rejection of
pre-pause artwork. These checks use synthetic images/providers; real-provider drawing
quality and the subjective smoothness of physical window animation remain live checks.
