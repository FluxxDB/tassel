# P3 TCC and capture spike: results

P3 Task 1's gate. Later tasks branch on these verdicts. This file holds verdicts and JSON lines only: no images, and nothing about the content of any frame.

- **Date:** 2026-10-17. The unattended run was at 14:34 EDT. H, D and S ran with the owner at the Mac from 14:37 to 14:44, after main's GO
- **Machine:** MacBook Pro, Apple M5 Pro, macOS 26.6.2
- **Toolchain:** Electron 44.9.0 (Chrome/152.0.7977.167), Swift 6.3.3 (Command Line Tools), Node 26.10.0, Playwright 1.64.1
- **Runs:**
  - Unattended: `node docs/research/spikes/p3-tcc/run.mjs A F P T C E`, from an agent's shell.
  - With the owner: `run.mjs H` (twice), `run.mjs D` (three times) and `run.mjs S`, one step at a time. The owner reported each step through main.
  - Each run builds `probe.swift` into the git-ignored `.out/`. Paths inside the checkout print as `<repo>/…`.

## Verdicts

| Check | Verdict | Evidence |
|---|---|---|
| **H** | PASS | Under a LaunchServices launch, the probe Electron spawned read camera `3` and counted 30 Desk View frames at 1920×1440, with no prompt. That happened twice: first from the owner's iPhone (Continuity Camera), then from the built-in `MacBook Pro Desk View Camera` at 30 fps |
| **A** | PASS | Under an Electron the agent started, the probe reads camera `0` (not determined): TCC answers for the agent's app |
| **F** | PASS | Chromium's fake camera played the MJPEG: a 960×720 track at 30 fps, and 10 frames at 960×720. Nothing waited on a TCC prompt: the frames arrived within about a second |
| **P** | PASS | `new MediaStreamTrackProcessor({ track })` works in the window. Its `readable` transferred to a worker, and 10 `VideoFrame`s arrived there |
| **T** | PASS, with a caveat | The `{ video: request.frame }` handler gave 10 frames at 30 fps in a visible window, each frame the whole window. **Caveat:** Screen Recording is granted on this Mac both to the agent's app and to Electron, so this run can't show that capture works without the grant (see "Notes for later tasks") |
| **C** | PASS | `connectOverCDP` attached to an `open -n -a` launch after its page loaded, and `document.title` evaluated to `p3-spike`. CDP `Browser.close` quit the app gracefully |
| **E** | PASS | `open --env TASSEL_SPIKE=1` reached `process.env.TASSEL_SPIKE` as `"1"` |
| **D** | PASS | `AVCaptureDeskViewApplication().present()` from the probe launched the Desk View app, or brought it to the front, in each of three runs. Which camera the app then shows follows macOS's Continuity Camera setting (see D below) |
| **S** | PASS, with a caveat | The system picker appeared, the owner picked the Desk View window, and capture ran: 30 frames of a `window` track at 1664×1248, about 30 fps. macOS didn't ask about Screen Recording. **Caveat:** as with T, Electron already holds Screen Recording here (`screen: granted`), so this run can't show that capture works without the grant |

## Decision table, filled in

| Check | Verdict | What later tasks do |
|---|---|---|
| **H** | PASS | Task 10 sets `MACOS_DEFAULT = 'deskview-helper'`, Task 3 builds `CameraProducer`, and Task 14 runs the real-camera spec. This confirms the path Track A took provisionally under ruling P3-R20 |
| **A** | PASS | The responsible-process rule is confirmed: camera `0` under the agent's Electron (A), and `3` under a LaunchServices Electron (E) |
| **F** | PASS | Task 10's `fake-clip` source as written |
| **P** | PASS | Task 8's sampler as written |
| **T** | PASS (caveat) | Task 13's window-capture and unavailable specs as written |
| **C** | PASS | Task 14 drives the UI over CDP |
| **E** | PASS | Task 14 passes `TASSEL_*` with `--env`; no `--tassel-env-file` |
| **D** | PASS | Task 3 implements `openSetup` with `AVCaptureDeskViewApplication().present()`. `paper-bridge.ts` stays as committed, with no `openDeskViewApp` |
| **S** | PASS (caveat) | Task 10's window capture as written |

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

### H: the probe reads Desk View under a LaunchServices launch (owner at the Mac)

Two runs of `node docs/research/spikes/p3-tcc/run.mjs H` after main's GO. The owner had nothing to do, and no prompt appeared either time. The probe counted frames and wrote none.

**Run 1, 14:37.** The first `.deskViewCamera` that discovery returned was the owner's iPhone, offered through Continuity Camera. Its name contains the owner's name, which is written `<owner>` here.

```
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"capture","camera":3,"device":"<owner>’s Iphone Desk View Camera","frames":30,"width":1920,"height":1440,"fps":22.9}
{"check":"quit","mode":"capture"}
{"check":"H","verdict":"PASS","why":"30 frames at 1920x1440, 22.9 fps from \"<owner>’s Iphone Desk View Camera\""}
```

**Run 2, 14:43.** By then the owner had turned the iPhone off as a camera, and Desk View was closed. Discovery listed only the built-in camera: not a Continuity Camera, with one format, 1920×1440 at 30 fps.

```
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"capture","camera":3,"device":"MacBook Pro Desk View Camera","frames":30,"width":1920,"height":1440,"fps":30}
{"check":"quit","mode":"capture"}
{"check":"H","verdict":"PASS","why":"30 frames at 1920x1440, 30 fps from \"MacBook Pro Desk View Camera\""}
```

Both cameras gave 1920×1440. Run 1's 22.9 fps covers the first 30 frames after the iPhone's session started; the built-in camera ran at 30 fps from the start.

### D: the probe presents the Desk View app (owner at the Mac)

Three runs of `node docs/research/spikes/p3-tcc/run.mjs D`. The owner watched and reported each run through main. Every run printed the same lines:

```
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"present-setup","result":"presented"}
{"check":"quit","mode":"capture"}
{"check":"D","verdict":"PASS","why":"the probe says presented; the owner confirms the Desk View app appeared"}
```

| Run | Desk View beforehand | What `present()` did | What the owner saw |
|---|---|---|---|
| 1, 14:37:34 | Not running | Launched it (its process started at 14:37:35) | "It launched." But macOS reached for the owner's iPhone through Continuity Camera, because of a setting on the owner's Mac |
| 2, 14:40:19 | Still running from run 1. The iPhone had since been turned off as a camera | Brought the running app to the front | Desk View said "no desk view camera connected". It's likely the instance from run 1 kept its stale iPhone state |
| 3, 14:42:25 | Ended first (SIGTERM, which raises no Apple Events consent prompt) | Launched it fresh (its process started at 14:42:26) | Desk View showed the MacBook's built-in Desk View camera |

What D checks, presenting the Desk View app from the probe, worked every time. Which camera the Desk View app uses is a separate matter, recorded here on its own: the app follows macOS's Continuity Camera setting, and a running instance doesn't move to another camera by itself.

### S: the system picker on the Desk View window (owner at the Mac)

Run at 14:42:55 with `node docs/research/spikes/p3-tcc/run.mjs S`, with Desk View open on the built-in camera. The owner clicked Share and picked the Desk View window, and reported "Picker, no prompt". The page counted frames and read no pixels.

```
{"check":"media-access","camera":"granted","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"quit","mode":"picker"}
{"check":"picker","track":{"label":"","readyState":"live","width":1664,"height":1248,"frameRate":30,"displaySurface":"window"},"frames":30,"sizes":["1664x1248"],"first":{"coded":"1664x1248","visibleRect":[0,0,1664,1248]},"fps":29.6}
{"check":"S","verdict":"PASS","why":"30 frames from a window track; the owner confirms the Desk View window"}
```

- There's no `picker-handler` line: the display-media handler never ran, so the system picker answered the request.
- The window track's label is empty.
- The frames are 1664×1248, the 4:3 shape of the Desk View feed. Whether they hold a title-bar band wasn't checked, because no pixel of a real frame is read.

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
7. **Under LaunchServices, Electron reads camera, microphone and screen as `granted`** (C's and E's `media-access`), and the probe it spawns reads camera `3`. H then ran twice without a TCC prompt.
8. **Discovery can list an iPhone's Desk View camera first.** At 14:37, `DiscoverySession([.deskViewCamera])` returned the owner's iPhone (Continuity Camera) first. Task 3's rule (the requested device, else the first that isn't a Continuity Camera, else the first) would have picked the built-in camera. Both cameras gave 1920×1440.
9. **The Desk View app follows macOS's Continuity Camera setting, not Tassel.**
   - `present()` only launches the app or brings it to the front (D).
   - While Continuity Camera offered the iPhone, Desk View used the iPhone. After the iPhone was turned off, the running instance showed "no desk view camera connected" until it was relaunched.
   - So the helper's camera (built-in first) can differ from the camera the Desk View app shows. Task 12's setup copy shouldn't promise they match.
10. **S's caveat.** Electron holds Screen Recording on this Mac (`screen: granted`), so S, like T, can't show that capture works without the grant. The owner saw no Screen Recording prompt.
11. **A picked window's track has an empty label** (S), and its frames were 1664×1248 here. Task 10's window-capture source shouldn't rely on `track.label`.

## Task 3: the Desk View helper through the harness (HC, HH)

Task 3 added a `helper` mode to `main.cjs`, and two checks that use it. The mode spawns the Desk View helper (`--probe` names it) with a fresh token in its env alone. A hidden window on `app://tassel/` (a privileged scheme, as in the app) then connects to `ws://127.0.0.1:<port>`, so Chromium sends the helper's allowed `Origin` itself. The window sends `hello`, `list` and `start` (fps 15, maxWidth 1920, quality 0.85) and counts 30 frames from their headers, keeping only counts, sizes and timing. Then `main.cjs` closes the helper's stdin, as Electron dying would, and records how the helper exited. Both checks need `node scripts/native.mjs build` first.

| Check | Verdict | Evidence |
|---|---|---|
| **HC** | PASS | Unattended, from an agent-started Electron, with the helper playing this spike's synthetic 960×720 clip (`TASSEL_HELPER_CLIP`), so no camera is involved. 30 frames at 960×720 and 15 fps; `welcome` said camera `authorized`; the helper exited 0 6 ms after stdin EOF |
| **HH** | NOT RUN (pending the owner's GO) | Task 3's Step 6: the same flow under a LaunchServices launch, as H ran, with the helper on the real Desk View camera. Run it with the owner at the Mac: `node scripts/native.mjs build && node docs/research/spikes/p3-tcc/run.mjs HH`. Expected: 30 frames at 1920×1440, and an exit 0 within 1 s of stdin EOF (the camera released) |

### HC: the helper over a synthetic clip (unattended)

```
{"check":"write-mjpeg","path":"<repo>/docs/research/spikes/p3-tcc/.out/spike-clip.mjpeg","frames":60,"width":960,"height":720,"bytes":878220}
{"check":"media-access","camera":"not-determined","microphone":"granted","screen":"granted"}
{"check":"env","TASSEL_SPIKE":null}
{"check":"helper","clip":"spike-clip.mjpeg","protocol":1,"frames":30,"sizes":["960x720"],"statuses":["starting","running"],"camera":"authorized","helperVersion":"0.1.0","devices":[{"name":"Test clip","builtIn":true}],"fps":15}
{"check":"helper-exit","code":0,"signal":null,"ms":6,"log":["[deskview-helper] tag p3-spike","[deskview-helper] listening on 127.0.0.1:58240 with a test clip","[deskview-helper] clip: 60 frames, 960x720","[deskview-helper] stream started at 15 fps","[deskview-helper] stream stopped","[deskview-helper] client gone: POSIXErrorCode(rawValue: 57): Socket is not connected","[deskview-helper] send failed: POSIXErrorCode(rawValue: 89): Operation canceled","[deskview-helper] exiting: stdin closed"]}
{"check":"quit","mode":"helper"}
{"check":"HC","verdict":"PASS","why":"30 frames at 960x720, 15 fps, camera authorized, from \"Test clip\"; the helper exited 0 6 ms after stdin EOF"}
```

The page sends `stop` and closes at once, so the helper's `status stopped` reply meets a closed socket: that is the "send failed" line.

## Files

- `probe.swift`, `Info.plist`: the probe (`dev.tassel.p3-probe`). `--status` never asks for access. `--capture <n>` counts Desk View frames and keeps none. `--present-setup` presents the Desk View app. `--write-mjpeg` writes the synthetic test clip.
- `main.cjs`: the Electron main with the spike's modes, `helper` (Task 3) among them. It writes its pid, then one JSON line per result, to `--out`.
- `run.mjs`: builds the probe and runs the named checks: directly spawned (A, F, P, T, HC), or through LaunchServices (H, E, D, S, HH, and C without `-W`).
- `.out/` (git-ignored): the probe, the synthetic clip, and each check's `--out` file. `pnpm check` refuses to commit any `.jpg`, `.jpeg`, `.mjpeg`, `.y4m`, `.mjpg`, `.jfif`, `.jpe`, `.heic` or `.heif` (`scripts/check-no-frames.mjs`).
