# Desktop shell, camera & vision research

*Desktop/camera/vision sub-team, 2026-10-17. [Sn] = Sources. UNVERIFIED = no source confirmed it. "Source-read" = inferred from source code, not tested on a device.*

## Bottom line

- **Use Electron 44.x** (44.9.0 current; 45 due 2026-10-20): vibrancy or acrylic main window, plus a frameless `type: 'panel'` overlay bar at `screen-saver` level, shown over full-screen apps, click-through. [S1][S2][S5]
- **Desk View is not a webcam to Electron.** macOS offers native code a `.deskViewCamera` (macOS 13+, already flattened and rotated). Chromium never lists it, so `getUserMedia` can't open it (source-read). Hackathon: capture the Desk View window, as Apple advises. Later: a small Swift helper. [S26][S30][S31][S35]
- **Few Macs have Desk View built in:** M4-era MacBook Pro/Air/iMac and the 2026 Studio Display. Others need an iPhone 11+ (not SE or 16e) on a stand. [S31]
- **macOS screen capture re-asks monthly** (macOS 15; later versions UNVERIFIED) unless you use the system picker, which Electron's experimental `useSystemPicker` exposes. In dev, permissions go to your terminal or IDE. [S8][S9][S23][S24]
- **Cluely-style invisibility fails on macOS 15+:** ScreenCaptureKit ignores `NSWindowSharingNone` by design. It works on Windows. Use it only to keep our overlay out of our own captures. [S3][S13][S14]
- **Change detection needs no ML:** 5 fps, small grayscale, lighting-corrected diff against a stable reference in 16 px cells, about 1 s stillness gate. OpenCV.js (13.3 MB) only to find and flatten the paper. [S44][S45][S46]
- **Pointing:** Gemini (`box_2d`, 0–1000, y first) and Qwen3-VL (0–1000, x first) are trained for boxes. Claude gives approximate pixels. OpenAI warns about localization and Korean. Demo: freeze a frame and draw. [S48][S49][S50][S51]
- **Windows:** detect `win32`, warn, switch to screen share. Test paper view there with Chromium's fake-camera flags and a recorded clip. [S41][S42]

## Findings

### 1. Electron overlay windows

- **Version:** 44.0.0 (Chromium M152) stable 2026-08-25; npm `latest` 44.9.0; 45 (M156) due 2026-10-20. [S1][S2]
- **macOS:** `vibrancy` (e.g. `hud`, `popover`) with `visualEffectState: 'active'`. The default switches to the inactive look whenever the window isn't focused, which for an overlay is nearly always. [S5] One report of flat-grey vibrancy on macOS 26: test early. [S19]
- **Windows 11:** `backgroundMaterial: 'acrylic' | 'mica'` needs 22H2+ (build 22621). `transparent: true` needs a frameless window. Acrylic lags on resize for some users, and frameless acrylic has needed fixes before, so keep a semi-opaque fallback. [S3][S5][S17][S18]
- **Transparent windows** can't resize, lose the macOS shadow, go opaque with DevTools open, and CSS `blur()` can't blur what's behind. [S6]
- **Over full-screen apps (macOS):** Apple DTS's recipe, tested on macOS 26: accessory policy, non-activating panel, all-Spaces and full-screen-auxiliary behavior, screen-saver level. [S22] In Electron:
  - `type: 'panel'` [S5]
  - `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true})`, which briefly hides the window and Dock (no-op on Windows) [S4]
  - `setAlwaysOnTop(true, 'screen-saver')`; `floating` to `status` sit below the Dock [S4]
  - `app.setActivationPolicy('accessory')` while collapsed [S7]
- **Click-through:** `setIgnoreMouseEvents(true, {forward: true})`, turned off over buttons on `mouseenter` via IPC. [S4]
- **Content protection:**
  - Windows `WDA_EXCLUDEFROMCAPTURE` fully excludes the window on Windows 10 2004+. [S3]
  - macOS `NSWindowSharingNone` is ignored by "newer Mac applications that use ScreenCaptureKit", an intentional macOS change per maintainers. [S3][S13]
  - Electron's own `desktopCapturer` skips the app's own protected windows, if they were protected before the stream started. [S14]
  - Cluely advertises "Invisible to screen share". A look-alike says it uses the same API and OBS/QuickTime still see it (UNVERIFIED for Cluely). [S39][S40]
- **Pitfalls:**
  - A transparent click-through overlay got the window beneath throttled as "hidden". Fixed in 44.0.0; still set `backgroundThrottling: false` on the capture window. [S15][S11]
  - The macOS 26 lag bug is fixed in 36.9.2, 37.6.0, 38.2.0 and later. [S16]

### 2. macOS Desk View

- **Apple's API:**
  - `.deskViewCamera` is "a distortion-corrected cut out from an ultra wide camera that approximates an overhead view". [S26]
  - Frames are perspective-corrected, then rotated. The iPhone format is 1920×1440 at up to 30 fps. [S30]
  - `AVCaptureDeskViewApplication` opens the Desk View app. [S28]
  - `showSystemUserInterface` gives no feed. [S29]
- **Requirements:** iPhone 11+ except SE and 16e (iOS 16+, macOS 13+), or built in on MacBook Pro 2024+, MacBook Air 2025+, iMac 2024+, Studio Display (2026)/XDR. [S28][S31] No stated minimum macOS for built-in (UNVERIFIED). Current macOS: 27 (2026-09-14). [S34]
- **Chromium:** camera discovery asks only for built-in, external and Continuity cameras. `DeskViewCamera` appears nowhere (source-read). [S35][S36] Native apps can open it: OBS 29+ and PRISM list "Desk View Camera". [S37][S38]
- **Options, best first:**
  1. **Window capture.** Apple tells third-party apps to share the Desk View window. [S31] Use `getDisplayMedia` with `setDisplayMediaRequestHandler(..., {useSystemPicker: true})`; the student picks the window. [S8] No native code and no monthly alert. Costs: an extra click, a title bar to crop, resolution tied to window size, an experimental option. Fallback: preselect "Desk View" from `desktopCapturer.getSources({types: ['window']})`; needs Screen Recording, and the title may be translated (UNVERIFIED). [S9]
  2. **Swift helper:** `DiscoverySession([.deskViewCamera])`, then `AVCaptureVideoDataOutput`, then JPEG at 10–15 fps over localhost. Real camera frames, camera permission only; must be signed to ship.
  3. **Node addon:** the same, but a crash takes the app down.
  4. **Virtual camera:** would rebuild Desk View, which the spec forbids.
- **Opening Desk View:** the menu bar's Video → Desk View appears only while an app uses the camera. The helper can call `AVCaptureDeskViewApplication` instead. [S28][S32]
- **Camera permission:**
  - Packaged: `NSCameraUsageDescription` (via `extendInfo`), plus `com.apple.security.device.camera` under the hardened runtime. [S10][S33]
  - Call `askForMediaAccess('camera')`; changes in System Settings need a restart. [S10]
  - In dev, macOS gives the permission to the terminal or IDE that launched Electron. Re-sign Electron.app after editing its Info.plist, or prompts fail silently. [S9][S20][S21]

### 3. Windows fallback

- **Detect:** `process.platform === 'win32'`. Enable acrylic only if `process.getSystemVersion()` ≥ 10.0.22621. Show the translated "Desk View isn't available on Windows, share your screen" message, then start screen share. [S3]
- **Screen share:** no screen permission (`getMediaAccessStatus('screen')` is always `granted`). System-audio `loopback` is Windows-only. Content protection keeps our bar out of our capture. [S3][S8][S10]
- **Paper view:** doesn't exist on Windows, since screen share shows a screen. To develop it there, play a recorded clip as a camera with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=deskview.mjpeg` (Y4M or MJPEG) via `app.commandLine.appendSwitch`. [S12][S41][S42]

### 4. Screen sharing inside Electron

- **Plumbing:** `session.setDisplayMediaRequestHandler` answers `getDisplayMedia()` with a `desktopCapturer` source. `useSystemPicker` skips the handler. [S8][S9]
- **macOS permission:**
  - No Electron API requests Screen Recording; the first capture prompts. Check with `getMediaAccessStatus('screen')`. [S10]
  - Since macOS 15, direct ScreenCaptureKit use brings monthly "bypass the system private window picker" alerts. [S24]
  - Apple DTS: avoid them with `SCContentSharingPicker`, or an entitlement meant for remote-desktop apps. [S23][S25]
  - macOS 26/27 behavior: UNVERIFIED.
- **Sampling:** `frameRate` 2–5, at most 1920 px wide. Send only on stable change (§5), plus one frame every 30–60 s.
- **Tokens per 1920×1080 frame:** Claude standard tier 1,560; Claude 4.7+ incl. Opus 5.5, 2,691 (about $0.011 at $4/M) [S47]; Gemini 1,548 [S49]; OpenAI gpt-6-astra about 2,450 [S51]. One frame per 5 s for 30 min on Opus 5.5 is about $3.90; change-only (about 100 frames) about $1.

### 5. Handwriting change detection

- **Where:** a Web Worker with typed-array loops. 640×480 at 5 fps is light work (estimate).
- **Frames:** from `MediaStreamTrackProcessor` (Chrome 94+), shrunk with `createImageBitmap`. Close each `VideoFrame`. [S43]
- **Model to copy:** Microsoft Research's whiteboard capture uses character-sized 16×16 cells, about 0.5 s stability (4 frames at 7.5 Hz), and resets when more than 90% of cells change. [S44]

Starting values (tune on the demo pen, paper and lamp; render a debug heatmap):

| Stage | Start with |
|---|---|
| Rate | every 6th frame (5 fps) |
| Motion | 160×120 gray, 3×3 blur. A pixel moves at Δ > 15/255; the frame is busy if > 0.5% move |
| Stable | 5 quiet samples (about 1 s; hands hover) |
| Compare | paper flattened to about 600×800 gray (else central 80% at 640×480) |
| Lighting | divide by a 31 px box blur |
| Ink | reference − current > 0.10 (10% darker than nearby paper); erasure the reverse |
| Cell | 16×16 px, changed at ≥ 6 ink pixels |
| Trigger | ≥ 2 changed cells, then 1.5–3 s with no new ink. At most one call per 5 s |
| Big change | > 40% of cells: re-find paper, reset, send the full page |
| Reference | replace after each trigger; refresh after 30 s quiet |

- **OpenCV.js 5.0.0:** one 13.3 MB file. The default build has `findContours`, `warpPerspective`, `createCLAHE`, ORB, `findHomography` and ArUco. Load it once in the worker for geometry only; WebGL isn't needed. [S45][S46]
- **Before the LLM:**
  - Warp the largest bright four-sided shape to page proportions.
  - Divide by a blurred background; CLAHE (clip 2.0, 8×8) is optional.
  - Keep color and gray tones; binarizing breaks pencil and Hangul strokes (our judgment).
  - Pre-resize to the model's limit so coordinates map one-to-one (Claude standard tier: A4 at 924×1307).
  - Add a tight crop of the changed cells. JPEG quality about 0.85–0.9. [S47][S48]

### 6. Drawing annotations on the live feed

- **Coordinates by model:**
  - Gemini: `box_2d` `[ymin, xmin, ymax, xmax]` on 0–1000, plus masks. [S49]
  - Qwen3-VL: `bbox_2d` `[x1, y1, x2, y2]` on 0–1000; open weights. [S50]
  - Claude: absolute pixels on the image it saw. Ask for pixels, not 0–1000; results are "approximate". [S48]
  - OpenAI: its guide says the model "struggles with tasks requiring precise spatial localization" and may be weaker on Korean. [S51]
  - No benchmark on hand-drawn automata found (UNVERIFIED). Test on the demo sheet on day 1.
- **Reliability:** Set-of-Mark prompting. Number candidate regions (ink blobs or OCR words; Azure Read handles handwritten Korean and Spanish) and ask for a number. [S52][S53]
- **Mapping:** model coordinates → sent-image pixels → inverse paper homography → video pixels → CSS. For `object-fit: contain`, `s = min(elW/vw, elH/vh)` and `x_css = (elW − s·vw)/2 + s·x` (same for y). Scale the canvas by `devicePixelRatio`.
- **Keeping marks on the paper:**
  - Store marks in paper coordinates (0–1). Re-find the paper each tick and redraw; hide marks while the frame is busy.
  - If the outline is lost, re-align with ORB and `findHomography` (RANSAC). ArUco markers on a clipboard make this reliable.
  - Simplest demo: draw on a frozen frame.

## Spec claims that don't check out

- **"Student uses MacBook Desk View":** built in only on M4-era MacBooks and iMacs; other Macs need an iPhone on a stand. In Electron it isn't a camera: it must be window-captured or read natively. [S31][S35]
- **"Overlay like … Cluely":** translucency is fine. Invisibility in screen shares fails against ScreenCaptureKit on macOS 15+. [S13]
- **"astra under the hood":** `00-flagged-items.md` covers it (GPT-6 Luna). Given OpenAI's Korean and localization warnings, use the decision gate for "interrupt now?", not to read the work. [S51]

## Recommendation for a fast build (1–2 days)

1. **Shell (half a day):** Electron 44.x; vibrancy or acrylic main window with an opaque fallback; the overlay bar (panel, frameless, transparent, over full-screen apps, click-through, content-protected); platform check with the Windows warning in English, Spanish and Korean.
2. **`PaperSource` interface** returning a `MediaStream`: Desk View window capture (macOS), fake-file camera (dev), screen share (Windows and the screen-share view).
3. **Detector (half a day):** the §5 worker, feeding the upload → decision gate → Opus check path in `01-voice-loop-and-models.md`.
4. **Annotation (half a day):** Opus returns the mistake and a pixel box, drawn on a frozen frame. Add live tracking if there's time; try Gemini or Qwen if boxes miss.
5. **Demo hardening:** rehearse on the exact hardware; grant permissions the day before; black felt-tip pen, matte paper, even light; a recorded fallback clip.
6. **Defer:** the Swift helper, signing and notarization, Cluely-style hiding, Windows polish.

## Open questions for the product owner

1. Demo hardware: an M4-era Mac with built-in Desk View, or an iPhone? macOS 26 or 27?
2. Can the student pick the Desk View window in a picker, or must Tassel capture it without asking (needs the Swift helper)?
3. Should the overlay hide from others' screen recordings? Not guaranteed on macOS, and a tutor hiding from teachers may be unwelcome.
4. On Windows, is paper view out of scope, or does a downward webcam count?
5. Can we add Gemini, or self-host Qwen3-VL (e.g. on Vultr), for pointing?
6. What consent and retention wording (English, Spanish, Korean) covers sending camera frames to model providers?
7. What vision budget per session? It sets frame cadence and model tier.

## Sources

- [S1] Electron release schedule: https://releases.electronjs.org/schedule
- [S2] electron on npm (44.9.0): https://www.npmjs.com/package/electron
- [S3] Electron BrowserWindow (setContentProtection, setBackgroundMaterial): https://www.electronjs.org/docs/latest/api/browser-window
- [S4] Electron BaseWindow (setAlwaysOnTop, setVisibleOnAllWorkspaces, setIgnoreMouseEvents): https://www.electronjs.org/docs/latest/api/base-window
- [S5] Electron window options (type, transparent, vibrancy, visualEffectState, focusable): https://www.electronjs.org/docs/latest/api/structures/base-window-options
- [S6] Electron transparent-window limitations: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- [S7] Electron app.setActivationPolicy: https://www.electronjs.org/docs/latest/api/app
- [S8] Electron session.setDisplayMediaRequestHandler / useSystemPicker: https://www.electronjs.org/docs/latest/api/session
- [S9] Electron desktopCapturer (caveats, responsible process): https://www.electronjs.org/docs/latest/api/desktop-capturer
- [S10] Electron systemPreferences media access: https://www.electronjs.org/docs/latest/api/system-preferences
- [S11] Electron webPreferences backgroundThrottling: https://www.electronjs.org/docs/latest/api/structures/web-preferences
- [S12] Electron command-line switches: https://www.electronjs.org/docs/latest/api/command-line-switches
- [S13] electron#48258, ScreenCaptureKit ignores content protection: https://github.com/electron/electron/issues/48258
- [S14] electron#34362, own protected windows excluded from desktopCapturer; patch still listed: https://github.com/electron/electron/pull/34362 and https://github.com/electron/electron/blob/main/patches/chromium/.patches
- [S15] Electron PR 52365, transparent overlays as occluders: https://releases.electronjs.org/pr/52365
- [S16] AppleInsider, Electron macOS 26 lag fix: https://appleinsider.com/articles/25/10/10/update-your-slack-discord-clients-the-electron-tahoe-gpu-slowdown-bug-is-fixed
- [S17] electron#39708, frameless mica/acrylic: https://github.com/electron/electron/pull/39708
- [S18] Inkdrop forum, acrylic resize lag: https://forum.inkdrop.app/t/lag-when-resizing-the-window-with-acrylic-background/4011
- [S19] Obsidian forum, no vibrancy on macOS 26: https://forum.obsidian.md/t/translucent-window-shows-no-vibrancy-blur-on-macos-26-works-in-other-apps-fails-in-themes-default/115493
- [S20] Electron default Info.plist: https://github.com/electron/electron/blob/main/shell/browser/resources/mac/Info.plist
- [S21] t3code#728, unsigned plist patch breaks TCC prompts: https://github.com/pingdotgg/t3code/issues/728
- [S22] Apple DTS, overlay above full-screen Spaces: https://developer.apple.com/forums/thread/826308
- [S23] Apple DTS, avoiding the private-window-picker alert: https://developer.apple.com/forums/thread/765103
- [S24] 9to5Mac, Sequoia monthly screen-recording prompt: https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/
- [S25] Apple SCContentSharingPicker: https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker
- [S26] Apple deskViewCamera: https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicetype-swift.struct/deskviewcamera
- [S28] Apple AVCaptureDeskViewApplication: https://developer.apple.com/documentation/avfoundation/avcapturedeskviewapplication
- [S29] Apple AVCaptureDevice.SystemUserInterface: https://developer.apple.com/documentation/avfoundation/avcapturedevice/systemuserinterface
- [S30] WWDC22 "Bring Continuity Camera to your macOS app": https://developer.apple.com/videos/play/wwdc2022/10018/
- [S31] Apple Support, Desk View requirements: https://support.apple.com/en-ng/121541
- [S32] Mac User Guide, Use Desk View: https://support.apple.com/guide/mac-help/mchl06927be8/mac
- [S33] Apple camera entitlement: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.camera
- [S34] 9to5Mac, macOS 27 release date: https://9to5mac.com/2026/09/09/apple-confirms-macos-27-golden-gate-launch-date-september-14/
- [S35] Chromium video_capture_device_avfoundation_helpers.mm: https://github.com/chromium/chromium/blob/main/media/base/mac/video_capture_device_avfoundation_helpers.mm
- [S36] Chromium video_capture_device_factory_apple.mm: https://github.com/chromium/chromium/blob/main/media/capture/video/apple/video_capture_device_factory_apple.mm
- [S37] MacG, OBS 29 Desk View support: https://www.macg.co/logiciels/2023/01/obs-studio-encore-choye-par-apple-gestion-du-mode-desk-view-ainsi-que-du-hevc-et-du-prores-133943
- [S38] PRISM Live, Desk View Camera source: https://guide.prismlive.com/desktop/guides/features/camera/using-desk-view-on-mac
- [S39] Cluely site: https://cluely.com
- [S40] Cue README (open-source Cluely-like overlay): https://github.com/abbinavv/cue
- [S41] WebRTC testing flags: https://webrtc.github.io/webrtc-org/testing/
- [S42] Chromium file_video_capture_device.cc (Y4M/MJPEG): https://github.com/chromium/chromium/blob/main/media/capture/video/file_video_capture_device.cc
- [S43] Chrome, MediaStreamTrackProcessor: https://developer.chrome.com/docs/capabilities/web-apis/mediastreamtrack-insertable-media-processing
- [S44] Microsoft Research TR-2004-91, real-time whiteboard capture: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2004-91.pdf
- [S45] OpenCV.js build whitelist: https://github.com/opencv/opencv/blob/4.x/platforms/js/opencv_js.config.py
- [S46] @techstark/opencv-js 5.0.0 opencv.js (13,298,869 bytes): https://cdn.jsdelivr.net/npm/@techstark/opencv-js@5.0.0-release.1/dist/opencv.js
- [S47] Claude vision (tokens, tiers, pricing example): https://platform.claude.com/docs/en/build-with-claude/vision
- [S48] Claude coordinates and bounding boxes: https://platform.claude.com/docs/en/build-with-claude/vision-coordinates
- [S49] Gemini image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- [S50] Qwen3-VL 2D grounding cookbook: https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/2d_grounding.ipynb
- [S51] OpenAI images and vision guide: https://developers.openai.com/api/docs/guides/images-vision
- [S52] Set-of-Mark prompting: https://arxiv.org/abs/2310.11441
- [S53] Azure Vision language support (handwritten OCR): https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/language-support
