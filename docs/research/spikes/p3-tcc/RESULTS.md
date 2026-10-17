# P3 TCC and capture spike: results

P3 Task 1's gate. Later tasks branch on these verdicts. This file holds verdicts and JSON lines only: no images, and nothing about the content of any frame.

- **Date:** 2026-10-17, 14:34 EDT (the unattended run below)
- **Machine:** MacBook Pro, Apple M5 Pro, macOS 26.6.2
- **Toolchain:** Electron 44.9.0 (Chrome/152.0.7977.167), Swift 6.3.3 (Command Line Tools), Node 26.10.0, Playwright 1.64.1
- **Run:** `node docs/research/spikes/p3-tcc/run.mjs A F P T C E` from an agent's shell. It builds `probe.swift` into the git-ignored `.out/`. Paths inside the checkout print as `<repo>/…`.

## Verdicts

| Check | Verdict | Evidence |
|---|---|---|
| **H** | NOT RUN (pending owner at the Mac) | Held by main until the owner is at the Mac. E already shows the probe authorized under a LaunchServices launch. |
| **A** | PASS | Under an Electron the agent started, the probe reads camera `0` (not determined): TCC answers for the agent's app |
| **F** | PASS | Chromium's fake camera played the MJPEG: a 960×720 track at 30 fps, and 10 frames at 960×720. Nothing waited on a TCC prompt: the frames arrived within about a second |
| **P** | PASS | `new MediaStreamTrackProcessor({ track })` works in the window. Its `readable` transferred to a worker, and 10 `VideoFrame`s arrived there |
| **T** | PASS, with a caveat | The `{ video: request.frame }` handler gave 10 frames at 30 fps in a visible window, each frame the whole window. **Caveat:** Screen Recording is granted on this Mac both to the agent's app and to Electron, so this run can't show that capture works without the grant (see "Notes for later tasks") |
| **C** | PASS | `connectOverCDP` attached to an `open -n -a` launch after its page loaded, and `document.title` evaluated to `p3-spike`. CDP `Browser.close` quit the app gracefully |
| **E** | PASS | `open --env TASSEL_SPIKE=1` reached `process.env.TASSEL_SPIKE` as `"1"` |
| **D** | NOT RUN (pending owner at the Mac) | Held by main with H |
| **S** | NOT RUN (pending owner at the Mac) | Held by main with H |

## Decision table, filled in

| Check | Verdict | What later tasks do |
|---|---|---|
| **H** | NOT RUN | Ruling P3-R20: until H runs, Track A follows the PASS branch provisionally. Task 10 sets `MACOS_DEFAULT = 'deskview-helper'`, Task 3 builds `CameraProducer`, and Task 14 runs the real-camera spec. E backs that choice: under a LaunchServices launch, the probe Electron spawns reads camera `3` (authorized). If H then fails, the FAIL branch applies: `MACOS_DEFAULT = 'window-capture'`, and the camera producer is deferred to P10 |
| **A** | PASS | The responsible-process rule is confirmed: camera `0` under the agent's Electron (A), and `3` under a LaunchServices Electron (E) |
| **F** | PASS | Task 10's `fake-clip` source as written |
| **P** | PASS | Task 8's sampler as written |
| **T** | PASS (caveat) | Task 13's window-capture and unavailable specs as written |
| **C** | PASS | Task 14 drives the UI over CDP |
| **E** | PASS | Task 14 passes `TASSEL_*` with `--env`; no `--tassel-env-file` |
| **D** | NOT RUN | Pending. Until D runs, `paper-bridge.ts` has no `openDeskViewApp`, and Track A builds the D-dependent part (Task 3's `openSetup`) last (P3-R20). If D fails, Task 1 adds `openDeskViewApp` and `PAPER_IPC.openDeskViewApp = 'paper:openDeskViewApp'` to the contract |
| **S** | NOT RUN | Pending. Window capture ships either way; S only records whether the system picker works without a Screen Recording grant |

## JSON lines

Each check's lines, as `run.mjs` printed them. Lines without a verdict come from `main.cjs`, or from the probe through it. `media-access` is `systemPreferences.getMediaAccessStatus` read at startup, which never prompts. `quit` means the app quit by itself, not on a timeout or a kill.

### A: the probe under an Electron the agent started

```
{"check":"media-access","camera":"not-determined","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"status","camera":0}
{"check":"quit","mode":"status"}
{"check":"A","verdict":"PASS","why":"camera 0: not authorized, as the responsible-process rule predicts"}
```

### F and P: the fake camera, and the processor's readable in a worker (one run)

```
{"check":"write-mjpeg","path":"<repo>/docs/research/spikes/p3-tcc/.out/spike-clip.mjpeg","frames":60,"width":960,"height":720,"bytes":878220}
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"quit","mode":"fake-camera"}
{"check":"fake-camera","clip":"spike-clip.mjpeg","processorInWindow":true,"track":{"label":"<repo>/docs/research/spikes/p3-tcc/.out/spike-clip.mjpeg","readyState":"live","width":960,"height":720,"frameRate":30,"displaySurface":null},"worker":{"frames":10,"sizes":["960x720"],"videoFrames":true,"processorInWorker":false,"fps":30.2}}
{"check":"F","verdict":"PASS","why":"10 frames at the clip's 960x720, track \"<repo>/docs/research/spikes/p3-tcc/.out/spike-clip.mjpeg\""}
{"check":"P","verdict":"PASS","why":"10 VideoFrames reached the worker through the transferred readable"}
```

### T: a visible 320×240 window captures itself

```
{"check":"media-access","camera":"not-determined","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"quit","mode":"self-capture"}
{"check":"self-capture","requests":[{"frame":true,"securityOrigin":"spike://p3/"}],"window":{"width":320,"height":240,"dpr":2},"track":{"label":"p3-spike self","readyState":"live","width":3024,"height":1964,"frameRate":30,"displaySurface":"browser"},"frames":10,"sizes":["1280x960"],"bySize":{"1280x960":{"atFrame":1,"blackEdge":0,"pageEdge":0.929,"barPx":160,"framePxPerCssPx":4}},"first":{"coded":"1280x960","visibleRect":[0,0,1280,960]},"fps":30.2}
{"check":"T","verdict":"PASS","why":"10 frames, each of the whole 320x240 window: 1280x960 at 4 frame px per CSS px (dpr 2; track settings said 3024x1964). Screen Recording for the responsible process: granted"}
```

Three development runs with the same measurement also passed, with other sizes. One had track settings of `640x480` and frames of `1280x960` throughout. Two had settings of `3024x1964` and frames that started at `640x480` (2 px per CSS px), then switched to `1280x960` (4 px per CSS px) from the second frame. In every run each frame size showed the whole window: `blackEdge` 0, with the 40 px test bar spanning 2 or 4 frame pixels per CSS pixel.

### C: CDP attach to a LaunchServices launch

```
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"cdp","title":"p3-spike"}
{"check":"quit","mode":"cdp"}
{"check":"cdp-client","browser":"Chrome/152.0.7977.167","title":"p3-spike","closedBy":"Browser.close (graceful quit)"}
{"check":"C","verdict":"PASS","why":"evaluated document.title \"p3-spike\"; closed by Browser.close (graceful quit)"}
```

### E: `open --env` (status mode, with the probe)

```
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":"1"}
{"check":"status","camera":3}
{"check":"quit","mode":"status"}
{"check":"E","verdict":"PASS","why":"TASSEL_SPIKE is \"1\""}
```

### H, D and S

Not run yet. They wait for main's GO with the owner at the Mac: `node docs/research/spikes/p3-tcc/run.mjs H D S`. A follow-up commit adds their lines and verdicts here.

## Notes for later tasks

1. **The fake-device switch makes camera and microphone status read `granted`.** A and T (no switch) read camera `not-determined` for the same responsible process; F read `granted`. The only difference is `use-fake-device-for-media-stream`. That matches Chromium's macOS permission check, which reports access as allowed whenever fake media devices are in use. So under `fake-clip`, `systemPreferences` says nothing about TCC. Task 9's `TASSEL_FAKE_CAMERA_ACCESS` is the way to fake a state.
2. **`MediaStreamTrackProcessor` exists in the window but not in a dedicated worker** (`processorInWindow: true`, `processorInWorker: false` in Chromium 152). Transferring its `readable` works, as Task 8 plans.
3. **Tab-capture frames (check T) don't match the track's settings, and can change size mid-stream.**
   - `getSettings()` said `640x480` in one run and `3024x1964` (the screen's size) in others. Either way, `displaySurface` was `browser`.
   - The frames were `1280x960`, or `640x480` and then `1280x960`. Chromium renders a captured tab at up to twice the device scale.
   - Code that sizes a feed should read each frame (or `videoWidth`), not `getSettings()`, and should survive a size change. This matters for Task 10's `findContentTop` on the first frame, for Task 8's frame loop, and for Task 7's page quad, which is in pixels of the full frame.
4. **T's caveat, in full.**
   - On this Mac, Screen Recording is granted to the agent's app (A's and T's `screen: granted`) and to Electron (E's `screen: granted`). So no run here can show that self-capture works without the grant.
   - The capture is a tab capture (`displaySurface: "browser"`). Chromium serves it from the page's own compositor output, not through ScreenCaptureKit, so the grant shouldn't matter. That reasoning isn't verified on a Mac without the grant.
   - Task 13's specs run on this Mac, where the result above holds.
5. **CDP `Browser.close` quits Electron, but the reply may never arrive.** Send it without awaiting the answer, then watch the process exit, as `run.mjs` does (Task 14).
6. **In file mode, the fake camera's track label is the clip's absolute path** (F), as Task 10 expects. It plays at 30 fps.
7. **Under LaunchServices, Electron reads camera, microphone and screen as `granted`** (C's and E's `media-access`), and the probe it spawns reads camera `3`. So H should run without a TCC prompt.

## Files

- `probe.swift`, `Info.plist`: the probe (`dev.tassel.p3-probe`). `--status` never asks for access. `--capture <n>` counts Desk View frames and keeps none. `--present-setup` presents the Desk View app. `--write-mjpeg` writes the synthetic test clip.
- `main.cjs`: the Electron main with the spike's modes. It writes its pid, then one JSON line per result, to `--out`.
- `run.mjs`: builds the probe and runs the named checks: directly spawned (A, F, P, T), or through LaunchServices (H, E, D, S, and C without `-W`).
- `.out/` (git-ignored): the probe, the synthetic clip, and each check's `--out` file. `pnpm check` refuses to commit any `.mjpeg`, `.jpg`, `.jpeg` or `.y4m`.
