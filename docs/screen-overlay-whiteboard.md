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
- `draw_screen_board` accepts the existing checked automaton, diagram and note
  actions plus a screen placement. It uses the regular whiteboard figures and
  bindings, rather than generating an imitation of them.
- `draw_screen_illustration` draws a batch of actual paths, shapes, arrows and
  text. Screen drawing requests do not enter the graph-only illustrator route.
- Purple is the default, including DFA labels. Explicit colors apply to paths,
  writing and structured board items. Board text follows the session language.

## Persistent objects and controls

The owner keeps stable object IDs and synchronizes a bounded, ephemeral inventory
to the authenticated screen session. Path inventories contain bounds rather than
every vertex. Student ink is composited into captured frames without hiding the
native overlay. Existing structured item specifications stay in screen context.

`edit_screen` lists, removes, moves, recolors or clears existing objects. Edits do
not need a fresh screenshot and remain available while capture is paused or an
image request fails. New drawings still require a current delivered frame. Tool
success waits for an acknowledgement that the session owner applied the command;
reset invalidates pending acknowledgements. Batches validate before mutation.

Scrolling invalidates pending drawing coordinates without clearing existing ink.
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
