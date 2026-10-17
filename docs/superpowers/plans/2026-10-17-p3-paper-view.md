# P3 Paper View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her paper, live on the session stage and watched for stable handwriting changes, working on fakes and on the real Desk View camera:
- a Swift Desk View helper, plus three more paper sources, behind one `PaperSource` interface;
- a deterministic synthetic clip of the demo DFA being drawn;
- a change-detector worker with a debug heatmap;
- frame upload into S3-compatible storage (Versity Gateway locally, Vultr Object Storage in P10).

**Architecture:**
- **Capture.** Every source ends as one `MediaStream` in the renderer.
  - The helper sends JPEG frames over a token-guarded localhost WebSocket, and the renderer paints them into a canvas stream.
  - Window capture uses `getDisplayMedia` with the macOS system picker.
  - The synthetic clip plays through Chromium's fake-camera switches.
  - The screen source uses `getDisplayMedia`.
- **Detection.** A worker samples at 5 fps and gates on motion at 160×120. It then compares a flattened, lighting-normalized page in 16 px cells against a stable reference, which is never taken while a hand covers the page. A trigger carries a full-resolution JPEG, a crop and a cell mask. OpenCV.js finds the page.
- **Storage.** `POST /v1/sessions/{id}/frames` writes the JPEGs through an `ObjectStore` (S3 via boto3, or in memory for unit tests) and adds a `frames` row. Deleting a session deletes its frames.
- **Proof.**
  - E2E drives the real app on the synthetic clip, on macOS and on CI's ubuntu runner, and on the helper streaming that clip (macOS).
  - The real camera runs only in one opt-in spec, launched through LaunchServices with the owner at the Mac, and it takes no screenshots.
  - Windows parity is shown by the unit tests and the clip's golden hash on `windows-latest`. A Windows E2E run is an owner item for when a Windows PC is available.

**Tech Stack:**
- **Desktop:** P1's stack, unchanged. Electron is exactly 44.9.0, which ships Chromium 152.0.7977.167 and Node 24.22.0 ([release](https://releases.electronjs.org/release/v44.9.0)). Also React 19, Zustand 5, Vitest, and Playwright 1.64.1 `_electron` ([npm](https://www.npmjs.com/package/playwright)). New:
  - `@techstark/opencv-js` 5.0.0-release.1, Apache-2.0, published 2026-06-24, 13.3 MB, with the WebAssembly embedded ([npm](https://www.npmjs.com/package/@techstark/opencv-js));
  - WebCodecs `VideoFrame`, `MediaStreamTrackProcessor` (Window only in Chromium 152), `OffscreenCanvas.convertToBlob` and canvas `captureStream()`; the links are in Tasks 8 and 10.
- **Synthetic clip:** a pure TypeScript rasterizer plus `jpeg-js` 0.4.4, BSD-3-Clause, published 2022-06-07 ([npm](https://www.npmjs.com/package/jpeg-js)), so the bytes are identical on every OS. Both packages are older than pnpm's minimum release age, so they need no exclusion.
- **Native:** Swift 6.3.3 with Command Line Tools only, SwiftPM tools-version 6.0, Swift Testing. AVFoundation (`.deskViewCamera`, `AVCaptureDeskViewApplication`), Network.framework (`NWListener` + `NWProtocolWebSocket`) and Core Image; the links are in Task 3.
- **Server:** FastAPI 0.143.3 ([PyPI](https://pypi.org/project/fastapi/)) with python-multipart 0.0.32 ([PyPI](https://pypi.org/project/python-multipart/)); boto3 1.43.114 ([PyPI](https://pypi.org/project/boto3/)); Pillow ≥ 12 for test JPEGs only (13.0.0 is current, [PyPI](https://pypi.org/project/pillow/)).
- **Local S3:** Versity Gateway `versity/versitygw:v1.8.0`, Apache-2.0, amd64 and arm64 ([Docker Hub](https://hub.docker.com/r/versity/versitygw), [releases](https://github.com/versity/versitygw/releases)).

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md`, mainly §2 goal 2, §4.1 (paper sources, change detector), §4.3, §5.2 step 1, §6 (session states, privacy defaults) and §7. Read it with:
- `docs/research/02-desktop-camera-vision.md` §2–§6, the source of the detector values;
- `docs/research/spikes/README.md`, the permission rules;
- the roadmap (`docs/superpowers/plans/2026-10-17-tassel-roadmap.md`) and the P1 plan, whose conventions this plan follows;
- P1's built session screen on `claude/p1-ui` (888dac3 and later), which Tasks 12–13 plug into.

**Starts from:** `claude/p1-foundation` after P1 Task 15 has merged. Work on branch `claude/p3-paper-view`, with the SDD workspace `.superpowers/sdd/2026-10-17-p3-paper-view/`. P2 runs at the same time; see "Merging with P2".

## Global Constraints

Every task's requirements include this section.

### Carried from P1
- Node ≥ 22.18, pnpm 12, Python 3.12. Every script runs on macOS **and Windows**: Node scripts use `cross-spawn`, and nothing is bash-only.
- Electron stays at **exactly `44.9.0`**. macOS ties the owner's camera, microphone and screen grants to that ad-hoc-signed binary.
- Renderers keep `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. `window.tassel` is the only IPC surface, and every IPC handler refuses senders outside the renderer's origin (`isTrustedUrl`).
- No provider key ever reaches the desktop app.
- Every desktop dependency is a bundled devDependency, as in P1.
- Every UI string goes through i18next keys present in `en`, `es` and `ko`, and `pnpm check:i18n` passes. Korean uses polite 해요체, and new keys are camelCase, as P1's are.
- Design tokens only. Mock colors become `--color-*` tokens in `packages/shared/src/styles/tokens.css`, as P1's `--color-board-dot` did. Iris (`#c094e4`, `#7d4fc4`) is for Ada alone, never paper chrome. The live red `#e5484d` is for the capture dot alone. No drop shadows (hairline `0 0 0 1px` only). Functional text is never below 11px.
- P1's `launchApp` drops the runner's `TASSEL_*` variables, and every spec states its own (`inheritedEnv()` in `tests/e2e/fixtures.ts`).
- Commits go on `claude/p3-paper-view` and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Privacy and permissions
- **No agent-run test or tool ever opens the real camera or captures a real frame.** Three layers enforce it:
  - **`launchApp`** pins `TASSEL_PAPER_SOURCE=fake-clip` for every spec (P1's and P2's included) unless the spec overrides it.
  - **A capture guard** refuses any launch whose source could reach a real device (Task 13).
  - **`TASSEL_REQUIRE_FAKE_CAPTURE=1`**, which `launchApp` always sets, makes the app itself refuse real capture (Task 9).

  `scripts/dev.mjs` defaults to the fake clip too (Task 14). The one sanctioned real-camera run is Task 14's opt-in spec, launched through LaunchServices with the owner at the Mac.
- **A frame from the real camera stays on this machine.** It is never committed, never posted, and never in a screenshot. From Task 1 on, `pnpm check` fails on any tracked `.jpg`, `.jpeg`, `.mjpeg` or `.y4m` file.
- Only screenshots of the synthetic clip may go to Discord; `main` posts them.
- Frames are stored with their session until she deletes it (spec §6). Deleting a session deletes its objects first, then its rows.
- **Uploads of real frames to non-local storage wait for P9's consent copy** (R8). P10 may land first, but must not point a student build at Vultr before then.
- **The title strip's dot tells the truth (P1 ruling R29).** It is red, with "· Live", only while a paper source is delivering frames. A source that stops delivering frames for 3 s is treated as lost (Task 12).
- **Screen frames never upload on their own** (spec §4.1: they "leave the device only when she asks"). The detector and heatmap run for the `screen` source, but its triggers are never uploaded. P7 adds on-request screen frames.
- **macOS grants follow the responsible process.** An Electron that Playwright, `pnpm dev` or an agent's shell starts inherits that shell's grants. Camera checks launch Electron through LaunchServices (`open -n -W -a …`) or use the synthetic clip.
- Agents never answer TCC prompts and never change Privacy & Security settings. Steps that need either are marked **owner at the Mac**.

### Native
- Swift 6.3.3 with Command Line Tools only (`xcode-select -p` is `/Library/Developer/CommandLineTools`). Build with SwiftPM (`swift build`, `swift test`) or `swiftc`; never `xcodebuild`.
- `node scripts/native.mjs build|test|path` wraps SwiftPM. On any other OS it prints `native: skipped (Desk View is macOS-only)` and exits 0.
- **Tests under Command Line Tools.** `swift test` fails with "no such module 'Testing'" ([Swift Forums 74784](https://forums.swift.org/t/error-no-such-module-testing/74784)), and XCTest isn't available at all. Verified on this Mac on 2026-10-17: it passes with these flags, where `<CLT>` is `/Library/Developer/CommandLineTools` (`lib_TestingInterop.dylib` lives in the last path):

  `-Xswiftc -F -Xswiftc <CLT>/Library/Developer/Frameworks -Xlinker -F -Xlinker <CLT>/Library/Developer/Frameworks -Xlinker -rpath -Xlinker <CLT>/Library/Developer/Frameworks -Xlinker -rpath -Xlinker <CLT>/Library/Developer/usr/lib`
- **Platform:** `.macOS(.v14)`, because the CLT `Testing.framework` is built for macOS 14.
- **The helper's `Info.plist`** is embedded with `-sectcreate __TEXT __info_plist` through SwiftPM `unsafeFlags` ([doc](https://developer.apple.com/documentation/packagedescription/linkersetting/unsafeflags(_:_:))); Apple's advice for CLI tools is in [forum 111100](https://developer.apple.com/forums/thread/111100).
  - The target excludes `Info.plist` from its sources.
  - The linker's ad-hoc signature leaves that plist unbound, so every build of the helper or the probe is re-signed with `codesign --force --sign -` to bind it.
- `.gitignore` holds `native/deskview-helper/.build/` and `native/deskview-helper/.swiftpm/`.
- The helper exists only on macOS. Windows has no Desk View (spec §2 non-goals).

### Detector values
These are research 02 §5's starting values, plus six rules this plan adds for occluders and page changes (`occluderLevel`, `occluderSmoothness`, `occlusionMinCells`, `staleSamples`, `pageClearFraction`, `pageMoveFraction`). Change them only in `DEFAULT_PARAMS` (Task 7), and only after tuning with the heatmap.

| Name | Value | Meaning |
|---|---|---|
| `sampleIntervalMs` | 200 | 5 fps, by frame timestamp |
| `motionWidth` × `motionHeight` | 160 × 120 | Gray, after a 3×3 box blur |
| `motionDelta` | 15 | A pixel moves when it changes by more than 15/255 |
| `busyFraction` | 0.005 | The frame is busy when more than 0.5% of pixels move |
| `stableSamples` | 5 | Quiet samples (about 1 s) before comparing |
| `compareLongSide` | 800 | Flattened page: long side 800 px, short side floored to a multiple of 16. The size is fixed when a reference is taken, and changes only at a page event |
| `fallbackCrop` | 0.8 | No page found: the central 80% of the frame, at 640×480 |
| `lightingBlur` | 31 | Normalize: gray divided by its 31 px box blur |
| `inkDelta` | 0.10 | Ink when reference − current > 0.10; erasure when current − reference > 0.10 |
| `cellSize` | 16 | Cell edge in compare pixels |
| `cellMinPixels` | 6 | A cell changes at ≥ 6 ink or erasure pixels |
| `triggerMinCells` | 2 | Changed cells needed to trigger |
| `quietInkMs` | 2000 | Time with no new ink before a trigger; tunable from 1500 to 3000 |
| `minTriggerIntervalMs` | 5000 | At most one trigger every 5 s. A page event inside the interval is held and sent when it ends |
| `bigChangeFraction` | 0.40 | More than 40% of cells changed: a new page. Re-find the page, reset, send the full page |
| `pageClearFraction` | 0.80 | 80% of the ink she added on this sheet (the union of its ink triggers' masks, at least `triggerMinCells` cells) erased at once, with no new ink: a fresh sheet, handled as a page event. Printed ink in the first reference doesn't count |
| `pageMoveFraction` | 0.02 | A page-quad corner moved more than 2% of the frame diagonal: the page moved; a page event |
| `referenceRefreshMs` | 30000 | Replace the reference after 30 s with fewer than `triggerMinCells` changed |
| `occluderLevel` | 0.80 | A cell is dark when its raw (unnormalized) mean is below 0.80 × the page's 90th-percentile cell mean… |
| `occluderSmoothness` | 0.08 | …and its raw standard deviation is below 0.08 × that level. A hand, sleeve or shadow is smooth; a cell of dense ink is not |
| `occlusionMinCells` | 4 | A 4-connected cluster of that many dark cells means occluded. The sample counts as busy, and no reference is taken or replaced |
| `solidCellFraction` | 0.5 | A cell more than 50% changed is solid |
| `staleSamples` | 5 | Solid cells on a page with no dark cells, for 5 stable samples in a row: the reference held an occluder, so replace it without emitting |

`DETECTOR_VERSION = 'p3.1'` (in Task 1's contracts) goes with every upload.

### Coordinates
P4 and P5 depend on these conventions.
- **`Quad`:** TL, TR, BR, BL, in pixels of the uploaded full JPEG. That is the native frame inside the feed's `contentRect`, so a window capture's title bar is already cut away.
- **Page coordinates:** 0–1 from the flattened page's top-left. `crop_rect` uses them.
- **`CellMask.cells`:** `[col, row]` pairs on the flattened page's grid, sorted by row, then by column.

### Helper protocol v1
Task 2 owns the protocol, and Task 10 mirrors it in TypeScript.
- **Process.**
  - Electron passes a per-launch token in the env as `TASSEL_HELPER_TOKEN` (64 hex characters; never on argv). `TASSEL_HELPER_CLIP` optionally names an MJPEG file to stream instead of the camera.
  - With `TASSEL_HELPER_TAG` set, the supervisor adds `--tag <value>` to argv. The tag isn't a secret; it lets a test find exactly its own helper with `pgrep -f`.
  - The first stdout line is `{"event":"ready","port":<port>,"protocol":1}`. Logs go to stderr with the prefix `[deskview-helper]`.
  - The helper listens on 127.0.0.1 only, and clients connect to `ws://127.0.0.1:<port>`, never `localhost`, which can resolve to `::1`.
  - It exits 0 within 1 s of stdin EOF (Electron died) or SIGTERM, and exits 64 when the token is missing or malformed.
- **Handshake.**
  - The WebSocket upgrade is refused unless its `Origin` header is `app://tassel` or `http://localhost:5173` (the dev renderer). Network.framework's client request handler sees `Origin` but not the path ([setClientRequestHandler](https://developer.apple.com/documentation/network/nwprotocolwebsocket/options/setclientrequesthandler(_:handler:))). This is defense in depth; the token is the real guard.
  - The client's first text message must be `{"type":"hello","token":"<token>","protocol":1}`, within 2000 ms. Otherwise the helper closes with code 4401.
  - A second client gets `{"type":"error","code":"busy"}` and close 4409.
  - Incoming messages are capped at 64 KiB (`maximumMessageSize`).
- **Client → helper** (text JSON with a `type` field):
  - `hello`;
  - `list`;
  - `start` with `{deviceId: string|null, fps: 15, maxWidth: 1920, quality: 0.85}`; the helper clamps fps to 1–30, maxWidth to 320–1920 and quality to 0.5–0.95;
  - `stop`;
  - `openSetup`.
- **Helper → client** (text JSON):
  - `welcome {protocol: 1, helperVersion, camera: "authorized"|"denied"|"restricted"|"notDetermined"}`;
  - `devices {devices: [{id, name, builtIn}]}`;
  - `status {state: "starting"|"running"|"stopped", width, height, fps}`;
  - `error {code, message}`, where code is one of `auth`, `permission-denied`, `no-device`, `device-lost`, `busy`, `bad-request`, `internal`;
  - `setup {result: "presented"|"failed", message?}`.
- **Frames** (binary messages, helper → client): a 24-byte big-endian header, then one JPEG (`FF D8 … FF D9`).

  | Bytes | Field |
  |---|---|
  | 0–3 | magic `TSLF` (`54 53 4C 46`) |
  | 4–5 | version, u16 = 1 |
  | 6–7 | flags, u16 = 1 |
  | 8–11 | seq, u32 |
  | 12–19 | ptsMicros, u64 |
  | 20–21 | width, u16 |
  | 22–23 | height, u16 |

  The contract fixture both languages test: seq 7, pts 1,234,567 µs, 4×3, then the 4-byte stand-in JPEG `FFD8FFD9`, is exactly
  `54534C46 0001 0001 00000007 000000000012D687 0004 0003 FFD8FFD9`.

### Storage
- **The `ObjectStore` interface** (`put`, `get`, `delete_prefix`) has two implementations: `S3ObjectStore` (boto3) and `MemoryObjectStore`. `TASSEL_OBJECT_STORE` is `s3` (the default) or `memory`.
- **Keys** are `learners/{learner_id}/sessions/{session_id}/frames/{frame_id}/full.jpg` and `…/crop.jpg`, so a session or a whole learner can be deleted by prefix.
- **Buckets** are private: `tassel-frames` in dev and `tassel-e2e` in E2E (`TASSEL_E2E_S3_BUCKET` overrides it, so the QA and design checkouts use their own). Server tests use one bucket per test run, `tassel-test-<8 hex>`, and delete it afterwards.
- **Local S3** is the compose service `s3`: `versity/versitygw:v1.8.0` on `127.0.0.1:7070`, region `us-east-1`. The dev credentials are `tassel` / `tassel-dev-only`; like the dev database password, they are not secrets.
- **The boto3 client config** is `Config(signature_version="s3v4", s3={"addressing_style": "path"}, request_checksum_calculation="when_required", response_checksum_validation="when_required", connect_timeout=2, read_timeout=10, retries={"max_attempts": 3, "mode": "standard"})`. The option names are in [botocore config.py](https://github.com/boto/botocore/blob/develop/botocore/config.py).
  - `when_required` keeps `put_object` free of the CRC32 trailers that boto3 ≥ 1.36 adds by default ([boto3#4392](https://github.com/boto/boto3/issues/4392)), which some S3-compatible stores reject.
  - `delete_objects` sends CRC32 regardless ([httpchecksum.py](https://github.com/boto/botocore/blob/develop/botocore/httpchecksum.py)). Versity accepts it. P10 must check Vultr, and fall back to per-key `delete_object` if Vultr refuses it.
- **Limits:** a full frame ≤ 8 MiB, a crop ≤ 2 MiB, and at most one upload per session per second (HTTP 429). CORS exposes `Retry-After` to the app.
- **Images are served through the API** (`GET …/frames/{id}/image`), not through signed URLs (R13).

### New environment variables
**What a packaged app reads:** it ignores P3's fakes and dev switches (`TASSEL_FAKE_CLIP`, `TASSEL_HELPER_CLIP`, `TASSEL_DESKVIEW_HELPER`, `TASSEL_FAKE_DISPLAY`, `TASSEL_FAKE_CAMERA_ACCESS`, `TASSEL_PAPER_DEBUG`, `TASSEL_PAPER_PARAMS`, `TASSEL_REQUIRE_FAKE_CAPTURE`, `TASSEL_HELPER_TAG`). It honors `TASSEL_PAPER_SOURCE` only as `auto`, `deskview-helper` or `window-capture`. P1's and P2's `TASSEL_FAKE_*` variables follow their own plans.

| Variable | Read by | Values |
|---|---|---|
| `TASSEL_PAPER_SOURCE` | main | `auto` (default), `deskview-helper`, `window-capture`, `fake-clip`, `screen` |
| `TASSEL_FAKE_CLIP` | main | Absolute path of an MJPEG file. With `fake-clip`, it is passed to Chromium's fake camera |
| `TASSEL_HELPER_CLIP` | main → helper | MJPEG path; the helper streams it instead of the camera (no TCC needed) |
| `TASSEL_DESKVIEW_HELPER` | main | Path of the helper binary (defaults in Task 9) |
| `TASSEL_HELPER_TAG` | main → helper argv | A label for `pgrep -f` (Tasks 13–14) |
| `TASSEL_FAKE_DISPLAY` | main | `self`: `getDisplayMedia` captures the requesting frame; no OS permission, used by E2E |
| `TASSEL_FAKE_CAMERA_ACCESS` | main | `granted`, `denied` or `not-determined`, in place of `systemPreferences` |
| `TASSEL_REQUIRE_FAKE_CAPTURE` | main | `1`: no helper without a clip, no display media without `self`, never a camera prompt (Task 9). `launchApp` always sets it |
| `TASSEL_PAPER_DEBUG` | main | `1` shows the heatmap toggle |
| `TASSEL_PAPER_PARAMS` | main → worker | JSON object of `DetectorParams` overrides |
| `TASSEL_OBJECT_STORE`, `TASSEL_S3_ENDPOINT_URL`, `TASSEL_S3_REGION`, `TASSEL_S3_BUCKET`, `TASSEL_S3_ACCESS_KEY_ID`, `TASSEL_S3_SECRET_ACCESS_KEY` | server | Task 4 |
| `TASSEL_E2E_CLIP_DFA_SHORT` | E2E fixtures | Set by global setup: the generated `dfa-short` clip |
| `TASSEL_E2E_S3_BUCKET` | E2E setup | Default `tassel-e2e` |
| `TASSEL_E2E_CAMERA` | camera spec | `1` opts in to the real-camera spec (Task 14) |

### Fake and live pairs (spec §7)
None of these needs a key.

| Part | Fake | Live |
|---|---|---|
| Desk View capture | Helper `ClipProducer` (`TASSEL_HELPER_CLIP`) | Helper `CameraProducer` |
| A camera inside Chromium | Fake-camera switches playing the synthetic MJPEG | n/a: Chromium never lists Desk View (research 02 §2) |
| Display capture | `TASSEL_FAKE_DISPLAY=self` | The system picker (macOS 15+) or the primary screen (Windows) |
| Camera permission | `TASSEL_FAKE_CAMERA_ACCESS` | `systemPreferences` |
| Object store | `MemoryObjectStore` | `S3ObjectStore`, against local Versity in dev and Vultr in P10 |

## Rulings on spec conflicts

Each ruling gives the decision, why, and the cost if it's wrong.

- **R1. Detector resolution.** Spec §4.1 says "160×120 grayscale … compare 16 px cells", which would give 10×7 cells, each larger than a state circle. **Ruling:** use research 02 §5. Motion is gated at 160×120, and ink cells are compared on the flattened page with a long side of 800. *Cost if wrong:* new parameter values only.
- **R2. Transcript with each upload.** Spec §5.2 step 1 uploads "the last ~20 s of transcript". **Ruling:** the client uploads the frame, crop and mask (spec §4.1), and P4 attaches the transcript on the server, which already holds the voice state. *Cost if wrong:* one optional field later.
- **R3. Is ObjectStore fake or live?** Spec §7 puts ObjectStore under `TASSEL_PROVIDERS=fake|live`. **Ruling:** local S3 needs no keys, so S3 is the default everywhere, as Postgres is. `TASSEL_OBJECT_STORE=memory` is the fake for unit tests, and `TASSEL_PROVIDERS` doesn't switch it. *Cost if wrong:* one settings line.
- **R4. The local S3 server.** MinIO's community edition is source-only since 2025-10-15, its repository is archived, and `hub.docker.com/r/minio/minio` returns 404 (see [the README history](https://github.com/minio/minio/commits/master/README.md) and [the API](https://api.github.com/repos/minio/minio)). **Ruling:** use Versity Gateway v1.8.0. A test on 2026-10-17 passed create, put, get, head, presign, list and delete with boto3 1.43.114. RustFS 1.0.1 and SeaweedFS 4.48 also passed; they are larger, and RustFS is newer. *Cost if wrong:* swap one compose service.
- **R5. Chromium's fake camera fakes the microphone too.** The switch is documented to "replace actual camera and microphone" ([media_switches.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/base/media_switches.cc)), and the fake microphone beeps. **Ruling:** `fake-clip` is a dev and E2E mode. P2's fake STT needs no microphone, and P2 points the fake microphone at its `silence.wav` while the fake clip is on. A live-voice developer uses the helper (`TASSEL_HELPER_CLIP`) or window capture instead. *Cost if wrong:* none.
- **R6. P3's touch list** (amended after review). The roadmap lists `native/**`, `renderer/src/paper/**` and `server/…/frames/**`. **Ruling:** P3 also owns these new paths:
  - `apps/desktop/src/main/paper/**`, `apps/desktop/src/shared/paper-bridge.ts`, `packages/paper-synth/**`;
  - `apps/desktop/tsconfig.worker.json`, `apps/desktop/playwright.camera.config.ts`, `apps/desktop/tests/{unit/paper,camera}/**`, `tests/unit/capture-guard.test.ts`, `tests/e2e/{capture-guard.ts,paper-*.spec.ts}`;
  - `scripts/{native,camera,check-no-frames}.mjs`, `docs/research/spikes/p3-tcc/**`;
  - the `s3` service in `docker-compose.yml`, and migration `0003`.

  It makes small hooks in these P1 files:
  - **desktop:** `main/{index,ipc}.ts`, `preload/index.ts`, `shared/bridge.ts`, `renderer/src/main.tsx`, `features/session/{Stage,TitleStrip,SessionScreen}.tsx`, `features/new-session/{NewSessionSheet.tsx,defaults.ts}`, `tests/unit/{session-screen,new-session}.test.tsx`, `tests/e2e/{fixtures,global-setup}.ts`, and `apps/desktop/{package.json,tsconfig.web.json,tsconfig.test.json}`;
  - **shared:** `packages/shared/src/styles/tokens.css` and `packages/shared/src/i18n/{en,es,ko}.json`;
  - **server:** `services/server/src/tassel/{config,app}.py`, `api/sessions.py`, `tests/conftest.py`, `pyproject.toml` and `uv.lock`;
  - **repo:** root `package.json`, `.gitignore`, `scripts/dev.mjs`, the README, `CLAUDE.md`, CI and `docs/research/spikes/README.md`;
  - **only if check F fails:** `main/app-protocol.ts`.

  P3 regenerates `packages/shared/src/api/*`. It doesn't touch `components/icons.tsx`: its glyphs live in `paper/`. *Cost if wrong:* merge work (see "Merging with P2").
- **R7. Screen frames.** Spec §4.1 says a trigger uploads, and also that screen frames leave only on request. **Ruling:** `screen` triggers never upload (`shouldUpload('screen') === false`). *Cost if wrong:* none; P7 owns screen frames.
- **R8. Onboarding** (amended: main's ruling, roadmap updated). Spec §6's onboarding "Desk View check" and consent notice go to **P9**. P3 builds the parts a check needs: the helper's device list, a live preview, "Open Desk View setup" and the permission states. **Gate:** real-frame uploads to any non-local store wait for P9's consent copy, so P10's Vultr wiring may land first but ships to students only after P9. *Cost if wrong:* none to P3.
- **R9. Library thumbnails** (amended: main's ruling). Spec §6's "last … paper thumbnail" on library cards goes to **P8**; `GET …/frames/{id}/image` serves it. *Cost if wrong:* none to P3.
- **R10. Helper frame rate.** The spec targets "1920×1440 at up to 30 fps"; research suggests 10–15. **Ruling:** default 15, maximum 30. *Cost if wrong:* one default.
- **R11. Paper on Windows in dev** (amended after review). P1's new-session sheet disables Paper on win32, but research 02 §3 develops paper view on Windows with the fake clip. **Ruling:**
  - The sheet enables Paper on win32 only when the paper config says `fakeClip` (the clip exists). That config is loaded at boot, before the sheet can render, so the sheet's logic stays synchronous.
  - The default source stays `screen`, and the Windows notice stays.
  - A unit test covers it, and runs on every OS.

  *Cost if wrong:* one condition.
- **R12. The flattened page.** Spec §5.2 step 3 gives the deep check "the flattened page". **Ruling:** P3 uploads the full frame, the crop and the mask (spec §4.1), plus `page_quad`; P4 flattens the page from the quad on the server. *Cost if wrong:* one more upload part.
- **R13. Signed URLs.** Spec §4.3 says "signed URLs". **Ruling:** P3 streams images through an authenticated API route, which works with both stores and needs no CSP change. P10 may add presigned URLs for scale. *Cost if wrong:* one route.
- **R14. Content protection.** Spec §4.1 makes our windows content-protected; with `screen` or window capture, Tassel could capture itself. **Ruling:** P7 owns content protection, together with the overlay. *Cost if wrong:* none to P3.
- **R15. What `auto` means.** **Ruling:** `auto` resolves to `MACOS_DEFAULT` on darwin and to no source elsewhere, which shows "No Desk View camera found". `screen` is used only when named. This matches P1 ruling R25 (Linux behaves like macOS for paper), and keeps CI's xvfb display out of paper screenshots. *Cost if wrong:* one condition.
- **R16. Display media before macOS 15.** There the system picker doesn't exist, and the handler can't tell a window-capture request from a screen one. **Ruling:** on darwin before 15, the handler denies the request instead of guessing, so she never shares more than she chose. *Cost if wrong:* window capture is unavailable on macOS 14, where the helper is the primary source anyway.

## Review Focus

These are the five failure modes a student is most likely to meet that the spec never names. Each one has a test in the task named.

1. **A hand, sleeve or shadow on the page**, including when paper goes live with her hand already there. Expected: no interruption, because it isn't ink; no reference is taken under it; once it leaves, only real ink triggers. Tested by `hand-rests`, `starts-with-hand` and `shadow-pass` in Task 7.
2. **Leaving the session, turning the camera off, quitting, or React re-mounting.** Expected: the camera is released (the helper exits, the camera light goes off), the live dot goes neutral, and no second helper or second picker appears. Tested by:
   - helper stdin EOF in Task 3;
   - the supervisor's `will-quit`, stop-then-start and stop tests in Task 9;
   - StrictMode, unmount and camera-off tests in Task 12;
   - the helper-clip E2E's process check in Task 13.
3. **The camera vanishes or freezes mid-session** (the iPhone walks away, another app takes it, the lid closes). Expected: "Desk View stopped" with Retry, no crash, and no upload burst. Tested by `device-lost` and the socket-close mapping in Task 10, and by the controller's lost state and 3 s frame watchdog in Task 12.
4. **A lighting change** (auto-exposure, a lamp, slow daylight drift). Expected: no trigger. Tested by `exposure-step` and `slow-drift` in Task 7.
5. **She slides the page, holds it, or lays a fresh sheet down.** Expected: one `page` upload and a fresh reference, not a burst of ink triggers and not a silent detector. Tested by `page-shift`, `slide-and-hold` and `page-flip` in Task 7.

## Parallel tracks

Task 1 runs first, with the owner at the Mac for its camera steps. It also commits:
- the cross-track contracts;
- every root `package.json` script P3 needs (`build:native`, `test:native`, `gen:paper-clip`, and the frame guard in `check`).

So no two parallel tracks share a file. Three sub-teams then build in disjoint directories, at most three at a time, and one builder converges Tasks 12–14.

| Track | Tasks, in order | Directories it writes |
|---|---|---|
| **A: native and main** | 2 → 3 → 9 → 10 | `native/**`, `scripts/native.mjs`, `docs/research/spikes/p3-tcc/**` (Task 3's `helper` mode), `apps/desktop/src/main/paper/**`, `apps/desktop/src/renderer/src/paper/{sources/**,types.ts,select-source.ts,paper-store.ts}`, `apps/desktop/tests/unit/paper/{main,sources}/**`; hooks in `main/index.ts`, `main/ipc.ts`, `preload/index.ts`, `shared/bridge.ts` |
| **B: server and upload** | 4 → 5 → 11 | `services/server/**` (`frames/**`, `alembic/versions/0003_frames.py`, `tests/frames/**`, plus hooks in `config.py`, `app.py`, `api/sessions.py`, `tests/conftest.py`, `pyproject.toml`, `uv.lock`), `docker-compose.yml`, `packages/shared/src/api/*` (regenerated), `apps/desktop/src/renderer/src/paper/upload/**`, `apps/desktop/tests/unit/paper/upload/**` |
| **C: vision** | 6 → 7 → 8 | `packages/paper-synth/**`, `apps/desktop/src/renderer/src/paper/detector/**`, `apps/desktop/tests/unit/paper/detector/**`, `apps/desktop/{package.json,tsconfig.test.json,tsconfig.web.json,tsconfig.worker.json}`, root `pnpm-lock.yaml` |
| **Converge** (one builder) | 12 → 13 → 14 | `apps/desktop/src/renderer/src/paper/{use-paper-capture.ts,paper-config.ts,PaperPanel.tsx,PaperVideo.tsx,PaperStateCard.tsx,PaperTopLineExtras.tsx,glyphs.tsx,crop-transform.ts,debug/**}`, `apps/desktop/tests/unit/paper/*.test.tsx`, `tests/unit/{session-screen,new-session}.test.tsx`, `tests/unit/capture-guard.test.ts`, `tests/e2e/capture-guard.ts`, `packages/shared/src/styles/tokens.css`, the i18n catalogs, `renderer/src/main.tsx`, `features/session/{Stage,TitleStrip,SessionScreen}.tsx`, `features/new-session/*`, `apps/desktop/tests/{e2e,camera}/**`, `apps/desktop/playwright.camera.config.ts`, `scripts/{camera,dev}.mjs`, README, `CLAUDE.md`, CI |

How the tracks work:
- Each track works on its own branch, `claude/p3-native`, `claude/p3-server` or `claude/p3-vision`, cut from `claude/p3-paper-view` after Task 1. Each merges back when it finishes.
- Only Track C adds JavaScript dependencies. Merge in the order A, B, C before Task 12, and rerun `pnpm install` after merging C.
- Types and constants that cross tracks are committed in Task 1, before the tracks split:
  - `apps/desktop/src/shared/paper-bridge.ts`;
  - `apps/desktop/src/renderer/src/paper/contracts.ts`.

  No track redefines them. A track that needs a change sends a `QUESTION:` to `main` first.

## Merging with P2

P2 (`2026-10-17-p2-voice-loop.md`) touches `services/server/src/tassel/voice/**` and `renderer/src/tutor/live/**`. The two plans meet in these files:
- **`config.py`, `pyproject.toml`, `uv.lock`:** both plans append. Keep both, then run `uv lock`.
- **`app.py` and `tests/conftest.py`:** P2 Task 8 makes `create_app(settings=None, voice_settings=None)` and passes `voice_settings` in the `client` fixture. P3 Task 5 splits that fixture into `app`, `client` and `store`. The merged `app` fixture passes both P3's `Settings(… object_store="memory", frame_min_interval_s=0)` and P2's `voice_settings`.
- **`packages/shared/src/api/*`:** never hand-merge them. Merge, then run `pnpm gen:api`.
- **`main/index.ts`, `preload/index.ts`, `shared/bridge.ts`, `renderer/src/main.tsx`:** both plans add adjacent lines; the boot loads both configs. Keep both.
- **`main/windows.ts`:** P2's `restrictPermissions` denies `media` when the fake microphone access is `denied`. It must deny only when `details.mediaTypes` includes `'audio'`; otherwise it also blocks the fake clip's video.
- **Fake devices:** both plans append `use-fake-device-for-media-stream`, which is harmless twice. P2's note points the fake microphone at `silence.wav` while the fake clip is on.
- **`tests/e2e/fixtures.ts` and `global-setup.ts`:** P2 Task 16 adds `launchVoice` and the server's voice env. `launchVoice` must call P3's `launchApp`, so the fake paper default and the capture guard apply to voice specs too (privacy rule above).
- **`features/session/{SessionScreen,TitleStrip}.tsx`, `stage-store.ts`:** P2 Tasks 17–18 add the voice session, the language menu and stage-store fields. P3 adds `usePaperCapture`, `SourceLabel`'s `live` and nothing in the store. These are adjacent edits; keep both.
- **i18n catalogs, `apps/desktop/package.json`, the lockfile:** additive (`paper.*` and `voice.*`); rerun `pnpm install`.
- **`components/icons.tsx`:** P2 adds `Sliders`; P3 adds nothing.
- **`scripts/dev.mjs`:** P2 defaults `TASSEL_TUTOR=live`, and P3 defaults the fake paper source. Both stand, since P2's fake STT takes typed lines.
- **CI, README, `CLAUDE.md`:** additive.
- **Migrations:** P2 adds none. P3's `0003_frames` stands as written.

---

### Task 1: TCC and capture spike, frame guard and contracts (the gate)

**Files:**
- Create: `docs/research/spikes/p3-tcc/probe.swift`, `Info.plist`, `main.cjs`, `run.mjs`, `RESULTS.md` (all under `docs/research/spikes/p3-tcc/`)
- Create: `scripts/check-no-frames.mjs`
- Create (cross-track type-and-constant files): `apps/desktop/src/shared/paper-bridge.ts`, `apps/desktop/src/renderer/src/paper/contracts.ts`
- Modify: `.gitignore`: add `.cache/`, `native/deskview-helper/.build/`, `native/deskview-helper/.swiftpm/`, `docs/research/spikes/p3-tcc/.out/`.
- Modify: root `package.json`:
  - `check` gains `node scripts/check-no-frames.mjs`;
  - add `build:native` = `node scripts/native.mjs build`, `test:native` = `node scripts/native.mjs test`, and `gen:paper-clip` = `node packages/paper-synth/scripts/gen-clip.ts`. These point at files Tasks 2 and 6 create.
- Modify: `docs/research/spikes/README.md` (add a row for `p3-tcc/`)

**Interfaces:**
- Produces: `paper-bridge.ts`, exactly as in Task 9's first block. If check D failed, it also has `openDeskViewApp(): Promise<void>` and `PAPER_IPC.openDeskViewApp = 'paper:openDeskViewApp'`.
- Produces: `contracts.ts`, with the Coordinates section's conventions in its comments:

```ts
import type { PaperSourceKind } from '../../../shared/paper-bridge';
export type { PaperSourceKind };
export const DETECTOR_VERSION = 'p3.1';
export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt];
export interface NormRect { x: number; y: number; w: number; h: number }
export interface CellMask { cols: number; rows: number; cells: Array<[number, number]> }
export interface DetectorStats { t: number; busy: boolean; occluded: boolean; quiet: number; cols: number; rows: number;
  changed: number[]; solid: number[]; quad: Quad | null; refAgeMs: number | null; triggers: number; opencv: boolean }
export interface DetectorTrigger { reason: 'ink' | 'page'; capturedAt: string; full: Blob; crop: Blob | null; width: number; height: number;
  pageFound: boolean; pageQuad: Quad; cropRect: NormRect | null; mask: CellMask | null; changedCells: number; inkPixels: number; erasePixels: number }
export interface UploadStats { sent: number; pending: number; failed: number; lastError: 'offline' | 'server' | 'rejected' | 'gone' | 'auth' | null }
```

- Produces: `RESULTS.md`, with one verdict per check (`PASS`, `FAIL` or `NOT RUN`), the JSON lines each check printed, and no images. Later tasks branch on these verdicts:

| Check | What it shows | On PASS | On FAIL |
|---|---|---|---|
| **H** | A probe spawned by a LaunchServices-launched Electron reads Desk View frames using Electron's camera grant | Task 10 sets `MACOS_DEFAULT = 'deskview-helper'`; Task 3 builds `CameraProducer`; Task 14 runs the real-camera spec | `MACOS_DEFAULT = 'window-capture'`. Task 3 builds the server and `ClipProducer`, and records "camera producer deferred to P10 (Developer ID-signed bundle)". Task 14 swaps the camera spec for the owner's window-capture check |
| **A** | The same probe under an Electron the agent started is not authorized (expected) | The responsible-process rule is confirmed | Record it; nothing changes |
| **F** | Chromium's fake camera plays an MJPEG in an agent-started Electron, with no TCC prompt | Task 10's `fake-clip` source as written | Task 10 builds `fake-clip` as an in-renderer MJPEG player. It fetches `app://tassel/__paper/clip.mjpeg`, which P1's `handleAppProtocol` serves from `TASSEL_FAKE_CLIP` when not packaged. It splits the JPEGs, decodes them with `createImageBitmap`, and draws them into a canvas `captureStream()` |
| **P** | `new MediaStreamTrackProcessor({track})` works in the window, and its `readable` transfers to a worker | Task 8's sampler as written | Task 8 samples with `requestVideoFrameCallback` and `new VideoFrame(video)`, transferred to the worker |
| **T** | A display-media handler that answers `callback({ video: request.frame })` gives `getDisplayMedia` frames in an agent-started Electron, in a visible window, with no Screen Recording grant | Task 13's window-capture and unavailable specs as written | Those two specs become unit-only, and Task 14 adds them to the owner's checklist |
| **C** | Playwright `chromium.connectOverCDP` attaches to an Electron started by `open -n -a … --args … --remote-debugging-port=9333`, after its page loads, through `browser.contexts()[0]`, and evaluates in the page | Task 14 drives the UI over CDP | Task 14's camera check becomes the owner's checklist |
| **E** | `open --env TASSEL_SPIKE=1` reaches `process.env` of the launched app (`open -h` on this Mac lists `--env`) | Task 14 passes `TASSEL_*` with `--env` | Task 9 adds `--tassel-env-file=<json>`, read at startup when not packaged |
| **D** | `AVCaptureDeskViewApplication` presents the Desk View app from the probe (**owner at the Mac** watches) | Task 3 implements `openSetup` | Task 1 adds `openDeskViewApp` to the contract (above); Task 9 implements it with `shell.openPath('/System/Library/CoreServices/Applications/Desk View.app')` (bundle `com.apple.DeskCam`); Task 12's setup button uses it |
| **S** | The system picker (`useSystemPicker`) lets the owner pick the Desk View window, and capture runs without a Screen Recording grant (**owner at the Mac**) | Task 10's window capture as written | Record it. Window capture still ships. A refused permission reaches her as `NotAllowedError`, so the `ended` state, whose body names Screen & System Audio Recording, covers it |

- [ ] **Step 1: Write the frame guard's failing check.** Run `node scripts/check-no-frames.mjs --paths a.JPG docs/x.png`. Expected: fails, because the script doesn't exist yet.
- [ ] **Step 2: Implement `scripts/check-no-frames.mjs`.**
  - It reads `git ls-files` (or the `--paths` list) and exits 1 naming every path that ends in `.jpg`, `.jpeg`, `.mjpeg` or `.y4m`, ignoring case.
  - Otherwise it prints `check-no-frames: no camera frames tracked` and exits 0.
  - Add the root scripts and the `.gitignore` lines.
- [ ] **Step 3: Verify the guard.** `node scripts/check-no-frames.mjs --paths a.JPG docs/x.png` exits 1 and lists only `a.JPG`. Then `node scripts/check-no-frames.mjs` exits 0.
- [ ] **Step 4: Write `probe.swift` and `Info.plist`.** The probe is one file with no dependencies.
  - Build it with `swiftc probe.swift -o .out/probe -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist && codesign --force --sign - .out/probe`.
  - The plist has `CFBundleIdentifier` `dev.tassel.p3-probe` and `NSCameraUsageDescription`.

  Its flags:
  - `--status`: print `{"check":"status","camera":<raw authorizationStatus>}`. Never call `requestAccess`.
  - `--capture <n>`: request access if not determined, open the first `.deskViewCamera` device, count `n` frames, then print `{"check":"capture","camera":…,"device":"<name>","frames":n,"width":w,"height":h,"fps":f}`. It writes no image anywhere.
  - `--present-setup`: call `AVCaptureDeskViewApplication().present()` and print the outcome.
  - `--write-mjpeg <path> <frames>`: write a synthetic MJPEG (solid frames with a moving bar, through Core Image JPEG). It is not a camera frame, and the guard forbids committing it.
- [ ] **Step 5: Write `main.cjs`.** This is an Electron main for the spike only, not product code.
  - It reads `--mode`, `--probe`, `--out` and `--clip` from argv, writes its own pid as the first line of `--out`, and appends one JSON line per result.
  - Every mode first records `systemPreferences.getMediaAccessStatus` for camera, microphone and screen.

  The modes:
  - `status` and `capture`: spawn the probe with that flag and relay its line.
  - `fake-camera`:
    - append `use-fake-device-for-media-stream` and `use-file-for-fake-video-capture=<clip>` before ready (the file switch does nothing without the first);
    - open a hidden window on a privileged `spike://` scheme (`standard`, `secure`), mirroring `app://tassel`;
    - call `getUserMedia({ video: true })` (video only, so no microphone prompt can reach the agent);
    - read 10 frames through `MediaStreamTrackProcessor`, with `readable` transferred to a worker (check P);
    - record the track's settings and label and the frame count.
  - `self-capture`: register a display-media handler that answers `{ video: request.frame }`, call `getDisplayMedia({ video: true })` in a visible 320×240 window, and record the frame count and size (check T). A hidden webContents may paint no frames, which would be a false FAIL.
  - `picker`: register `setDisplayMediaRequestHandler(handler, { useSystemPicker: true })`, show a window with a Share button, and record the picked track's settings.
  - `cdp`: open a visible window titled `p3-spike`, load its page, and wait.
- [ ] **Step 6: Write `run.mjs`.** It builds the probe into `.out/` and runs the checks named on its command line. It finds Electron from `apps/desktop` (`require('electron')` resolved there gives the binary; `Electron.app` is three levels up). How each check runs:
  - **A:** spawn the Electron binary directly with `main.cjs --mode status`.
  - **H:** `open -W -n -a <Electron.app> --args <abs main.cjs> --mode capture --probe <abs probe> --out <abs file>`.
  - **F and P:** spawn directly with `--mode fake-camera`, after `probe --write-mjpeg`.
  - **T:** spawn directly with `--mode self-capture`.
  - **C:**
    1. Run `open -n -a <Electron.app> --args <main.cjs> --mode cdp --remote-debugging-port=9333`.
    2. Poll `http://127.0.0.1:9333/json/version` for up to 15 s, then wait until `/json/list` shows the `p3-spike` page.
    3. Run `chromium.connectOverCDP('http://127.0.0.1:9333')`, using Playwright from `apps/desktop`. Take `browser.contexts()[0].pages()[0]` and evaluate `document.title` ([connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)). The verdict rests on this attach and evaluate alone.
    4. Close the app with CDP `Browser.close`. If that fails, kill the pid from `--out`. Either way, record how it closed.
  - **E:** `open -W -n -a <Electron.app> --env TASSEL_SPIKE=1 --args <main.cjs> --mode status --out <file>`; `main.cjs` records `process.env.TASSEL_SPIKE`. Status mode never requests camera access, so E is safe to run unattended.
  - **D and S:** H's launch with `--mode capture --present-setup`, or `--mode picker`. Both print what the owner should look for and wait for Enter.
- [ ] **Step 7: Run the unattended checks.** Run `node docs/research/spikes/p3-tcc/run.mjs A F P T C E`. Expected:
  - A reports the probe isn't authorized;
  - F shows at least 10 frames at the clip's size;
  - P shows frames reaching the worker;
  - T shows frames at the window's size;
  - C reads the title `p3-spike`;
  - E reads `1`.
- [ ] **Step 8 (owner at the Mac): Run H, D and S.** Run `node docs/research/spikes/p3-tcc/run.mjs H D S`. If macOS asks about the camera for Electron, the owner decides; an agent never clicks it. Expected for H: frames 30, with the Desk View device's size (1920×1440 on this Mac if the WWDC22 format holds).
- [ ] **Step 9: Write `RESULTS.md`.** Include the date, macOS 26.6.2, Electron 44.9.0, Swift 6.3.3, each check's verdict and JSON line, and the filled-in decision table.
- [ ] **Step 10: Write the contracts.** Create `paper-bridge.ts` (Task 9's first block, with `openDeskViewApp` if D failed) and `contracts.ts` (above). Run `pnpm --filter @tassel/desktop typecheck`. Expected: exit 0.
- [ ] **Step 11: Verify and commit.** `pnpm check` exits 0 and `git status` shows no image or MJPEG. Then: `git add .gitignore package.json scripts/check-no-frames.mjs docs/research/spikes apps/desktop/src/shared/paper-bridge.ts apps/desktop/src/renderer/src/paper/contracts.ts && git commit -m "docs(spike): P3 TCC and capture spike, frame guard, paper contracts"`

### Task 2: Helper core: protocol, auth, pacing, MJPEG reader (Swift)

**Files:**
- Create: `native/deskview-helper/Package.swift`
  - swift-tools-version 6.0; `platforms: [.macOS(.v14)]`;
  - library target `DeskViewCore`, in Swift 6 language mode;
  - test target `DeskViewCoreTests`;
  - Task 3 adds the executable.
- Create: `native/deskview-helper/Sources/DeskViewCore/FrameHeader.swift`, `Messages.swift`, `AuthGate.swift`, `Pacer.swift`, `MjpegReader.swift`
- Create: `native/deskview-helper/Tests/DeskViewCoreTests/FrameHeaderTests.swift`, `MessagesTests.swift`, `AuthGateTests.swift`, `PacerTests.swift`, `MjpegReaderTests.swift`
- Create: `scripts/native.mjs`

**Interfaces:**
- Produces (`public` in `DeskViewCore`):

```swift
public struct FrameHeader: Equatable, Sendable {
  public static let size = 24
  public var seq: UInt32, ptsMicros: UInt64, width: UInt16, height: UInt16 // version 1, flags 1 are fixed
  public func encoded() -> Data
  public static func decode(_ data: Data) throws(HelperError) -> FrameHeader
}
public func frameMessage(_ header: FrameHeader, jpeg: Data) -> Data
public struct StartOptions: Codable, Equatable, Sendable { public var deviceId: String?; public var fps: Int; public var maxWidth: Int; public var quality: Double } // defaults 15, 1920, 0.85; clamped on decode
public enum ClientMessage: Equatable, Sendable { case hello(token: String, protocolVersion: Int), list, start(StartOptions), stop, openSetup }
public struct DeviceInfo: Codable, Equatable, Sendable { public var id: String; public var name: String; public var builtIn: Bool }
public enum ErrorCode: String, Codable, Sendable { case auth, permissionDenied = "permission-denied", noDevice = "no-device", deviceLost = "device-lost", busy, badRequest = "bad-request", internalError = "internal" }
public enum ServerMessage: Equatable, Sendable { case welcome(helperVersion: String, camera: String), devices([DeviceInfo]), status(state: String, width: Int, height: Int, fps: Int), error(ErrorCode, String), setup(result: String, message: String?) }
public func decodeClientMessage(_ text: String) throws(HelperError) -> ClientMessage
public func encodeServerMessage(_ message: ServerMessage) -> String // compact JSON, sorted keys, "protocol":1 in welcome
public let allowedOrigins: Set<String> // ["app://tassel", "http://localhost:5173"]
public func originAllowed(_ headers: [(name: String, value: String)]) -> Bool // case-insensitive header name; a missing Origin is refused
public struct AuthGate: Sendable { public init(token: String, deadline: Duration = .seconds(2)); public mutating func receive(_ m: ClientMessage, at: ContinuousClock.Instant) -> AuthDecision; public func isExpired(at: ContinuousClock.Instant) -> Bool }
public enum AuthDecision: Equatable, Sendable { case accepted, rejected(closeCode: UInt16), authorized } // rejected → 4401; authorized = already accepted, pass the message on
public struct Pacer: Sendable { public init(fps: Int, maxInFlight: Int = 2); public mutating func shouldEmit(ptsMicros: UInt64, inFlight: Int) -> Bool }
public struct MjpegReader: Sequence { public init(data: Data) } // yields each JPEG (SOI…EOI) as Data
public enum HelperError: Error, Equatable { case badFrame, badMessage(String) }
```

- `AuthGate` compares tokens in constant time over their UTF-8 bytes.
- `MjpegReader` walks JPEG segments by their lengths up to SOS, then scans the entropy-coded data for `FF xx` where `xx` is neither `00` nor `D0`–`D7`. It never searches for `FFD9` alone, because an EXIF thumbnail can contain one.
- `scripts/native.mjs`:
  - `build`: `swift build -c release --package-path native/deskview-helper`, then `codesign --force --sign - <binary>` once Task 3 adds the executable.
  - `test`: `swift test --package-path native/deskview-helper`, plus the Command Line Tools flags from Global Constraints whenever `xcode-select -p` ends with `/CommandLineTools`.
  - `path`: prints `<swift build -c release --show-bin-path>/deskview-helper`.
  - On another OS: the skip line, exit 0.

- [ ] **Step 1: Write `scripts/native.mjs`, `Package.swift` and the failing tests.** The package holds an empty `DeskViewCore` source file, so the run fails on the missing code, not on missing tooling. The tests use Swift Testing (`import Testing`):
  - `headerEncodesToTheContractBytes`: `FrameHeader(seq: 7, ptsMicros: 1_234_567, width: 4, height: 3).encoded()` equals the 24 header bytes of the Global Constraints fixture. Also `frameMessage(…, jpeg: Data([0xFF,0xD8,0xFF,0xD9]))` equals all 28 bytes.
  - `headerRejectsWrongMagicShortDataAndVersion2`.
  - `startDecodesDefaultsAndClamps`: `{"type":"start","fps":60,"maxWidth":99999}` gives fps 30, maxWidth 1920, quality 0.85 and deviceId nil.
  - `unknownTypeIsBadMessage`.
  - `errorEncodesKebabCode`: `.error(.permissionDenied, "x")` encodes to `{"code":"permission-denied","message":"x","type":"error"}`.
  - `authAcceptsTheMatchingHello`, then `authorized` for later messages; `authRejectsAWrongToken` (4401); `authRejectsAnythingBeforeHello` (4401); `authExpiresAfterTwoSeconds`.
  - `originAllowlist`: `app://tassel` and `http://localhost:5173` pass, also with the header named `origin`; `https://example.com` and a missing header fail.
  - `pacerEmitsFifteenOfThirty`: frames every 33,333 µs for 1 s at fps 15 emit 15 ± 1 times.
  - `pacerDropsWhileTwoAreInFlight`.
  - `mjpegReaderSplitsThreeJpegsAndIgnoresTrailingBytes`: three valid JPEGs, made in the test with Core Image from solid `CIImage`s.
  - `mjpegReaderSkipsAnEoiInsideApp1`: an `APP1` segment containing `FFD9`.
- [ ] **Step 2: Run them and confirm they fail.** Run `node scripts/native.mjs test`. Expected: FAIL, with compile errors naming the missing `DeskViewCore` symbols.
- [ ] **Step 3: Implement `DeskViewCore`.**
- [ ] **Step 4: Run them and confirm they pass.** Run `node scripts/native.mjs test`. Expected: PASS, every test above.
- [ ] **Step 5: Commit.** `git add native scripts/native.mjs && git commit -m "feat(native): Desk View helper core with protocol v1, auth and pacing"`

### Task 3: Helper server, producers and Desk View setup (Swift)

**Files:**
- Modify: `native/deskview-helper/Package.swift`:
  - add the executable target `deskview-helper`, which depends on `DeskViewCore`, has `exclude: ["Info.plist"]`, uses Swift 5 language mode if AVFoundation's delegate isolation fights strict concurrency, and sets `linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Sources/deskview-helper/Info.plist"])]`;
  - add the test target `DeskViewHelperTests`, which depends on the `deskview-helper` executable target, so that `swift test` builds the binary first.
- Create: `native/deskview-helper/Sources/deskview-helper/main.swift`. It reads the env and argv (`--tag`), starts the server, prints the ready line, and exits on stdin EOF or SIGTERM.
- Create: `Server.swift`. An `NWListener` on `NWParameters.tcp`, with `requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)` (that binds loopback alone; `requiredInterfaceType = .loopback` binds `*`).
  - Insert `NWProtocolWebSocket.Options(.version13)` with autoReplyPing on and `maximumMessageSize = 65536` at index 0 of `defaultProtocolStack.applicationProtocols` ([Quinn, forum 693799](https://developer.apple.com/forums/thread/693799)).
  - Read the port from `listener.port` in `.ready` ([doc](https://developer.apple.com/documentation/network/nwlistener/port)).
  - Use `setClientRequestHandler` to refuse a bad `Origin`.
- Create: `Connection.swift`. One client per helper: the `AuthGate`, the message loop, and binary sends with `Pacer` backpressure.
  - Each frame goes in a `ContentContext` whose metadata is `NWProtocolWebSocket.Metadata(opcode: .binary)`, with `isComplete: true`.
  - A receive that yields an empty message with no metadata, or a POSIX error, means the client is gone: stop the producer.
- Create: `FrameProducer.swift`, `ClipProducer.swift`, `CameraProducer.swift`, `Setup.swift`.
- Create: `Info.plist`, with `CFBundleIdentifier` `dev.tassel.deskview-helper` and `NSCameraUsageDescription` "Tassel uses Desk View to see your paper."
- Test: `native/deskview-helper/Tests/DeskViewHelperTests/HelperProcessTests.swift`

**Interfaces:**
- Consumes: everything in Task 2.
- Produces: the process contract in Global Constraints ("Helper protocol v1"), plus:

```swift
enum ProducerFailure: Error, Equatable { case permissionDenied, noDevice, failed(String) } // → error permission-denied / no-device / internal
protocol FrameProducer: AnyObject {
  func devices() -> [DeviceInfo]
  /// onFrame: (jpeg, width, height, ptsMicros). onError ends the stream.
  func start(_ options: StartOptions, onFrame: @escaping @Sendable (Data, UInt16, UInt16, UInt64) -> Void,
             onError: @escaping @Sendable (ErrorCode, String) -> Void) throws(ProducerFailure)
  func stop()
}
```

- **`ClipProducer`** (used when `TASSEL_HELPER_CLIP` is set):
  - plays the file's own timeline, 30 frames per second as Chromium plays it, looping at the end; the `Pacer` thins it to the requested fps, so the clip never runs slow;
  - reports `devices()` as `[{id: "clip", name: "Test clip", builtIn: true}]`;
  - reports `welcome` camera `authorized`, and requests no camera access.
- **`CameraProducer`:**
  - discovers devices with `AVCaptureDevice.DiscoverySession(deviceTypes: [.deskViewCamera], mediaType: .video, position: .unspecified)` ([deskViewCamera](https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicetype-swift.struct/deskviewcamera), macOS 13+);
  - picks the requested device, else the first that isn't a Continuity Camera (`builtIn`; `isContinuityCamera` is macOS 13+), else the first;
  - uses `AVCaptureVideoDataOutput` with `alwaysDiscardsLateVideoFrames = true` ([doc](https://developer.apple.com/documentation/avfoundation/avcapturevideodataoutput/alwaysdiscardslatevideoframes));
  - paces in software with `Pacer`, leaving the device's `activeVideoMinFrameDuration` alone. WWDC22 gives Desk View one format, 420v 1920×1440 at 30 fps ([10018](https://developer.apple.com/videos/play/wwdc2022/10018/));
  - downsizes to `maxWidth` and encodes with one shared `CIContext` ([jpegRepresentation](https://developer.apple.com/documentation/coreimage/cicontext/jpegrepresentation(of:colorspace:options:))). The quality key is `CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)`, which typechecks against the macOS 26.5 SDK;
  - maps errors:
    - `.denied` or `.restricted` → `permission-denied`;
    - no device → `no-device`;
    - `AVCaptureDevice.wasDisconnectedNotification` ([doc](https://developer.apple.com/documentation/avfoundation/avcapturedevice/wasdisconnectednotification)), `AVCaptureSession.runtimeErrorNotification` ([doc](https://developer.apple.com/documentation/avfoundation/avcapturesession/runtimeerrornotification)) or `wasInterruptedNotification` → `device-lost`.
- **`Setup`:** `openSetup` calls `try await AVCaptureDeskViewApplication().present()` ([doc](https://developer.apple.com/documentation/avfoundation/avcapturedeskviewapplication/present(completionhandler:)); macOS 13+) and answers `setup {result}`. If Task 1's check D failed, it answers `setup {result: "failed"}` without trying.
- **Camera attribution:** the helper relies on TCC's responsible process. When Electron spawns it, Electron's grant and Electron's `NSCameraUsageDescription` apply ([Quinn, forum 701094](https://developer.apple.com/forums/thread/701094); [Qt, "The curious case of the responsible process"](https://www.qt.io/blog/the-curious-case-of-the-responsible-process)). Ad-hoc grants are tied to one exact build ([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).

- [ ] **Step 1: Write the failing process tests.** They run in clip mode, so they never touch the camera. Each test:
  - writes a 3-frame, 64×48 MJPEG with Core Image;
  - spawns the built executable at `<package>/.build/debug/deskview-helper` with `Process`;
  - talks to it with `URLSessionWebSocketTask`, through a `URLRequest` whose `Origin` is `app://tassel`.

  The tests:
  - `printsReadyThenStreamsFrames`:
    1. The ready line parses, with `protocol` 1.
    2. `hello` brings `welcome`.
    3. `start {"fps":10}` brings `status running`, then at least 5 binary messages. Each decodes with width 64 and height 48, and seq rises by 1.
    4. `stop` brings `status stopped`.
  - `clipPlaysAtItsOwnRate`: a 30-frame clip at `start {"fps":30}` loops back to frame 0 after about 1 s, not 2 s.
  - `wrongTokenClosesWith4401`.
  - `foreignOriginIsRefusedAtUpgrade`: `Origin: https://example.com` never opens.
  - `oversizedMessageClosesTheConnection`: a 70 KiB text message.
  - `silentClientClosesAfterTwoSeconds` (4401).
  - `secondClientGetsBusy`: an `error busy`, then close 4409.
  - `exitsWithinOneSecondOfStdinEOF`: close the stdin pipe; the process ends within 1.5 s with status 0.
  - `missingTokenExits64`.
- [ ] **Step 2: Run them and confirm they fail.** Run `node scripts/native.mjs test`. Expected: FAIL (no executable target).
- [ ] **Step 3: Implement the executable.** Use Task 1's verdict H to decide whether `CameraProducer` is built now or recorded as deferred.
- [ ] **Step 4: Run them and confirm they pass.** Run `node scripts/native.mjs test`. Expected: PASS.
- [ ] **Step 5: Add a `helper` mode to the spike harness.**
  1. In `main.cjs`, register the privileged scheme `app` and serve a one-file page at `app://tassel/`, so the browser itself sends the allowed `Origin`.
  2. Spawn the helper (`--probe` names its path) with a fresh token.
  3. In a hidden window on that page, connect to `ws://127.0.0.1:<port>`, send `hello` and then `start`, count 30 frames, and record `{frames, width, height}`. No frame is written.
  4. Add `HH` to `run.mjs`, launching the same way as H.
- [ ] **Step 6 (owner at the Mac, H PASS only): Try the camera once.** Run `node scripts/native.mjs build && node docs/research/spikes/p3-tcc/run.mjs HH`. Expected: frames 30, at the Desk View device's size. This only checks the camera producer under LaunchServices; Task 14 is the end-to-end camera check.
- [ ] **Step 7: Commit.** `git add native docs/research/spikes/p3-tcc && git commit -m "feat(native): helper WebSocket server, clip and Desk View producers, setup"`

### Task 4: Object store and local S3

**Files:**
- Create: `services/server/src/tassel/frames/__init__.py`, `services/server/src/tassel/frames/objects.py`
- Modify: `services/server/src/tassel/config.py`, `services/server/src/tassel/app.py`, `services/server/pyproject.toml` (`boto3>=1.43,<2`), `uv.lock`, `docker-compose.yml`
- Test: `services/server/tests/frames/test_objects.py`

**Interfaces:**
- Produces:

```python
# config.py: new Settings fields (the dev values are not secrets)
object_store: Literal["memory", "s3"] = "s3"
s3_endpoint_url: str | None = "http://127.0.0.1:7070"   # Vultr: https://<cluster>.vultrobjects.com
s3_region: str = "us-east-1"                             # Vultr: the cluster, e.g. "ewr1"
s3_bucket: str = "tassel-frames"
s3_access_key_id: str = "tassel"
s3_secret_access_key: str = "tassel-dev-only"

# frames/objects.py
class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> bytes | None: ...
    async def delete_prefix(self, prefix: str) -> int: ...      # returns how many objects it deleted
class MemoryObjectStore: ...                                   # also .keys() -> list[str] for tests
class S3ObjectStore:
    def __init__(self, *, endpoint_url: str | None, region: str, bucket: str, access_key_id: str,
                 secret_access_key: str, page_size: int = 1000, client_factory=boto3.client) -> None: ...
def make_object_store(settings: Settings) -> ObjectStore
def get_object_store(request: Request) -> ObjectStore           # FastAPI dependency
```

- **`S3ObjectStore` behavior:**
  - It creates its boto3 client lazily, on first use, with the Config in Global Constraints. App startup makes no network call.
  - On first `put`, it creates the bucket if `head_bucket` reports 404, and remembers that it checked.
  - It runs each boto3 call in a worker thread with `anyio.to_thread.run_sync`.
  - `delete_prefix` pages through `list_objects_v2`, `page_size` keys at a time, and sends each page to `delete_objects`.
- **App wiring:** `create_app` sets `app.state.object_store = make_object_store(settings)` in the factory, not the lifespan, so tests can swap it.
- **The compose service `s3`** (env names from [Versity's Docker wiki](https://github.com/versity/versitygw/wiki/Docker) and [main.go v1.8.0](https://github.com/versity/versitygw/blob/v1.8.0/cmd/versitygw/main.go)):
  - image `versity/versitygw:v1.8.0`; ports `127.0.0.1:7070:7070`;
  - env:
    - `ROOT_ACCESS_KEY=tassel`, `ROOT_SECRET_KEY=tassel-dev-only`;
    - `VGW_BACKEND=posix`, `VGW_BACKEND_ARG=/data`;
    - `VGW_META_SIDECAR=/meta`: it keeps object metadata out of extended attributes, which some volume backends lack (a macOS bind mount does);
    - `VGW_PORT=:7070`, `VGW_HEALTH=/health`, `VGW_REGION=us-east-1`;
  - named volumes `s3-data:/data` and `s3-meta:/meta`;
  - healthcheck `["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:7070/health"]`: the image is Alpine with busybox wget but no curl ([Dockerfile](https://github.com/versity/versitygw/blob/main/Dockerfile)).
- **Region:** Versity checks the region inside the signature, so `s3_region` must equal `VGW_REGION`.

- [ ] **Step 1: Write the failing tests:**
  - `test_memory_store_roundtrip_and_prefix_delete`: put `a/1`, `a/2`, `b/1`; `delete_prefix("a/")` returns 2; `get("a/1")` is `None`; `b/1` remains.
  - `test_s3_store_roundtrip_against_local_s3`: bucket `tassel-test-<8 hex>`, created on first put. Put and get the bytes; `delete_prefix` with `page_size=2` over 5 objects returns 5; then `get` is `None`. The fixture fails with "Local S3 isn't running: docker compose up -d s3" when port 7070 refuses, and deletes its bucket afterwards.
  - `test_s3_store_is_lazy`: constructing it never calls a spy `client_factory`.
  - `test_make_object_store_picks_the_setting`.
- [ ] **Step 2: Run them and confirm they fail.** Run `docker compose up -d db && uv run --directory services/server pytest tests/frames/test_objects.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement the store, the settings, the compose service and the wiring.**
- [ ] **Step 4: Run them and confirm they pass.** Run `docker compose up -d s3 && uv run --directory services/server pytest -v && uv run --directory services/server ruff check`. Expected: PASS, and P1's tests still pass.
- [ ] **Step 5: Commit.** `git add docker-compose.yml services/server && git commit -m "feat(server): object store with S3 and memory backends, local Versity S3"`

### Task 5: Frames API

**Files:**
- Create: `services/server/src/tassel/frames/models.py`, `tables.py`, `repo.py`, `jpeg.py`, `keys.py`, `api.py`
- Create: `services/server/alembic/versions/0003_frames.py`
- Modify:
  - `services/server/src/tassel/app.py`: include the frames router. `CORSMiddleware` gains `expose_headers=["Retry-After"]`, so the app can read the 429's delay.
  - `services/server/src/tassel/config.py`: `frame_max_bytes: int = 8 * 1024 * 1024`, `crop_max_bytes: int = 2 * 1024 * 1024`, `frame_min_interval_s: float = 1.0`.
  - `services/server/src/tassel/api/sessions.py`: the delete route deletes frame objects first.
  - `services/server/tests/conftest.py`: split the `client` fixture. A new `app` fixture builds `create_app(Settings(database_url=…, object_store="memory", frame_min_interval_s=0))`; `client` wraps that app; a new `store` fixture returns `app.state.object_store`. Tests that need other settings build their own app the same way.
  - `services/server/pyproject.toml`: `python-multipart>=0.0.32`; dev group `pillow>=12`. Also `uv.lock`.
- Modify (generated): `packages/shared/src/api/openapi.json`, `packages/shared/src/api/schema.d.ts`
- Test: `services/server/tests/frames/test_frames_api.py`, `test_jpeg.py`, `test_frame_meta.py`, `services/server/tests/frames/frame-meta-example.json`

**Interfaces:**
- Consumes: `ObjectStore` and `get_object_store` (Task 4); `current_learner`, `sessions_repo.get_for`, `get_db` and the declarative `Base` of `tassel.storage.tables` (P1).
- Produces:

```python
FrameReason = Literal["ink", "page"]
PaperSourceKind = Literal["deskview-helper", "window-capture", "fake-clip", "screen"]
class Point(BaseModel): x: float; y: float                         # pixels of the full JPEG, >= 0
class NormRect(BaseModel): x: float; y: float; w: float; h: float  # page coordinates in [0, 1]; x+w and y+h <= 1 (1e-6 slack)
class CellMask(BaseModel): cols: int; rows: int; cells: list[tuple[int, int]]  # [col, row]; cols, rows in 1..200; <= 40000 cells, each in range
class DetectorInfo(BaseModel): changed_cells: int; ink_pixels: int; erase_pixels: int; version: str  # counts >= 0, version <= 20 chars
class FrameMeta(BaseModel):   # model_config extra="forbid"
    reason: FrameReason; source: PaperSourceKind; captured_at: AwareDatetime; page_found: bool
    page_quad: list[Point] | None   # exactly 4: TL, TR, BR, BL
    crop_rect: NormRect | None; mask: CellMask | None; detector: DetectorInfo
class FrameOut(BaseModel):
    id: UUID; session_id: UUID; seq: int; reason: FrameReason; source: PaperSourceKind
    captured_at: datetime; created_at: datetime; width: int; height: int; has_crop: bool; bytes: int
    page_found: bool; page_quad: list[Point] | None; crop_rect: NormRect | None; mask: CellMask | None
class FrameList(BaseModel): items: list[FrameOut]
def jpeg_dimensions(data: bytes) -> tuple[int, int]               # reads SOF0/1/2; raises NotJpeg
def frame_key(learner_id, session_id, frame_id, part: Literal["full", "crop"]) -> str
def session_prefix(learner_id, session_id) -> str                  # "learners/{l}/sessions/{s}/"
```

- **Table `frames`,** declared on P1's `Base`, so conftest's `TRUNCATE` of `Base.metadata.sorted_tables` includes it. An unlisted table with a foreign key into `sessions` would make that `TRUNCATE` fail. Columns:
  - `id uuid pk`;
  - `session_id uuid` FK → `sessions.id` ON DELETE CASCADE;
  - `seq int`, unique per `(session_id, seq)`;
  - `reason text` (check), `source text` (check);
  - `captured_at timestamptz`, `created_at timestamptz default now()`;
  - `width int`, `height int`, `bytes int`;
  - `full_key text`, `crop_key text null`;
  - `meta jsonb` (holds `page_found`, `page_quad`, `crop_rect`, `mask` and `detector`);
  - index `(session_id, seq desc)`.
- **`seq`** is the session's highest `seq` plus 1, taken while holding `SELECT … FOR UPDATE` on the session row.
- **Routes** (all require `current_learner`; another learner's session is 404):

| Route | Behavior |
|---|---|
| `POST /v1/sessions/{session_id}/frames` | Multipart parts `frame` (file, required), `crop` (file, optional) and `meta` (`Annotated[Json[FrameMeta], Form()]`; bad JSON gives 422, verified with FastAPI 0.143.3). Answers 201 `FrameOut`. It writes the objects, then the row, then bumps `sessions.last_activity_at`. If the insert fails, it deletes the objects it wrote. |
| `GET /v1/sessions/{session_id}/frames?limit=50` | `FrameList`, newest `seq` first; `limit` 1–200 |
| `GET /v1/sessions/{session_id}/frames/{frame_id}/image?part=full\|crop` | `image/jpeg` bytes with `Cache-Control: private, no-store`. 404 for an unknown frame, a missing crop or a missing object |
| `DELETE /v1/sessions/{session_id}` (P1) | Deletes the session's prefix from the store first, then the session; frame rows cascade. Skips the store when the session has no frames. |

- **Upload rejections:**
  - **415** when a part doesn't start with `FF D8 FF` or has no SOF marker.
  - **413** when `frame` is larger than `frame_max_bytes` or `crop` larger than `crop_max_bytes`. Read at most limit + 1 bytes.
  - **422** for invalid meta, or `reason: "ink"` without both a crop part and `mask` and `crop_rect`.
  - **429** with `Retry-After: 1` when the session's newest frame is younger than `frame_min_interval_s`.
- **Width and height** come from the JPEG's SOF marker, never from the client.
- **Size limits:** Starlette's 1 MB non-file part limit ([formparsers.py](https://github.com/Kludex/starlette/blob/1.8.0/starlette/formparsers.py)) covers `meta`, because the largest valid mask is under 400 KB.

- [ ] **Step 1: Write the failing tests.** Test JPEGs come from Pillow: full 64×48, crop 16×16.
  - `test_upload_stores_objects_row_and_returns_frame_out`: 201, seq 1, width 64, height 48, `has_crop` true. The store holds exactly `…/frames/<id>/full.jpg` and `…/crop.jpg` under `learners/<lid>/sessions/<sid>/`.
  - `test_upload_bumps_last_activity`.
  - `test_seq_increments_per_session_and_restarts_per_session`.
  - `test_rejects_non_jpeg_415`, and the same for a crop.
  - `test_rejects_oversize_frame_413` (`frame_max_bytes=1000` in the test settings).
  - `test_ink_without_crop_or_mask_422`, `test_meta_extra_field_422`, `test_mask_cell_out_of_range_422`, `test_page_quad_needs_four_points_422`.
  - `test_page_reason_needs_no_crop_201`.
  - `test_rate_guard_429_with_retry_after`: `frame_min_interval_s=60`, two uploads.
  - `test_cors_exposes_retry_after`: a request with `Origin: app://tassel` gets `Access-Control-Expose-Headers` containing `Retry-After`.
  - `test_foreign_session_404_on_post_list_and_image`.
  - `test_list_is_newest_first_and_limited`.
  - `test_image_returns_full_and_crop_bytes`, `test_image_missing_crop_404`.
  - `test_delete_session_deletes_objects_then_rows`: the store has no keys left under the prefix, and the frames table is empty.
  - `test_frames_table_is_on_base_metadata`.
  - `test_jpeg_dimensions`: baseline and progressive (Pillow `progressive=True`) give `(64, 48)`; `b"nope"` raises `NotJpeg`.
  - `test_frame_meta_example_validates`. `frame-meta-example.json` is an `ink` meta. Task 11's contract test reads the same file. Its fields:
    - source `fake-clip`, `captured_at` `2026-10-17T14:32:05.120Z`, `page_found` true;
    - a quad;
    - crop_rect `{x:0.1, y:0.2, w:0.3, h:0.25}`;
    - a mask `{cols:50, rows:38, cells:[[5,12],[6,12]]}`, where 38 rows is Letter's 618 px short side floored to 608;
    - detector `{changed_cells:2, ink_pixels:31, erase_pixels:0, version:"p3.1"}`.
- [ ] **Step 2: Run them and confirm they fail.** Run `uv run --directory services/server pytest tests/frames -v`. Expected: FAIL.
- [ ] **Step 3: Implement the models, migration `0003` (`down_revision = "0002"`), the repo, the routes and the delete hook.**
- [ ] **Step 4: Run them and confirm they pass.** Run `uv run --directory services/server pytest -v && uv run --directory services/server ruff check && uv run --directory services/server alembic heads`. Expected: PASS, clean, and one head.
- [ ] **Step 5: Regenerate the API types.** Run `pnpm gen:api && pnpm check:api`. Expected: exit 0, with `FrameOut` and the frame routes in `schema.d.ts`.
- [ ] **Step 6: Commit.** `git add services/server packages/shared/src/api && git commit -m "feat(server): frames API with JPEG checks, S3 objects and session cleanup"`

### Task 6: The synthetic clip (`packages/paper-synth`)

**Files:**
- Create: `packages/paper-synth/package.json`:
  - name `@tassel/paper-synth`, `"type": "module"`;
  - `exports: {".": "./src/index.ts"}`;
  - scripts `test` (`vitest run`) and `typecheck` (`tsc --noEmit -p .`);
  - dependency `jpeg-js` 0.4.4; devDependencies `vitest`, `typescript` and `@types/node`, at the versions `@tassel/shared` uses.
- Create: `packages/paper-synth/tsconfig.json`, the same as `packages/shared/tsconfig.json`: extends the base; `types: ["node"]`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. Relative imports carry `.ts`, so Node runs the CLI directly.
- Create: `packages/paper-synth/src/index.ts`, `rng.ts`, `geometry.ts`, `glyphs.ts`, `scene.ts`, `raster.ts`, `variants.ts`, `mjpeg.ts`, `truth.ts`
- Create: `packages/paper-synth/scripts/gen-clip.ts`
- Test: `packages/paper-synth/tests/determinism.test.ts`, `variants.test.ts`, `mjpeg.test.ts`, `truth.test.ts`, `glyphs.test.ts`

**Interfaces:**
- Produces:

```ts
export type VariantName = 'dfa-demo' | 'dfa-short' | 'hand-rests' | 'starts-with-hand' | 'shadow-pass' | 'exposure-step'
  | 'page-shift' | 'slide-and-hold' | 'page-flip' | 'erase' | 'slow-drift';
export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt];                         // TL, TR, BR, BL
export interface NormRect { x: number; y: number; w: number; h: number }
export interface ExpectedTrigger { reason: 'ink' | 'page'; atMs: number; toleranceMs: number; groups: string[] }
export interface ClipTruth {
  dfa: { states: Array<{ id: string; center: Pt; radius: number; accept: boolean; start: boolean }>;   // page coordinates 0–1
         transitions: Array<{ from: string; to: string; label: string; labelAt: Pt }> };
  groups: Array<{ id: string; startMs: number; endMs: number; bbox: NormRect }>;
  hand: Array<{ fromMs: number; toMs: number; onPage: boolean; moving: boolean }>;
  expectedTriggers: ExpectedTrigger[];
}
export interface Clip { name: VariantName; durationMs: number; pageQuadAt(tMs: number, width: number, height: number): Quad; truth: ClipTruth }
export const GENERATOR_VERSION = 2;
export function makeClip(name: VariantName): Clip;
export function renderFrame(clip: Clip, tMs: number, opts: { width: number; height: number; noise?: boolean; frameIndex?: number }): Uint8ClampedArray; // RGBA
export function writeMjpeg(clip: Clip, path: string, opts: { width: number; height: number; fps?: number; motionFps?: number; quality?: number; noise?: boolean }): Promise<{ frames: number; bytes: number; sha256: string }>;
export function truthJson(clip: Clip, width: number, height: number): object; // ClipTruth plus every coordinate in frame pixels too
```

- **Determinism:**
  - all randomness comes from a seeded `mulberry32`;
  - noise uses `frameIndex` as its seed;
  - no `Math.random` and no `Date`;
  - pure JavaScript arithmetic everywhere, so output bytes match on macOS and Windows.
- **Frame:**
  - 960×720 by default; desk `#cdc4b6` with a static seeded grain;
  - the page: landscape at 11:8.5, 86% of the frame height, centered, rotated −1.4°, colored `#fbfaf6`;
  - ruled lines `#e4ebf3` every 1/20 of the page height from 18%, and a margin line `#f3c9cf` at 7% of the width (these colors are the mock's);
  - lighting: a vignette of 1 − 0.06·r², and when `noise` is on, per-channel noise of σ 1.2/255.
- **Ink:**
  - the printed statement "Binary strings that start with 010" at page (0.10, 0.10): cap height 3.5% of the page height, `#3f3f3f`, stroke 0.22% of the page width, no jitter;
  - handwriting: `#474747`, stroke 0.35% of the page width, with seeded jitter of ±0.15%;
  - strokes are anti-aliased by distance to the segment; finished strokes are cached in an ink layer, and only the stroke in progress is drawn per frame.
- **Glyphs:** single-stroke polylines on a 0–1 em box for exactly `B a g h i n r s t w y 0 1 2 3 q ,` and space. They are authored for this package; no third-party font data.
- **DFA layout** (page coordinates):
  - states of radius 0.055 at y 0.55 and x 0.18, 0.39, 0.60, 0.81; q3 has an inner circle at 0.8×;
  - a start arrow from x 0.08;
  - labels `q0`–`q3` inside the circles, and transition labels above the arrows;
  - self-loops above q3 (`0,1`) and q0 (`1`).
- **Hand:**
  - a skin `#d9a184` ellipse 16%×11% of the frame, a forearm capsule toward the bottom-right corner, and a pen capsule `#2b2b2b` whose tip follows the stroke;
  - it enters over 0.4 s and leaves the frame over 0.5 s;
  - "rests" means it lies still on the page.
- **Timelines** (times in seconds). Every expected trigger has a tolerance of ±0.7 s:
  - **ink** = retract end + 1.0 (stable) + 2.0 (quiet ink);
  - **page** = end of the move or of the hand leaving + 1.0 (the first stable, clear sample).

  The two clips the app plays, `dfa-demo` and `dfa-short`, open with 6 s of blank page. The worker and OpenCV need that long to start, and a reference taken after the first stroke would hide it. The other variants are for unit tests, where the detector starts at t = 0. `hand-rests` gives the detector 1.6 s of blank page before the hand enters, so its first reference is clear.

| Variant | Length | Script | Expected triggers |
|---|---|---|---|
| `dfa-demo` | 56 | The page is blank to 6.0. Then, with the hand moving throughout: start arrow 6.0–7.0; q0 7.2–9.2; edge q0→q1 with `0` 9.6–11.2; q1 11.6–13.6; edge `1` 14.0–15.6; q2 16.0–18.0; edge `0` 18.4–20.0; q3 (double circle) 20.4–23.2. Retract 23.2–23.7, then still to 32.0. Loop `0,1` on q3 32.0–35.0, retract to 35.5, still to 41.0. Loop `1` on q0 41.0–43.6, retract to 44.1, still to 56 | ink at 26.7 (every group so far), ink at 38.5 (`loop-q3`), ink at 47.1 (`loop-q0`) |
| `dfa-short` | 20 | Blank to 6.0; q0 6.0–8.0, retract to 8.5, still | ink at 11.5 (`q0`) |
| `hand-rests` | 18 | Blank to 2.0 (the hand enters 1.6–2.0); q0 2.0–4.0; the hand rests on the lower right of the page 4.0–10.0, then leaves by 10.5 | ink at 13.5 (`q0` only) |
| `starts-with-hand` | 16 | q0 already drawn; the hand rests on the page from 0 to 4.0 and leaves by 4.5; q1 7.0–9.0 (the hand enters 6.6), retract to 9.5 | ink at 12.5 (`q1` only) |
| `shadow-pass` | 12 | Blank page; a soft shadow (25% darker, Gaussian) crosses it 2.0–5.0 | none |
| `exposure-step` | 12 | q0 already drawn; global brightness −15% at 3.0, and it stays | none |
| `page-shift` | 12 | q0 already drawn; the page slides 60 px right 3.0–3.4 | page at 4.4 |
| `slide-and-hold` | 20 | q0 already drawn; the hand enters 1.6–2.0, slides the page 60 px right 2.0–2.4, holds it still to 6.0 and leaves by 6.5; q1 10.0–12.0 (the hand enters 9.6), retract to 12.5 | page at 7.5, ink at 15.5 (`q1` only) |
| `page-flip` | 18 | q0 2.0–4.0 (the hand enters 1.6), retract to 4.5; 12.0–12.6 the hand lays a fresh sheet of the same worksheet (printed statement, ruled lines and margin, no handwriting) in the same place, then leaves by 13.1 | ink at 7.5 (`q0`), page at 14.1 |
| `erase` | 14 | q0 and its label already drawn; the label is erased 2.0–3.5 with the hand moving, which retracts by 4.0 | ink at 7.0 (the label's cells) |
| `slow-drift` | 45 | Blank page; brightness drifts −8% across 40 s | none |

- **The CLI.** `node packages/paper-synth/scripts/gen-clip.ts --variant <name> --out <dir> [--width 960 --height 720 --quality 80 --no-noise]`:
  - writes `<dir>/<variant>-<w>x<h>-<hash8>.mjpeg` and `.truth.json`, where `hash8` is the first 8 hex digits of the SHA-256 of the options and `GENERATOR_VERSION`;
  - skips the work when that file already exists;
  - prints `{"mjpeg","truth","frames","sha256"}` as one JSON line.
- **MJPEG:**
  - 30 fps: Chromium plays MJPEG at the constant `kMJpegFrameRate = 30.0f` and loops at end of file ([file_video_capture_device.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/file_video_capture_device.cc)). The jump back to the first frame looks like an erasure, so a spec that runs past the clip's length sees one more trigger;
  - motion is rendered at `motionFps` 15, and each rendered frame is written twice;
  - a frame identical to the previous one reuses its JPEG bytes;
  - the file is JPEGs back to back, with nothing before the first SOI and nothing after the last EOI. A frame that fails to parse hits a `CHECK` in Chromium and crashes the capture process;
  - the name must end in `.mjpeg`: the parser is chosen by a case-insensitive suffix check, so `.jpg` is rejected.

- [ ] **Step 1: Write the failing tests:**
  - `renderFrame is pure`: the same arguments give equal bytes. `writeMjpeg` run twice gives the same SHA-256.
  - `golden dfa-short at 160×120 with noise`: the SHA-256 equals the value recorded on the first green run. CI's `windows-latest` unit job must match it unchanged; this is the parity check.
  - `the MJPEG has durationMs/1000 × 30 frames, each SOI…EOI`. Frame 0 decodes with `jpeg-js` to 960×720.
  - `the MJPEG starts with FF D8 and ends with FF D9, with no byte outside a frame`.
  - `dfa-demo truth`:
    - states q0–q3, with q0 the start state and only q3 accepting;
    - transitions (q0,`0`,q1), (q1,`1`,q2), (q2,`0`,q3), (q3,`0,1`,q3), (q0,`1`,q0);
    - three expected triggers at 26.7, 38.5 and 47.1.
  - `every stroke point lies inside the page quad at its time`.
  - `every glyph in the set has a stroke, and an unknown character throws`.
  - `the hand is out of frame from each expected ink trigger's atMs − 3000 to atMs`.
  - `hand-rests keeps the hand out of frame for its first 1.6 s`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm install && pnpm --filter @tassel/paper-synth test`. Expected: FAIL.
- [ ] **Step 3: Implement the package and the CLI.** Record the golden hash.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run `pnpm --filter @tassel/paper-synth test && pnpm --filter @tassel/paper-synth typecheck`. Expected: PASS.
  - Then run `pnpm gen:paper-clip --variant dfa-demo --out .cache/paper-clips`. Expected: one JSON line, with 1680 frames.
- [ ] **Step 5: Commit.** `git add packages/paper-synth pnpm-lock.yaml && git commit -m "feat(paper-synth): deterministic synthetic clips of the demo DFA"`

### Task 7: Change-detector core (pure TypeScript)

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/detector/params.ts`, `gray.ts`, `normalize.ts`, `cells.ts`, `homography.ts`, `detector.ts`
- Modify: `apps/desktop/package.json` (devDependency `"@tassel/paper-synth": "workspace:*"`)
- Modify: `apps/desktop/tsconfig.test.json`: `allowImportingTsExtensions: true`, which is allowed with its `noEmit`. The tests import `@tassel/paper-synth`, whose relative `.ts` imports would otherwise fail the typecheck with TS5097.
- Test:
  - `apps/desktop/tests/unit/paper/detector/gray.test.ts`, `normalize.test.ts`, `cells.test.ts`, `homography.test.ts`, `params.test.ts`, `detector.test.ts`, `variants.test.ts`;
  - the helper `apps/desktop/tests/unit/paper/detector/harness.ts`.

**Interfaces:**
- Consumes: `Pt`, `Quad`, `NormRect`, `CellMask`, `DetectorStats` and `DETECTOR_VERSION` from `paper/contracts.ts` (Task 1).
- Produces:

```ts
// params.ts
export interface DetectorParams { /* every name in the Global Constraints table */ }
export const DEFAULT_PARAMS: Readonly<DetectorParams>;
export { DETECTOR_VERSION } from '../contracts';
export function parseParams(input: unknown): Partial<DetectorParams>; // keeps known keys with finite values in range, drops the rest
// gray.ts
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array; // (77R + 150G + 29B) >> 8
export function boxDownsample(gray: Uint8Array, w: number, h: number, outW: number, outH: number): Uint8Array;
export function blur3(gray: Uint8Array, w: number, h: number): Uint8Array;
export function movingFraction(a: Uint8Array, b: Uint8Array, delta: number): number;
// normalize.ts
export function boxBlur(gray: Uint8Array | Float32Array, w: number, h: number, size: number): Float32Array; // integral image
export function normalizeLighting(gray: Uint8Array, w: number, h: number, size: number): Float32Array;      // gray / max(blur, 1)
// cells.ts
export interface CellDiff { cols: number; rows: number; changed: number[]; inked: number[]; erased: number[]; solid: number[]; inkPixels: number; erasePixels: number } // inked/erased: the changed cells, by their larger pixel count
export function compareCells(reference: Float32Array, current: Float32Array, w: number, h: number, p: DetectorParams): CellDiff;
export function darkCells(raw: Uint8Array, w: number, h: number, p: DetectorParams): number[];         // occluderLevel and occluderSmoothness
export function largestCluster(cells: number[], cols: number): number;                                 // size of the biggest 4-connected group
// homography.ts
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export function homography(from: Quad, to: Quad): Mat3;
export function applyH(h: Mat3, p: Pt): Pt;
export function invertH(h: Mat3): Mat3;
export function quadShift(a: Quad, b: Quad): number;                    // largest corner distance
export function compareSize(quad: Quad, longSide: number, cell: number): { width: number; height: number }; // short side floored to a multiple of cell
// detector.ts
export interface MotionSample { gray: Uint8Array; width: number; height: number }             // already blurred
export interface PageSample { raw: Uint8Array; width: number; height: number; quad: Quad; found: boolean; frameDiagonal: number } // warped gray, not normalized
export interface DetectorTriggerCore { reason: 'ink' | 'page'; t: number; mask: CellMask | null; cropRect: NormRect | null;
  quad: Quad; pageFound: boolean; changedCells: number; inkPixels: number; erasePixels: number }
export function createDetector(params?: Partial<DetectorParams>): {
  /** samplePage(size): the page warped to `size`, or to compareSize(quad) when size is null. Called only when stable. */
  step(t: number, motion: MotionSample, samplePage: (size: { width: number; height: number } | null) => PageSample): DetectorTriggerCore | null;
  stats(): Omit<DetectorStats, 'opencv'>;   // the frame loop adds `opencv`
  reset(): void;
};
```

- **The `step` algorithm.** Only the decision order is pinned here; the arithmetic follows the signatures.
  1. `busy = movingFraction(previous, motion) > busyFraction`. Busy sets `quiet = 0` and `stale = 0`, and returns null.
  2. Otherwise `quiet++`. Below `stableSamples`, return null.
  3. `page = samplePage(reference ? reference.size : null)`. If `largestCluster(darkCells(page.raw))` reaches `occlusionMinCells`, the sample is occluded: `quiet = 0`, return null. No reference is ever taken or replaced on an occluded sample.
  4. With no reference yet, this page becomes the reference, holding its size, quad and normalized gray, and `sheetInk` (the cells she has inked on this sheet) starts empty. Return null.
  5. If both quads were found and `quadShift > pageMoveFraction · frameDiagonal`: page event.
  6. `diff = compareCells(reference, normalized)`.
     - With `occlusionMinCells` or more solid cells (the page is clear, by step 3): `stale++`. At `staleSamples`, the reference becomes this page silently and `stale = 0`. Return null.
     - Otherwise `stale = 0`.
  7. Page event when either holds:
     - more than `bigChangeFraction` of all cells changed;
     - `sheetInk` holds at least `triggerMinCells` cells, the cells erased in `diff` cover `pageClearFraction` of them, and no cell gained ink.
  8. Any changed cell that wasn't in the last stable comparison sets `lastNewInkAt = t`.
  9. Trigger `ink` when all three hold: changed ≥ `triggerMinCells`, `t − lastNewInkAt ≥ quietInkMs`, and `t − lastTriggerAt ≥ minTriggerIntervalMs`. The mask is the changed cells; `cropRect` is their bounding box padded by one cell and clamped. The mask's inked cells join `sheetInk`, and its erased cells leave it. The page becomes the reference.
  10. With fewer than `triggerMinCells` changed and `t − refAt ≥ referenceRefreshMs`, the page becomes the reference.

  **A page event** makes this page the new reference at once, with its size recomputed from its own quad, and empties `sheetInk`. It is emitted (no mask or crop) when `t − lastTriggerAt ≥ minTriggerIntervalMs`. Otherwise it's held, and emitted on the first stable, clear sample after the interval ends.
- **`harness.ts`:**
  - it renders a paper-synth clip at 640×480, at t = 0, 200, 400 … ms, with noise off unless a test turns it on (`frameIndex` = t / 200);
  - motion is `blur3(boxDownsample(toGray(…), 160×120))`;
  - `samplePage(size)` warps the frame by the clip's true `pageQuadAt(t)`, plus optional seeded jitter of up to ±2 px per corner, to `size ?? compareSize(quad, 800, 16)`, with bilinear sampling (test-only code);
  - it returns the triggers and the last stats.
- **Test timing:** variant tests render up to 280 frames each, so they run with `{ timeout: 60_000 }`.

- [ ] **Step 1: Write the failing unit tests:**
  - `toGray uses the integer BT.601 weights`: pure red gives 76.
  - `movingFraction counts only pixels past delta`.
  - `boxBlur matches a naive blur on a 7×5 image`.
  - `normalizeLighting flattens a left-to-right gradient to 1.0 ± 0.02 away from the edges`.
  - `a cell changes at 6 ink pixels and not at 5`; `erasure counts as change`; `a cell over 50% changed is solid`.
  - `darkCells marks a uniform 60%-bright block, but not a cell crossed by a pen stroke, nor the cells of a dense handwritten label` (rendered `q0` at its clip size).
  - `largestCluster counts 4-connected cells only`.
  - `homography maps the corners exactly and invertH round-trips within 1e-9`.
  - `compareSize keeps the long side at 800 and floors the short side: Letter landscape gives 800×608`.
  - `parseParams keeps quietInkMs 2500 and drops quietInkMs -1 and unknown keys`.
  - `detector ignores busy samples, waits for five quiet ones, and makes the first stable, clear page the reference`.
  - `detector never takes a reference while dark cells cover the page`.
  - `a stale reference is replaced silently after five clear samples with solid cells`.
  - `±2 px quad jitter over 50 stable samples emits no page event and keeps the compare size`.
- [ ] **Step 2: Write the failing variant tests (`variants.test.ts`).** Each variant runs through the harness, and every expected trigger must match one actual trigger of the same reason within its tolerance:
  - `dfa-demo triggers three times, each mask covering only its new groups' cells`;
  - `dfa-short triggers once`, and `dfa-short with noise on, and with ±2 px quad jitter, still triggers once and never emits page`;
  - `hand-rests never triggers while the hand rests, and its one trigger's mask excludes the hand's cells`;
  - `starts-with-hand takes its first reference only after the hand leaves, and triggers only for q1`;
  - `shadow-pass, exposure-step and slow-drift never trigger`;
  - `slow-drift refreshes the reference by 31 s`;
  - `page-shift emits one page trigger and no ink trigger`;
  - `slide-and-hold emits one page trigger when the hand leaves, then ink for q1`;
  - `page-flip emits ink for q0, then one page trigger for the fresh sheet, and no erasure ink trigger`;
  - `dfa-demo never reads its printed statement, its margin line or a label as an occluder`;
  - `erase triggers ink with the label's cells`;
  - `no variant triggers twice within 5 s`.
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/detector`. Expected: FAIL.
- [ ] **Step 4: Implement the modules.**
- [ ] **Step 5: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test paper/detector && pnpm --filter @tassel/desktop typecheck`. Expected: PASS.
  - A variant failure means changing the algorithm, never the expected windows.
  - If a default really must change, change it in `DEFAULT_PARAMS`, give the reason in the task report, and recompute the windows in Task 6's table.
- [ ] **Step 6: Commit.** `git add apps/desktop && git commit -m "feat(paper): change-detector core with occlusion, page events and fixtures"`

### Task 8: Page finder and the detector worker

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/detector/opencv-page.ts`, `messages.ts`, `frame-loop.ts`, `worker.ts`, `client.ts`, `breakout-box.d.ts`
- Create: `apps/desktop/tsconfig.worker.json`. It sets `lib: ["ES2023", "WebWorker"]`, `noEmit`, `verbatimModuleSyntax`, and includes `src/renderer/src/paper/detector/**` and `src/renderer/src/paper/contracts.ts`.
- Modify: `apps/desktop/tsconfig.web.json` (exclude `src/renderer/src/paper/detector/worker.ts`). The worker's globals conflict with the DOM lib in one program.
- Modify: `apps/desktop/package.json`: devDependency `@techstark/opencv-js` 5.0.0-release.1, a devDependency like every desktop dependency; `typecheck` gains `&& tsc --noEmit -p tsconfig.worker.json`.
- Test: `apps/desktop/tests/unit/paper/detector/opencv-page.test.ts`, `frame-loop.test.ts`, `client.test.ts`

The page's CSP is not changed. The reason is under "OpenCV in the worker" below.

**Interfaces:**
- Consumes: `createDetector`, `DEFAULT_PARAMS`, `parseParams`, `toGray`, `blur3` and `compareSize` (Task 7); `DetectorTrigger`, `DetectorStats`, `Quad`, `NormRect` and `DETECTOR_VERSION` (`paper/contracts.ts`, Task 1).
- Produces:

```ts
// opencv-page.ts
export type Cv = any;                         // opencv-js ships loose typings
export function loadOpenCv(): Promise<Cv>;    // the default export is a Promise of cv; also accept an onRuntimeInitialized object
export function findPageQuad(cv: Cv, rgba: Uint8ClampedArray, width: number, height: number): Quad | null;
export function warpGray(cv: Cv, rgba: Uint8ClampedArray, width: number, height: number, quad: Quad, outW: number, outH: number): Uint8Array;
export function warpRgba(cv: Cv, rgba: Uint8ClampedArray, width: number, height: number, quad: Quad, outW: number, outH: number): Uint8ClampedArray;
// messages.ts
export type ToWorker =
  | { type: 'start'; readable: ReadableStream<VideoFrame>; params: Partial<DetectorParams>; contentRect: NormRect | null }
  | { type: 'stop' };
export type FromWorker =
  | { type: 'ready'; opencv: boolean } | { type: 'stats'; stats: DetectorStats }
  | { type: 'trigger'; trigger: DetectorTrigger } | { type: 'error'; message: string };
// frame-loop.ts: the worker's logic with its browser parts injected, so Node can test it
export interface FrameLike { timestamp: number; displayWidth: number; displayHeight: number; close(): void }
export interface FrameLoopDeps<F extends FrameLike> {
  detector: ReturnType<typeof createDetector>; params: DetectorParams; contentRect: NormRect | null;
  opencv: Promise<boolean>;                                               // settles once loadOpenCv has run
  readRgba(frame: F, width: number, height: number, crop: NormRect | null): Uint8ClampedArray;  // scaled draw inside crop
  findQuad(rgba: Uint8ClampedArray, width: number, height: number): Quad | null;
  warpGray(rgba: Uint8ClampedArray, width: number, height: number, quad: Quad, outW: number, outH: number): Uint8Array;
  encodeFull(frame: F, crop: NormRect | null): Promise<Blob>;
  encodeCrop(frame: F, quad: Quad, rect: NormRect, outW: number, outH: number): Promise<Blob>;
  now(): number; post(message: FromWorker): void;
}
export function createFrameLoop<F extends FrameLike>(deps: FrameLoopDeps<F>): { push(frame: F): Promise<void>; stop(): void };
// client.ts
export function createChangeDetector(stream: MediaStream, opts: { params?: Partial<DetectorParams>; contentRect?: NormRect | null;
  onStats(s: DetectorStats): void; onTrigger(t: DetectorTrigger): void; onError(message: string): void;
  createWorker?: () => Worker; createProcessor?: (track: MediaStreamTrack) => { readable: ReadableStream<VideoFrame> } }): { stop(): void };
// breakout-box.d.ts: a minimal ambient declaration of MediaStreamTrackProcessor, which TypeScript's DOM lib lacks
```

- **`findPageQuad`**, at a long side of 960 px:
  1. Otsu threshold (`THRESH_BINARY | THRESH_OTSU`), then a 5×5 morphological close.
  2. Take the largest external contour, and `approxPolyDP` at 0.02 × its arc length.
  3. Accept exactly 4 convex vertices covering at least 20% of the image. Order them TL, TR, BR, BL: min x+y is TL, max x+y is BR, max x−y is TR, min x−y is BL.
  4. Scale back to frame pixels. Anything else returns null.
  - Every `cv.Mat` is deleted in `finally`.
- **The frame loop:**
  - it samples one frame per `sampleIntervalMs`, by `frame.timestamp`; every frame it doesn't keep is closed immediately;
  - it keeps at most one frame, closing the previous one when it replaces it;
  - motion comes from `readRgba(frame, 160, 120)`;
  - until `opencv` settles, it posts motion-only stats and never calls `detector.step`, so the first reference always comes from the real page finder. If OpenCV fails to load, the whole run uses the fallback crop, and one `error` message says so. Every stats message carries `opencv`: false until OpenCV loads, and false for the rest of the run after a failure;
  - on a stable sample, it reads the frame at a long side of 960 and calls `findQuad`, keeping the last good quad when that returns null. It falls back to the central `fallbackCrop` region at 640×480 when no quad has ever been found. It answers `samplePage(size)` by warping to `size`, or to `compareSize(quad, 800, 16)` when `size` is null;
  - on a trigger:
    - `encodeFull` makes a JPEG at native size inside `contentRect`, at quality 0.9, with `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)). An unsupported type falls back to PNG, so assert the blob's type;
    - `encodeCrop` warps the color page at twice the compare size and crops it to `cropRect`, at quality 0.9;
    - `capturedAt` is the ISO time when the kept frame was sampled.
- **Frames in the worker:** `VideoFrame` is exposed in workers, is transferable, and can be drawn with `drawImage` ([IDL](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/modules/webcodecs/video_frame.idl)).
- **`client.ts`:**
  - It spawns a **classic** worker: `new Worker(new URL('./worker.ts', import.meta.url))`, with no `type: 'module'`. Vite bundles a worker's imports into one IIFE by default (`worker.format` is `'iife'`, [Vite](https://vite.dev/config/worker-options)), so OpenCV still arrives through `import`, and `importScripts` stays available for the fallback.
  - It creates `new MediaStreamTrackProcessor({ track })` in the window, through the `createProcessor` seam, and transfers `processor.readable`.
    - Chromium 152 exposes the processor on Window only ([IDL](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/modules/breakout_box/media_stream_track_processor.idl), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor)).
    - A track itself can't be transferred to a worker ([chromestatus](https://chromestatus.com/feature/5747241384935424)), but streams can ([chromestatus](https://chromestatus.com/feature/5298733486964736)).
  - If Task 1's check P failed, it uses the `requestVideoFrameCallback` sampler instead.
- **OpenCV in the worker:**
  - `@techstark/opencv-js`'s default export is a Promise that resolves to `cv`, with the WebAssembly embedded in the JS ([repo](https://github.com/TechStark/opencv-js)). Its embind code may also build functions with `new Function`.
  - It runs only in the worker, whose CSP comes from the worker script's own response, not from the page. Only local-scheme workers (`blob:`, `data:`) inherit their creator's policy (see Mike West's TAG note and [whatwg/html#11316](https://github.com/whatwg/html/issues/11316)). P1's `app://` handler sends no CSP header, so nothing blocks WebAssembly or `new Function` there.
  - The page's `<meta>` CSP stays exactly as P1 wrote it. **Never add `'unsafe-eval'` or `'wasm-unsafe-eval'` to the page.**
  - **Fallback:** if Vite can't bundle opencv-js into the worker, copy `opencv.js` to `src/renderer/public/` and load it in the same classic worker with `importScripts`, which works only in classic workers ("the importScripts() method will automatically fail inside module workers", [HTML](https://html.spec.whatwg.org/multipage/workers.html)). Say so in the report.

- [ ] **Step 1: Write the failing tests:**
  - `findPageQuad finds the dfa-demo page within 4 px of its true corners` (`// @vitest-environment node`; renders frame t=0 at 960×720; loads OpenCV once per file; `{ timeout: 30_000 }`).
  - `findPageQuad returns null on a frame of plain desk`.
  - `warpGray fills the output with page`: the mean of each 10×10 corner patch is above 235.
  - `frame loop samples every 200 ms and closes every frame it doesn't keep`: 60 fake frames at 30 fps lead to 10 samples, and every frame but the kept one has `close` called.
  - `frame loop posts stats once per sample`.
  - `frame loop never steps the detector before OpenCV settles, and falls back to the central crop when it fails`.
  - `frame loop warps to the detector's fixed size once a reference exists`.
  - `frame loop encodes the full frame at native size on trigger, and the crop inside the page`.
  - `createChangeDetector forwards stats and triggers, uses the processor seam, and terminates the worker on stop` (fake Worker, fake processor).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/detector`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.** `worker.ts` wires `createFrameLoop` to `OffscreenCanvas`, `loadOpenCv` and `postMessage`.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e shell`. Expected: PASS. The build emits a classic worker chunk containing OpenCV, and the shell spec still refuses inline scripts under P1's unchanged CSP.
  - In the task report, record where OpenCV initializes (the worker), which CSP applies there (none, as above), and whether the bundle or the `importScripts` fallback is used. Task 13's E2E proves it in the running app: the uploaded frame has `page_found: true`, and the console shows no CSP violation.
- [ ] **Step 5: Commit.** `git add apps/desktop pnpm-lock.yaml && git commit -m "feat(paper): OpenCV page finder and change-detector worker"`

### Task 9: Main-process paper plumbing

**Files:**
- Create: `apps/desktop/src/main/paper/config.ts`, `switches.ts`, `display-media.ts`, `helper-path.ts`, `helper-supervisor.ts`, `camera-access.ts`, `lifecycle.ts`, `ipc.ts`
- Modify:
  - `apps/desktop/src/shared/bridge.ts` (`paper: PaperBridge` on `TasselBridge`);
  - `apps/desktop/src/preload/index.ts` (expose `paper`);
  - `apps/desktop/src/main/ipc.ts` (export its `handle` as `handleTrusted`; no behavior change: every paper channel takes no arguments);
  - `apps/desktop/src/main/index.ts`:
    - `applyPaperSwitches(app.commandLine)` right after `applyUserDataOverride()`;
    - after ready, `registerDisplayMedia(session.defaultSession, …)`, `registerPaperIpc(…)` and `bindHelperToApp(app, helper)`.
- Test: `apps/desktop/tests/unit/paper/main/config.test.ts`, `switches.test.ts`, `display-media.test.ts`, `helper-path.test.ts`, `helper-supervisor.test.ts`, `camera-access.test.ts`, `lifecycle.test.ts`, `ipc.test.ts`

**Interfaces:**
- Consumes: `paper-bridge.ts`, which Task 1 committed with exactly the first block below.
- Produces:

```ts
// shared/paper-bridge.ts (committed in Task 1; plus openDeskViewApp if check D failed)
export type PaperSourceKind = 'deskview-helper' | 'window-capture' | 'fake-clip' | 'screen';
export type CameraAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
export interface PaperConfig { source: PaperSourceKind | 'auto'; debug: boolean; helperClip: boolean; fakeClip: boolean; params: Record<string, number> }
export type HelperStart = { ok: true; url: string; token: string } | { ok: false; reason: 'unsupported' | 'missing-binary' | 'spawn-failed' | 'timeout' };
export interface PaperBridge {
  getConfig(): Promise<PaperConfig>; startHelper(): Promise<HelperStart>; stopHelper(): Promise<void>;
  cameraAccess(): Promise<CameraAccess>; requestCameraAccess(): Promise<boolean>; openCameraSettings(): Promise<void>;
}
export const PAPER_IPC = { getConfig: 'paper:getConfig', startHelper: 'paper:startHelper', stopHelper: 'paper:stopHelper',
  cameraAccess: 'paper:cameraAccess', requestCameraAccess: 'paper:requestCameraAccess', openCameraSettings: 'paper:openCameraSettings' } as const;
// main/paper/config.ts
export interface PaperSettings { config: PaperConfig; fakeClipPath: string | null; helperClipPath: string | null; helperPathOverride: string | null;
  helperTag: string | null; fakeDisplay: 'self' | null; fakeCameraAccess: CameraAccess | null; requireFake: boolean }
export function readPaperSettings(env?: NodeJS.ProcessEnv, packaged?: boolean, exists?: (p: string) => boolean): PaperSettings;
// main/paper/*
export function applyPaperSwitches(commandLine: { appendSwitch(name: string, value?: string): void }, settings?: PaperSettings): void;
export function registerDisplayMedia(session: Session, opts: { platform: NodeJS.Platform; macosMajor: number | null; fakeDisplay: 'self' | null;
  requireFake: boolean; getSources: typeof desktopCapturer.getSources; isTrusted(url: string): boolean }): void;
export function helperPath(settings: PaperSettings, at: { packaged: boolean; resourcesPath: string; startDir: string; platform: NodeJS.Platform;
  exists(p: string): boolean }): string | null;
export interface HelperSupervisor { start(): Promise<HelperStart>; stop(): Promise<void> }
export function createHelperSupervisor(deps: { path: string | null; platform: NodeJS.Platform; clip: string | null; tag: string | null;
  requireFake: boolean; spawn: typeof import('node:child_process').spawn; randomToken(): string; readyTimeoutMs?: number; log(line: string): void }): HelperSupervisor;
export function createCameraAccess(deps: { platform: NodeJS.Platform; systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus' | 'askForMediaAccess'>;
  openExternal(url: string): Promise<void>; fake: CameraAccess | null; requireFake: boolean; log(line: string): void }): { status(): CameraAccess; request(): Promise<boolean>; openSettings(): Promise<void> };
export function bindHelperToApp(app: { on(event: 'will-quit', listener: () => void): unknown }, helper: HelperSupervisor): void;
export function registerPaperIpc(deps: { config: PaperConfig; helper: HelperSupervisor; camera: ReturnType<typeof createCameraAccess> }): void;
```

- **`readPaperSettings`:**
  - `config.source` is a known value or `auto`;
  - `config.debug` is `TASSEL_PAPER_DEBUG === '1'`;
  - `config.helperClip` means `TASSEL_HELPER_CLIP` names an existing file;
  - `config.fakeClip` means the source is `fake-clip` and `TASSEL_FAKE_CLIP` names an existing file;
  - `config.params` is the finite numbers in `TASSEL_PAPER_PARAMS`; invalid JSON gives `{}` with one warning;
  - `requireFake` is `TASSEL_REQUIRE_FAKE_CAPTURE === '1'`;
  - **when packaged:** the source is honored only as `auto`, `deskview-helper` or `window-capture` (anything else becomes `auto`), every fake, clip, tag and override is null or off, and `requireFake` is false.
- **`applyPaperSwitches`:** only when not packaged, the source is `fake-clip` and the clip exists, it appends `use-fake-device-for-media-stream` and `use-file-for-fake-video-capture=<absolute path>`. A missing file logs its path and appends nothing, and the renderer then shows the unavailable state without calling `getUserMedia` (Task 10).
  - Switches must be appended before `ready` ([command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)); Electron's own test runner appends `use-fake-device-for-media-stream` this way ([spec/index.js](https://github.com/electron/electron/blob/44-x-y/spec/index.js)).
  - The file switch is read only inside the fake-device branch, so it needs both ([create_video_capture_device_factory.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/create_video_capture_device_factory.cc), [media_switches.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/base/media_switches.cc)).
- **`registerDisplayMedia`** ([setDisplayMediaRequestHandler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts); [44-x-y source](https://github.com/electron/electron/blob/44-x-y/docs/api/session.md)):
  - every request whose `securityOrigin` fails `isTrusted` is denied. A frame grant captures the whole webContents;
  - `fakeDisplay === 'self'` (not packaged): the handler answers `callback({ video: request.frame })`, which captures the tab holding that frame, with no system picker;
  - otherwise, with `requireFake`, every request is denied;
  - otherwise, on darwin 15 or later (`process.getSystemVersion()`, [doc](https://www.electronjs.org/docs/latest/api/process)): `{ useSystemPicker: true }`. It is experimental and macOS 15+, and when the picker exists the handler is never invoked;
  - on darwin before 15, the handler denies (R16);
  - elsewhere, the handler grants `(await getSources({ types: ['screen'] }))[0]` ([desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer));
  - **"Deny"** always means `callback(null)`, which rejects `getDisplayMedia` with an AbortError, including for a null `request.frame`. An empty `{}` would make Electron throw "Video was requested, but no video stream was provided".
- **`helperPath`:**
  - `TASSEL_DESKVIEW_HELPER` if set;
  - packaged: `<resourcesPath>/deskview-helper`, which P10 places;
  - otherwise it walks up from `startDir` (`__dirname`, which is `out/main`) at most six levels, to the first directory holding `native/deskview-helper/Package.swift`, and returns `native/deskview-helper/.build/release/deskview-helper` under it. This works for `pnpm dev`, Playwright and LaunchServices launches alike;
  - null off darwin, or when nothing is found.
- **Supervisor:**
  - off darwin, `start()` returns `unsupported` without spawning;
  - with `requireFake` and no clip, `start()` returns `unsupported` without spawning;
  - one process at a time: a second `start()` while one runs returns that handle;
  - a `start()` while a `stop()` is pending waits for the old process to exit, then spawns a fresh one;
  - the token is 32 random bytes in hex;
  - the child's env is `PATH`, `HOME`, `TMPDIR`, `TASSEL_HELPER_TOKEN` and, when set, `TASSEL_HELPER_CLIP`; argv is `--tag <tag>` when a tag is set, else empty;
  - stdio is `['pipe', 'pipe', 'pipe']`, and stdin stays open, so the helper exits if Electron dies;
  - the ready line, within `readyTimeoutMs` (5000), gives `{ ok: true, url: 'ws://127.0.0.1:<port>', token }`;
  - a timeout kills the child and returns `timeout`; ENOENT returns `missing-binary`; an exit before the ready line, or any other spawn error, returns `spawn-failed`;
  - stderr lines go to `log`;
  - `stop()` sends SIGTERM, then SIGKILL after 2 s;
  - an unexpected exit clears the handle.
- **Camera access** ([systemPreferences docs](https://www.electronjs.org/docs/latest/api/system-preferences)):
  - on darwin it maps `getMediaAccessStatus('camera')`; elsewhere it returns `unknown`;
  - `request()` calls `askForMediaAccess('camera')`;
  - with `requireFake`, `request()` returns false and never prompts;
  - with `TASSEL_FAKE_CAMERA_ACCESS` set (not packaged), `status()` returns the fake, `request()` returns `fake === 'granted'`, and `openSettings()` logs `[tassel] fake: open camera settings` instead of opening anything;
  - otherwise `openSettings()` opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Camera` with `shell.openExternal`, which goes through `NSWorkspace`.
    - Apple doesn't document these links. On macOS 26.6.2 the Privacy & Security extension still accepts that id and contains `Privacy_Camera`, and through `NSWorkspace.open` they have worked where `open <url>` failed ([forum 709289](https://developer.apple.com/forums/thread/709289)).
    - Task 14 has the owner confirm the pane opens.
- **`bindHelperToApp`:** on `will-quit`, it calls `helper.stop()`. SIGTERM goes out synchronously, and the helper's stdin EOF covers a crash.
- **If Task 1's check E failed:** `index.ts` applies the `TASSEL_*` keys of `--tassel-env-file=<json>` to `process.env` before anything reads the config, only when not packaged. That gets a test too.
- **If check D failed:** `paper:openDeskViewApp` calls `shell.openPath('/System/Library/CoreServices/Applications/Desk View.app')`.

- [ ] **Step 1: Write the failing tests** (mocked `electron` and `child_process`, as in P1's `ipc.test.ts`):
  - **config:**
    - `defaults to auto with fakes off`;
    - `reads every variable`;
    - `a packaged app ignores every fake and keeps only auto, deskview-helper and window-capture`;
    - `bad params JSON gives {}`.
  - **switches:**
    - `appends both switches with the absolute clip path`;
    - `nothing when packaged`;
    - `nothing and one error line when the clip is missing`;
    - `nothing for other sources`.
  - **display-media:**
    - `the self fake answers with request.frame`;
    - `a null frame denies with callback(null)`;
    - `an untrusted securityOrigin is denied`;
    - `requireFake without self denies`;
    - `darwin 15 sets useSystemPicker true`;
    - `darwin 14 denies`;
    - `win32 grants the first screen`;
    - `no sources denies with callback(null)`.
  - **helper-path:**
    - `the env override wins`;
    - `finds the repo from out/main`;
    - `packaged uses resourcesPath`;
    - `null off darwin`.
  - **supervisor:**
    - `resolves url and token from the ready line`;
    - `the token is 64 hex characters and reaches the child only through its env`: never argv, and none of the parent's other variables;
    - `passes --tag when a tag is set`;
    - `times out after 5 s and kills the child` (fake timers);
    - `ENOENT is missing-binary; an exit before ready is spawn-failed`;
    - `a second start reuses the process`;
    - `a start during a stop waits for the exit, then spawns fresh` (React StrictMode's remount);
    - `stop sends SIGTERM, then SIGKILL after 2 s`;
    - `unsupported off darwin, or with requireFake and no clip, without spawning`.
  - **camera-access:**
    - `maps each status`;
    - `the fake overrides`;
    - `requireFake never prompts`;
    - `openSettings uses the Privacy_Camera URL`.
  - **lifecycle:** `will-quit stops the helper` (Review Focus 2).
  - **ipc:** `every paper channel refuses an untrusted sender`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/main`. Expected: FAIL.
- [ ] **Step 3: Implement the modules and the wiring.**
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e shell`. Expected: PASS. The shell spec still sees `window.tassel`, now with `paper`.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(desktop): paper bridge, helper supervisor, display media and capture guards"`

### Task 10: Paper sources and the paper store

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/types.ts`, `select-source.ts`, `paper-store.ts`
- Create: `apps/desktop/src/renderer/src/paper/sources/helper-protocol.ts`, `deskview-helper.ts`, `canvas-feed.ts`, `fake-clip.ts`, `window-capture.ts`, `screen.ts`, `content-crop.ts`
- Test: `apps/desktop/tests/unit/paper/sources/select-source.test.ts`, `helper-protocol.test.ts`, `deskview-helper.test.ts`, `content-crop.test.ts`, `display-sources.test.ts`, `paper-store.test.ts`

**Interfaces:**
- Consumes: `PaperBridge`, `PaperSourceKind` and `PaperConfig` (`shared/paper-bridge.ts`, wired in Task 9); `Pt`, `Quad`, `NormRect`, `CellMask`, `DetectorStats` and `UploadStats` (`paper/contracts.ts`, Task 1).
- Produces:

```ts
// types.ts
export type { Pt, Quad, NormRect, CellMask, DetectorStats, UploadStats, PaperSourceKind } from './contracts';
export type PaperStatus = 'idle' | 'starting' | 'live' | 'off' | 'denied' | 'unavailable' | 'lost' | 'ended' | 'error';
export interface HelperDevice { id: string; name: string; builtIn: boolean }
export interface PaperFeed { kind: PaperSourceKind; stream: MediaStream; contentRect: NormRect | null; devices: HelperDevice[];
  onEnd(listener: (reason: 'lost' | 'ended') => void): () => void; stop(): void }
export interface PaperSource { readonly kind: PaperSourceKind; start(opts: { deviceId?: string | null; signal: AbortSignal }): Promise<PaperFeed> }
export class PaperSourceError extends Error { constructor(readonly code: 'denied' | 'unavailable' | 'cancelled' | 'aborted' | 'error', message?: string) }
// select-source.ts
export const MACOS_DEFAULT: PaperSourceKind;            // set from Task 1's verdict H
export function choosePaperSource(configured: PaperSourceKind | 'auto', platform: Platform): PaperSourceKind | null; // R15
export function shouldUpload(kind: PaperSourceKind): boolean;                       // false only for 'screen'
export function needsCameraAccess(kind: PaperSourceKind, config: PaperConfig): boolean; // helper without a clip
export function createPaperSource(kind: PaperSourceKind, deps: SourceDeps): PaperSource;
export interface SourceDeps { bridge: PaperBridge; config: PaperConfig; mediaDevices: MediaDevices; WebSocketCtor?: typeof WebSocket; document?: Document;
  decodeImage?: (jpeg: Uint8Array) => Promise<ImageBitmap>; createFeed?: typeof createCanvasFeed }   // test seams; defaults are the browser's
// sources/helper-protocol.ts: the TypeScript mirror of protocol v1
export function decodeFrame(buffer: ArrayBuffer): { seq: number; ptsMicros: number; width: number; height: number; jpeg: Uint8Array };
export type HelperServerMessage = /* welcome | devices | status | error | setup, as in Global Constraints */;
export function parseServerMessage(text: string): HelperServerMessage | null;
export function openDeskViewSetup(deps: { bridge: PaperBridge; WebSocketCtor: typeof WebSocket }): Promise<'presented' | 'failed'>;
// sources/canvas-feed.ts
export function createCanvasFeed(doc?: Document): { stream: MediaStream; draw(bitmap: ImageBitmap): void; stop(): void };
// sources/content-crop.ts
export function findContentTop(gray: Uint8Array, width: number, height: number): number;
// paper-store.ts
export interface PaperStore {
  kind: PaperSourceKind | null; status: PaperStatus; stream: MediaStream | null; contentRect: NormRect | null;
  devices: HelperDevice[]; deviceId: string | null; override: PaperSourceKind | null; restartNonce: number; retrying: boolean;
  stats: DetectorStats | null; uploads: UploadStats;
  setStatus(s: PaperStatus): void; setFeed(f: PaperFeed | null): void; setStats(s: DetectorStats | null): void; setUploads(u: UploadStats): void;
  retry(): void; useInstead(kind: PaperSourceKind): void; useDevice(id: string): void; reset(): void;
}
export const usePaperStore: UseBoundStore<StoreApi<PaperStore>>;
```

- **`choosePaperSource`:** a configured kind wins. `auto` gives `MACOS_DEFAULT` on darwin and `null` elsewhere (R15); the controller shows `unavailable` for null.
- **Every source honors `signal`.**
  - It checks `signal.aborted` before each side effect: starting the helper, `getUserMedia`, `getDisplayMedia`.
  - A start aborted midway releases what it already holds, then rejects with `aborted`.
  - Every failure releases everything too: the helper source closes its socket and calls `bridge.stopHelper()`, so a later `openDeskViewSetup` never meets `busy`.
- **The helper source:**
  1. `bridge.startHelper()`; not ok → `unavailable`.
  2. Open the WebSocket with `binaryType = 'arraybuffer'`, and send `hello` before anything else.
     - On `welcome`, camera `notDetermined` calls `bridge.requestCameraAccess()`, and a refusal gives `denied`.
     - Then `list`, then `start { deviceId, fps: 15, maxWidth: 1920, quality: 0.85 }`.
  3. It resolves on the first frame, within 8 s; otherwise `error`.
  4. Each frame goes through `createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))` into the canvas feed. While a decode is in flight, newer frames replace older ones, so the latest wins.
  5. Error mapping:
     - `welcome` with camera `denied` or `restricted`, or `error permission-denied` → `denied`;
     - `error no-device` → `unavailable`;
     - a close before the first frame → `error`;
     - after it goes live, a close or `error device-lost` → `onEnd('lost')`.
  6. `stop()` sends `stop`, closes the socket and calls `bridge.stopHelper()`.
- **The canvas feed:**
  - `canvas.captureStream(0)` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)), plus `requestFrame()` after each draw;
  - the canvas resizes to each bitmap, and every bitmap is closed after drawing;
  - not `MediaStreamTrackGenerator`, which is non-standard, and not `VideoTrackGenerator`, which Chromium 152 hides behind a test flag ([IDL](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/modules/breakout_box/video_track_generator.idl)).
- **Fake clip:**
  - Without `config.fakeClip` (the clip file is missing), it rejects with `unavailable` and never calls `getUserMedia`. Without the fake device, that call would reach a real camera.
  - Otherwise: `mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })`.
  - `NotFoundError` or `NotReadableError` → `unavailable`; the track ending → `lost`.
  - In file mode Chromium shows one device, labelled with the file path. It plays at 30 fps and loops ([factory](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/create_video_capture_device_factory.cc), [file device](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/file_video_capture_device.cc)).
  - `app://tassel` is a secure context, so `getUserMedia` is available there ([is_potentially_trustworthy.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/services/network/public/cpp/is_potentially_trustworthy.cc)).
  - If Task 1's check F failed, this source is the in-renderer player described there.
- **Window capture:**
  - `getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })`;
  - `NotAllowedError` (picker cancelled, or Screen Recording refused) → `cancelled`; `AbortError` (the handler denied) → `unavailable`;
  - on the first frame, `findContentTop` runs on a grayscale draw of the video, and gives `contentRect = { x: 0, y: top/h, w: 1, h: 1 − top/h }`;
  - the track ending → `ended`.
- **Screen:** `getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false })`, with the same error mapping; the track ending → `ended`.
- **`findContentTop`:**
  - scan rows 0 to `floor(0.15·h)`;
  - for each row, take the mean and standard deviation over x from `0.4·w` to `w` (this skips the traffic lights);
  - the title band is the longest prefix of rows whose standard deviation is under 4 and whose mean is within 6 of row 0's (0–255 units);
  - return the band's height if it is at least `0.02·h`, else 0.

- [ ] **Step 1: Write the failing tests:**
  - **Selection:**
    - `choosePaperSource: configured wins; auto picks MACOS_DEFAULT on darwin and null on win32 and linux`;
    - `shouldUpload is false only for screen` (ruling R7).
  - **Protocol:**
    - `decodeFrame reads the contract fixture`: the Global Constraints hex gives seq 7, pts 1234567, 4×3 and a 4-byte JPEG. It rejects bad magic, a buffer under 24 bytes and version 2;
    - `parseServerMessage reads kebab error codes and returns null for an unknown type`.
  - **Helper source** (FakeSocket, with `decodeImage` and `createFeed` stubbed):
    - `sends hello with the token first, then list and start with fps 15`;
    - `resolves after the first binary frame with the helper's devices`;
    - `welcome notDetermined asks for access once, and a refusal gives denied`;
    - `permission-denied → denied; no-device → unavailable; close before the first frame → error`;
    - `close after live ends the feed with lost`, and `error device-lost after live ends the feed with lost` (Review Focus 3);
    - `every start failure closes the socket and stops the helper`;
    - `an aborted start closes the socket, stops the helper and rejects with aborted`;
    - `stop sends stop, closes the socket and stops the helper`;
    - `startHelper not ok → unavailable`.
  - **`findContentTop`:** a 40-row band over noise gives 40; noise from row 0 gives 0; a 40-row band with traffic-light circles at the left gives 40; a 10-row band at 720 high gives 0.
  - **Display sources:**
    - `window capture maps NotAllowedError to cancelled, AbortError to unavailable, and its ended track to ended`;
    - `fake clip without config.fakeClip rejects unavailable and never calls getUserMedia`;
    - `fake clip maps NotFoundError to unavailable and its ended track to lost`;
    - `screen requests at most 10 fps`;
    - `an aborted signal stops before getDisplayMedia or getUserMedia is called`.
  - **Paper store:**
    - `retry bumps restartNonce and sets retrying`;
    - `useInstead sets the override and bumps restartNonce`;
    - `useDevice sets deviceId and bumps restartNonce`;
    - `reset clears everything`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/sources`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.** Set `MACOS_DEFAULT` from `docs/research/spikes/p3-tcc/RESULTS.md`, and cite the verdict in a one-line comment.
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(paper): PaperSource for the helper, window capture, fake clip and screen"`

### Task 11: Frame uploader

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/upload/frame-meta.ts`, `frames-api.ts`, `frame-uploader.ts`
- Test: `apps/desktop/tests/unit/paper/upload/frame-meta.test.ts`, `frames-api.test.ts`, `frame-uploader.test.ts`

**Interfaces:**
- Consumes: the regenerated `components['schemas']['FrameOut']`, `ApiClient`, `ApiError` and `UnauthorizedError` (Task 5 and P1, `@tassel/shared/api`); `DetectorTrigger`, `UploadStats`, `PaperSourceKind` and `DETECTOR_VERSION` (`paper/contracts.ts`, Task 1); `Clock` (P1's `tutor/clock.ts`).
- Produces:

```ts
export interface FrameMetaJson {
  reason: 'ink' | 'page'; source: PaperSourceKind; captured_at: string; page_found: boolean;
  page_quad: Array<{ x: number; y: number }> | null; crop_rect: { x: number; y: number; w: number; h: number } | null;
  mask: { cols: number; rows: number; cells: Array<[number, number]> } | null;
  detector: { changed_cells: number; ink_pixels: number; erase_pixels: number; version: string };   // version = DETECTOR_VERSION
}
export function buildFrameMeta(trigger: DetectorTrigger, source: PaperSourceKind): FrameMetaJson;
export type FrameOut = components['schemas']['FrameOut'];
export interface FrameParts { full: Blob; crop: Blob | null; meta: FrameMetaJson }
export async function uploadFrame(api: ApiClient, sessionId: string, parts: FrameParts): Promise<FrameOut>;   // throws ApiError
export async function listFrames(api: ApiClient, sessionId: string, limit?: number): Promise<FrameOut[]>;
export async function getFrameImage(api: ApiClient, sessionId: string, frameId: string, part: 'full' | 'crop'): Promise<Blob>;
export function createFrameUploader(opts: { upload(parts: FrameParts): Promise<unknown>; onStats(s: UploadStats): void;
  clock?: Clock; maxQueue?: number; retryDelaysMs?: number[] }): { enqueue(parts: FrameParts): void; stop(): void };
```

- **Multipart.** `uploadFrame` uses openapi-fetch's `bodySerializer` to build `FormData`: `frame` = `full`, then `crop` when present, then `meta` = `JSON.stringify(meta)`. openapi-typescript types the binary parts as `string`, so the body passes through a cast in that one place.
- **Uploader policy:**
  - one upload at a time, in FIFO order;
  - `maxQueue` is 3. When the queue is full, drop the oldest queued `ink` item (a `page` item outlives ink) and count it as failed;
  - a network error or 5xx retries after 1000, 2000 and 4000 ms, then drops the item with `lastError` `offline` (network) or `server` (5xx);
  - 429 waits `Retry-After` seconds (default 1, readable through CORS since Task 5) and doesn't use up an attempt, up to 5 times;
  - 413, 415 or 422 drops the item at once, with `lastError` `rejected`;
  - P1's `UnauthorizedError` (the token refresh failed) drops the item with `lastError` `auth`, and the uploader keeps going;
  - 404 stops the uploader for good, with `lastError` `gone` (the session was deleted);
  - the first success clears `lastError`.

- [ ] **Step 1: Write the failing tests:**
  - `buildFrameMeta matches the server's example`: it reads `services/server/tests/frames/frame-meta-example.json` (relative from the test file), builds from the equivalent trigger, and deep-equals it. This is the contract across languages.
  - `uploadFrame posts frame, crop and meta parts to /v1/sessions/<id>/frames` (a fake fetch inspects the `FormData`).
  - `uploads one at a time, in order`.
  - `5xx retries at 1, 2 and 4 s, then fails with server` (manual clock).
  - `429 waits for Retry-After without spending an attempt`.
  - `422 drops at once with rejected`.
  - `UnauthorizedError drops the item with auth and the next upload still runs`.
  - `404 stops the uploader with gone`.
  - `a full queue drops the oldest ink item and keeps page items`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/upload`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.**
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(paper): frame uploader with retries, queue cap and the frames API client"`

### Task 12: Capture controller, paper panel and heatmap

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/use-paper-capture.ts`, `paper-config.ts`, `PaperPanel.tsx`, `PaperVideo.tsx`, `PaperStateCard.tsx`, `PaperTopLineExtras.tsx`, `glyphs.tsx`, `crop-transform.ts`, `debug/Heatmap.tsx`
- Modify:
  - `packages/shared/src/styles/tokens.css`: `--color-desk: #cdc4b6`, the mock's desk, shown only behind a live feed;
  - `packages/shared/src/i18n/en.json`, `es.json`, `ko.json`: the `paper.*` keys below.
- Test: `apps/desktop/tests/unit/paper/use-paper-capture.test.tsx`, `paper-panel.test.tsx`, `crop-transform.test.ts`, `heatmap.test.tsx`

**Interfaces:**
- Consumes: Tasks 8, 10 and 11; `parseParams`, `homography` and `invertH` (Task 7); from P1, `useApi`, `Source`, `Button`, `useStageStore` (its `toggleCamera`), and `common.retry` with the `session.placeholder.*.tag` keys.
- Produces:

```ts
// paper-config.ts: the paper config, loaded once at boot (Task 13) so render-time code reads it synchronously
export const DEFAULT_PAPER_CONFIG: PaperConfig;       // { source: 'auto', debug: false, helperClip: false, fakeClip: false, params: {} }
export function setPaperConfig(c: PaperConfig): void;
export function getPaperConfig(): PaperConfig;        // DEFAULT_PAPER_CONFIG until set
export function usePaperConfig(): PaperConfig;
// use-paper-capture.ts
export interface CaptureDeps { bridge: PaperBridge | null; platform: Platform; api: ApiClient; mediaDevices: MediaDevices;
  createSource: typeof createPaperSource; createChangeDetector: typeof createChangeDetector; createUploader: typeof createFrameUploader;
  now(): number; setInterval: typeof setInterval; clearInterval: typeof clearInterval }
export function usePaperCapture(args: { sessionId: string; sessionSource: Source | null; cameraOn: boolean; deps?: Partial<CaptureDeps> }): void;
export function usePaperTag(): string;   // the paper panel's tag and region name
export function usePaperLive(): boolean; // status === 'live': the title strip's red dot (R29)
// PaperPanel.tsx and friends
export function PaperPanel({ fallback }: { fallback: ReactNode }): JSX.Element;  // the paper panel's body, inside P1's Panel, under its TopLine
export function PaperTopLineExtras(): JSX.Element | null;                        // after P1's PinIndicator in the TopLine
export function cropTransform(video: { w: number; h: number }, crop: NormRect | null, box: { w: number; h: number }):
  { scale: number; x: number; y: number };                                       // contain-fit of the crop region, in CSS pixels
```

- **The controller.** It is mounted once per session screen, so capture continues while the board fills the stage.
  - It does nothing until `sessionSource === 'paper'`. `sessionSource` is null while the session loads.
  - With no `window.tassel.paper` (P1's unit tests stub only `platform`), it stays `idle`. It never throws.
  - **The uploader** lives as long as the session screen: created on mount, stopped on unmount. Turning the camera off never drops queued uploads.
  - **Runs.** The source and the change detector live for one camera-on run, which reruns on `cameraOn`, `override`, `deviceId` and `restartNonce`.
    - Each run has its own `AbortController`. Its first act is `await Promise.resolve()`, then a check of `signal.aborted`. React StrictMode's mount, cleanup, mount therefore starts the source once, and never opens two pickers.
    - Cleanup aborts the run. A feed that resolves after its run was aborted is stopped at once.
  - **Camera off:** stop the source and the detector, and release the helper; status `off`.
  - **Camera on:**
    1. Status `starting`. The kind is `override ?? choosePaperSource(config.source, platform)`, and null gives `unavailable`.
    2. If `needsCameraAccess`, and the run didn't come from `retry()`: `bridge.cameraAccess()`. `not-determined` asks once with `requestCameraAccess`; `denied` or `restricted` gives `denied` without starting the helper.
       - A retry skips this check. Electron's answer can stay stale until the app restarts ([systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences)), so the fresh helper's `welcome` decides.
       - The run clears `retrying` when it settles.
    3. `createSource(kind).start({ deviceId, signal })`. Errors map to statuses: `denied` → `denied`, `unavailable` → `unavailable`, `cancelled` → `ended`, `aborted` → nothing, anything else → `error`.
    4. `setFeed`, then status `live`.
    5. `createChangeDetector(stream, { params: parseParams(config.params), contentRect })`. Its stats go to the store; each trigger goes to `uploader.enqueue({ full, crop, meta: buildFrameMeta(trigger, kind) })` when `shouldUpload(kind)`.
  - **Feed endings:**
    - `feed.onEnd(reason)` sets the status to that reason, and stops the detector and the feed.
    - **Frame watchdog** (camera kinds only: `deskview-helper`, `fake-clip`, `window-capture`): if no stats arrive for 3000 ms while `live`, the status becomes `lost` and the feed stops. A static screen may legitimately send no frames, so `screen` has no watchdog. This keeps the red dot honest (R29).
  - **Unmount** stops the detector, the feed and the uploader, and resets the store.
- **Where things sit.** P1's `Stage` keeps its paper `Panel` (16px radius, overflow hidden) and its `TopLine`, which holds the tag, R17's `PinIndicator` and then `PaperTopLineExtras`. "The pinned state is always visible" (P1 design checklist §4.2), so P3 never draws a tag or a row of its own at the top of the panel.
  - **Tag text** (`usePaperTag`):
    - `deskview-helper`, `fake-clip` and no kind yet: P1's `session.placeholder.paper.tag` ("Your paper · Desk View"). The fake clip stands in for Desk View, so P1's specs keep finding the panel by that name;
    - `window-capture`: `paper.tag.window`;
    - `screen`: P1's `session.placeholder.screen.tag`.
  - **The body** (`PaperPanel`):
    - `idle`: `fallback`, which is P1's `Waiting` ("Waiting for Desk View").
    - `live`: `PaperVideo` on `bg-desk`, contain-fit through `cropTransform`. With the debug toggle on, the `Heatmap` canvas sits over the video, sized by `devicePixelRatio`.
    - Every other state: `PaperStateCard`. The card is a fixed 320px wide, centered and clipped by the panel during P1's 240 ms reflow (P1 checklist §4.3), on paper, with `role="status"`. It holds:
      - a 32px line glyph from `glyphs.tsx`, drawn in `icons.tsx`'s hand (1.6 stroke);
      - the title (Geist 17/520, ink);
      - the body, if the state has one (14/400, smoke-text, `text-wrap: pretty`; P1's `:lang(ko)` rule keeps Hangul words whole);
      - the actions, as pills: the first is the ink primary, the rest ghost.
    - No spinner: `starting` is static text.
    - Debug only: a pill at the panel's bottom right holds the heatmap toggle and `paper.debug.stats`, plus `paper.debug.noOpenCv` when the worker fell back.
  - **`PaperTopLineExtras`** (each `pointer-events-auto`, because the TopLine itself isn't):
    - "Switch camera" (`paper.devices.switch`) when there's more than one device: a 26px paper pill with a hairline, sans 13/520, cycling `useDevice`;
    - after an upload failure with `lastError` `offline`, `server` or `auth`, a 26px paper pill with a hairline holding `paper.upload.failing` (sans 13, ink), until the next success.
  - **The heatmap:**
    - changed cells filled with sky (`--color-sky`) at 55% opacity;
    - solid cells in ink at 25%;
    - the page quad as a 1.5px dashed ink line;
    - each cell drawn as a quad through `invertH(homography(quad → page))`.
  - **No iris** anywhere in the panel.
- **Actions by state:**
  - `off`: Turn camera on (`toggleCamera`).
  - `denied`: Open System Settings (`openCameraSettings`), then Retry.
  - `unavailable`: Open Desk View setup (Task 10's `openDeskViewSetup`, or `paper.openDeskViewApp()` if Task 1's D failed), then Share the Desk View window instead (`useInstead('window-capture')`).
  - `lost` and `error`: Retry.
  - `ended`: Share again (Retry).
- **Copy** (exact). Keys are camelCase, and ICU placeholders must match across the three languages. The retry button reuses `common.retry`, and the title strip keeps P1's `session.source.*` and `session.liveSource.*` through `SourceLabel`.

| Key | en | es | ko |
|---|---|---|---|
| `paper.tag.window` | Your paper · Desk View window | Tu papel · Ventana de Desk View | 내 종이 · Desk View 창 |
| `paper.state.starting.title` | Getting your paper ready… | Preparando tu papel… | 종이를 준비하고 있어요… |
| `paper.state.off.title` | Camera is off | La cámara está apagada | 카메라가 꺼져 있어요 |
| `paper.state.off.body` | Turn it on when you want Ada to see your paper. | Enciéndela cuando quieras que Ada vea tu papel. | Ada가 종이를 보게 하려면 카메라를 켜 주세요. |
| `paper.state.off.action` | Turn camera on | Encender la cámara | 카메라 켜기 |
| `paper.state.denied.title` | Tassel can't use the camera | Tassel no puede usar la cámara | Tassel이 카메라를 사용할 수 없어요 |
| `paper.state.denied.body` | Allow camera access for Tassel in System Settings, then try again. If it still doesn't work, quit and reopen Tassel. | Permite el acceso a la cámara para Tassel en Configuración del Sistema y vuelve a intentarlo. Si sigue sin funcionar, cierra y vuelve a abrir Tassel. | 시스템 설정에서 Tassel의 카메라 접근을 허용한 다음 다시 시도해 주세요. 그래도 안 되면 Tassel을 종료했다가 다시 열어 주세요. |
| `paper.state.denied.settings` | Open System Settings | Abrir Configuración del Sistema | 시스템 설정 열기 |
| `paper.state.unavailable.title` | No Desk View camera found | No se encontró ninguna cámara Desk View | Desk View 카메라를 찾지 못했어요 |
| `paper.state.unavailable.body` | Desk View needs a recent Mac camera or an iPhone on a stand. | Desk View necesita una cámara de Mac reciente o un iPhone en un soporte. | Desk View를 쓰려면 최신 Mac 카메라나 거치대에 올린 iPhone이 필요해요. |
| `paper.state.unavailable.setup` | Open Desk View setup | Abrir la configuración de Desk View | Desk View 설정 열기 |
| `paper.state.unavailable.useWindow` | Share the Desk View window instead | Compartir la ventana de Desk View | 대신 Desk View 창 공유하기 |
| `paper.state.lost.title` | Desk View stopped | Desk View se detuvo | Desk View가 멈췄어요 |
| `paper.state.lost.body` | The camera disconnected or another app is using it. | La cámara se desconectó u otra app la está usando. | 카메라 연결이 끊겼거나 다른 앱이 사용 중이에요. |
| `paper.state.ended.title` | Sharing stopped | Se dejó de compartir | 공유가 중지됐어요 |
| `paper.state.ended.body` | Share the Desk View window again when you're ready. If nothing appears, allow Screen & System Audio Recording for Tassel in System Settings. | Comparte de nuevo la ventana de Desk View cuando quieras. Si no aparece nada, permite Grabación de pantalla y audio del sistema para Tassel en Configuración del Sistema. | 준비되면 Desk View 창을 다시 공유해 주세요. 아무것도 나타나지 않으면 시스템 설정의 화면 및 시스템 오디오 기록에서 Tassel을 허용해 주세요. |
| `paper.state.ended.action` | Share again | Compartir de nuevo | 다시 공유하기 |
| `paper.state.error.title` | Something went wrong with the camera | Algo salió mal con la cámara | 카메라에 문제가 생겼어요 |
| `paper.state.error.body` | Try again. If it keeps happening, quit and reopen Tassel. | Vuelve a intentarlo. Si sigue pasando, cierra y vuelve a abrir Tassel. | 다시 시도해 주세요. 계속 이러면 Tassel을 종료했다가 다시 열어 주세요. |
| `paper.devices.switch` | Switch camera | Cambiar de cámara | 카메라 바꾸기 |
| `paper.upload.failing` | Ada can't see your latest work yet. Reconnecting… | Ada todavía no ve tu trabajo más reciente. Reconectando… | Ada가 아직 최근 작업을 못 보고 있어요. 다시 연결하는 중이에요… |
| `paper.debug.toggle` | Heatmap | Mapa de calor | 히트맵 |
| `paper.debug.stats` | {kind} · {changed} changed · quiet {quiet}/{stable} · {sent} sent | {kind} · {changed} cambiadas · quieto {quiet}/{stable} · {sent} enviadas | {kind} · 변경 {changed} · 정지 {quiet}/{stable} · 전송 {sent} |
| `paper.debug.noOpenCv` | OpenCV didn't load: using the central crop | OpenCV no se cargó: se usa el recorte central | OpenCV를 불러오지 못해 중앙 영역을 사용해요 |

- [ ] **Step 1: Write the failing controller tests** (jsdom, `renderHook`, every dependency faked):
  - `camera on starts the chosen source, then status is live with the stream`;
  - `under StrictMode the source starts once` (`wrapper: StrictMode`);
  - `a feed that resolves after cleanup is stopped at once`;
  - `camera off stops the feed and detector and releases the helper, while a queued upload still finishes; turning it back on starts again` (Review Focus 2);
  - `unmount stops everything` (Review Focus 2);
  - `not-determined asks once; denied gives denied`; `helper clip mode skips camera access`;
  - `after a denial, Retry skips Electron's cached status and lets the helper's welcome decide`;
  - `auto off darwin gives unavailable without starting anything`;
  - `unavailable, then useInstead window-capture restarts with window capture`;
  - `triggers upload for camera sources and never for screen`;
  - `a lost feed shows lost and stops the detector` (Review Focus 3);
  - `no stats for 3 s marks a camera feed lost and stops it; a screen feed has no watchdog` (Review Focus 3);
  - `a session with source null or not paper never starts a source`;
  - `without window.tassel.paper the controller stays idle`.
- [ ] **Step 2: Write the failing panel tests:**
  - `idle shows the fallback`;
  - `each state shows its title, and its body where it has one, and its actions, in en`;
  - `denied in es shows Abrir Configuración del Sistema, which calls openCameraSettings`;
  - `unavailable in ko shows both actions`;
  - `usePaperTag gives Desk View's tag for the helper and the fake clip, and paper.tag.window for window capture`;
  - `usePaperLive is true only while live`;
  - `the state card is 320px wide in every language`;
  - `PaperTopLineExtras shows Switch camera only with two devices, and the failing notice only after an offline, server or auth failure`;
  - `no heatmap toggle unless debug`;
  - `cropTransform: no crop is contain-fit; a 10% top crop scales up and shifts by the crop`;
  - `the heatmap draws one quad per changed cell, scaled by devicePixelRatio` (a fake 2D context counts the paths).
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper`. Expected: FAIL.
- [ ] **Step 4: Implement the modules, the token and the catalog keys.** Before the UI, read `.impeccable/mocks/decision/stage.html`, `docs/design-system/DESIGN.md`, the P1 design checklist §0, §4.2–§4.4 (committed copy: `docs/superpowers/records/2026-10-17-p1-foundation/design/checklist.md`), and P1's built `Stage.tsx`.
- [ ] **Step 5: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/shared test && pnpm check:i18n && pnpm --filter @tassel/desktop typecheck`. Expected: PASS, then exit 0.
- [ ] **Step 6: Commit.** `git add apps/desktop packages/shared/src && git commit -m "feat(paper): capture controller, paper panel states and debug heatmap"`

### Task 13: Stage integration, the E2E capture guard, and E2E on fakes

**Files:**
- Modify (P1's built session screen, `claude/p1-ui` at 888dac3 and later):
  - `features/session/Stage.tsx`:
    - for `source === 'paper'`, the paper `Panel`'s label and `Tag` text come from `usePaperTag()`, and its body is `<PaperPanel fallback={<Waiting source="paper" />} />`;
    - `TopLine` gains an optional `trailing?: ReactNode`, rendered after the `PinIndicator`, and the paper panel passes `<PaperTopLineExtras />`;
    - other sources are unchanged.
  - `features/session/TitleStrip.tsx`: `<SourceLabel source={session.source} live={session.source === 'paper' && paperLive} />`, with `paperLive = usePaperLive()` (R29).
  - `features/session/SessionScreen.tsx`: `usePaperCapture({ sessionId, sessionSource: session?.source ?? null, cameraOn })`, with `cameraOn` from `useStageStore`. It already defaults to true.
  - `renderer/src/main.tsx`: `setPaperConfig(await window.tassel.paper.getConfig())` before the first render.
  - `features/new-session/NewSessionSheet.tsx` and `defaults.ts` (R11):
    - the sheet takes `paperFakeClip?: boolean`, defaulting to `getPaperConfig().fakeClip`;
    - Paper is disabled when `value === 'paper' && windows && !paperFakeClip`;
    - `defaultSource` and the Windows notice don't change.
- Create: `apps/desktop/tests/e2e/capture-guard.ts`, with no Playwright import, so Vitest can test it.
- Modify: `apps/desktop/tests/e2e/fixtures.ts`:
  - `launchApp` merges `{ TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_FAKE_CLIP: process.env.TASSEL_E2E_CLIP_DFA_SHORT, TASSEL_REQUIRE_FAKE_CAPTURE: '1' }` under the spec's `env`, then calls `assertFakeCapture` before launching. Every P1 and P2 spec gets the fake clip without edits;
  - add `startPaperSession(page, { type, language, uiLang })`, which drives the new-session sheet with labels from `@tassel/shared/i18n`'s catalogs, so it works in es and ko;
  - add `latestSession(page)` and `framesOf(page, sessionId)`, API calls with the app's token.
- Modify: `apps/desktop/tests/e2e/global-setup.ts`:
  - generate `dfa-short` into `<repo>/.cache/paper-clips` and set `process.env.TASSEL_E2E_CLIP_DFA_SHORT`;
  - on darwin, run `node scripts/native.mjs build` when the helper is missing;
  - give the server `TASSEL_S3_BUCKET` (from `TASSEL_E2E_S3_BUCKET`, default `tassel-e2e`);
  - fail early with "Local S3 isn't running: docker compose up -d s3" when port 7070 refuses.
- Create: `apps/desktop/tests/e2e/paper-fake-clip.spec.ts`, `paper-states.spec.ts`, `paper-window-capture.spec.ts`, `paper-helper-clip.spec.ts`
- Test:
  - `apps/desktop/tests/unit/capture-guard.test.ts`;
  - P1's `session-screen.test.tsx` gains two tests: `a paper session mounts the paper panel under P1's TopLine` and `the title strip's dot stays neutral until paper is live`;
  - P1's `new-session.test.tsx` gains `win32 with a fake clip enables Paper, keeps screen as the default, and keeps the notice`. It runs on every OS.

**Interfaces:**
- Consumes: Task 12; P1's `Stage`, `TopLine`, `PinIndicator`, `Waiting`, `SourceLabel`, `useStageStore`, `useCurrentSession`, `launchApp`, `snap`, `settle` and `setWindowSize`.
- Produces:

```ts
// tests/e2e/capture-guard.ts
export function assertFakeCapture(env: Record<string, string | undefined>, exists?: (p: string) => boolean): void;
```

- **What `assertFakeCapture` allows.** It throws, naming the rule, unless all of these hold:
  - `TASSEL_REQUIRE_FAKE_CAPTURE` is `1`;
  - `TASSEL_PAPER_SOURCE` is set and isn't `auto`;
  - `fake-clip` has a `TASSEL_FAKE_CLIP` that exists;
  - `deskview-helper` has a `TASSEL_HELPER_CLIP` that exists, or a `TASSEL_DESKVIEW_HELPER` that doesn't exist, or `TASSEL_FAKE_CAMERA_ACCESS=denied`;
  - `window-capture` and `screen` have `TASSEL_FAKE_DISPLAY=self`.

  Each spec's screenshots then show only the synthetic clip or our own window, so `main` may post them.

- [ ] **Step 1: Write the failing unit tests:**
  - **capture-guard:**
    - `refuses an unset or auto source`;
    - `refuses fake-clip without an existing clip`;
    - `refuses the helper with neither a clip, a missing binary nor denied access`;
    - `refuses window and screen without TASSEL_FAKE_DISPLAY=self`;
    - `refuses a launch without TASSEL_REQUIRE_FAKE_CAPTURE=1`;
    - `accepts launchApp's default`.
  - the session-screen and new-session tests above.
- [ ] **Step 2: Write the failing E2E specs.** Every spec collects `page.on('console')` errors, and expects none from `paper/` and no CSP violation.
  - **`paper-fake-clip.spec.ts`**, with `launchApp`'s default plus `TASSEL_PAPER_DEBUG=1`, and a 90 s timeout:
    1. `startPaperSession`. Within 10 s, `[data-testid=paper-video]` has `videoWidth` 960 and `videoHeight` 720.
    2. The title strip reads "Desk View · Live" next to the red dot, and the region is "Your paper · Desk View".
    3. Within 25 s of going live (the clip's trigger is at 11.5 s), the debug pill reads "1 sent".
    4. `framesOf` returns its first frame: seq 1, reason `ink`, source `fake-clip`, 960×720, `has_crop` true, and `page_found` true (OpenCV ran in the worker). The full image starts with `FF D8`. A later frame may follow, because the clip loops at 20 s.
    5. `settle`, then `snap('p3-paper-live-1440')`, with the heatmap on.
    6. The dock's Camera button turns it off: the panel shows "Camera is off" and the dot is the smoke color. Turned back on, it is live again.

    A second test launches with `TASSEL_UI_LANG=es`, opens the session, and calls `setWindowSize(app, page, 1024, 680)`. It pins split with B twice, as P1's layout spec does, and then checks:
    - paper and board are both visible;
    - the tag "Tu papel · Desk View" and the pin pill "Fijado · …" each lie inside the paper panel's box, and neither intersects Ada's tile;
    - `snap('p3-paper-split-1024-es')`.
  - **`paper-states.spec.ts`:**
    - **Denied:** `TASSEL_PAPER_SOURCE=deskview-helper`, `TASSEL_FAKE_CAMERA_ACCESS=denied`, `TASSEL_UI_LANG=es`. The card reads "Tassel no puede usar la cámara", and "Abrir Configuración del Sistema" makes the main process log the fake line. `snap('p3-paper-denied-es')`.
    - **Unavailable:** `TASSEL_PAPER_SOURCE=deskview-helper`, `TASSEL_DESKVIEW_HELPER=<a missing path>`, `TASSEL_FAKE_CAMERA_ACCESS=granted`, `TASSEL_FAKE_DISPLAY=self`, `TASSEL_UI_LANG=ko`.
      - Off darwin the supervisor answers `unsupported`, and on darwin `missing-binary`; both read "Desk View 카메라를 찾지 못했어요". `snap('p3-paper-unavailable-ko')`.
      - Then "대신 Desk View 창 공유하기" turns it live, with the tag "내 종이 · Desk View 창".
  - **`paper-window-capture.spec.ts`:** `TASSEL_PAPER_SOURCE=window-capture`, `TASSEL_FAKE_DISPLAY=self`. It goes live, the tag reads "Your paper · Desk View window", and `snap('p3-paper-window-1440')`.
  - The two specs that use `TASSEL_FAKE_DISPLAY=self` (this one and the unavailable one) rely on Task 1's check T. If T failed, skip them with `test.skip(…, 'needs check T')`; Task 14 moves them to the owner's checklist.
  - **`paper-helper-clip.spec.ts`**, skipped unless darwin, with a 90 s timeout: `TASSEL_PAPER_SOURCE=deskview-helper`, `TASSEL_HELPER_CLIP=$TASSEL_E2E_CLIP_DFA_SHORT`.
    1. It goes live at 960×720 through the helper.
    2. The first frame uploads with source `deskview-helper`.
    3. End session, then confirm. Within 2 s, `pgrep -P <app.process().pid> deskview-helper` finds nothing (Review Focus 2).
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e paper-`. Expected: FAIL.
- [ ] **Step 4: Implement the integration, the guard, the fixtures and the setup.**
- [ ] **Step 5: Run every spec and confirm they pass.** Run `docker compose up -d db s3 && pnpm test && pnpm e2e`. Expected:
  - every P1 and P3 spec passes, with P1's specs now running on the fake clip;
  - the five P3 screenshots are in `apps/desktop/test-results/screens/`.
- [ ] **Step 6: Exercise it by hand and measure.** Run `pnpm dev`, whose default is the `dfa-demo` clip (Task 14; until then, set `TASSEL_PAPER_SOURCE=fake-clip` and `TASSEL_FAKE_CLIP` yourself) with `TASSEL_PAPER_DEBUG=1`.
  - Expect three uploads at about 27, 39 and 47 s after the paper goes live, with the heatmap matching the new strokes. A fourth comes when the clip loops at 56 s.
  - Record two measurements in the report, against spec §2's budgets for P4: the renderer and worker CPU from `app.getAppMetrics()`, and each upload's `bytes`. If a full frame passes 600 KB, flag pre-resizing for P4.
- [ ] **Step 7: Commit.** `git add apps/desktop && git commit -m "feat(paper): paper view on the session stage, E2E capture guard and specs on fakes"`

### Task 14: The real camera through LaunchServices, dev workflow and CI

**Files:**
- Create: `scripts/camera.mjs`. On macOS it:
  1. builds the desktop app and the helper;
  2. takes `TASSEL_*` from the shell, defaulting `TASSEL_PAPER_SOURCE` to `auto`, and never passes `TASSEL_REQUIRE_FAKE_CAPTURE`;
  3. runs `open -n -W -a <apps/desktop/node_modules/electron/dist/Electron.app> --env … --args <abs out/main/index.js>` (or `--tassel-env-file`, after Task 1's E);
  4. exits when the app quits.

  Elsewhere it prints `camera: skipped (Desk View is macOS-only)` and exits 0.
- Create: `apps/desktop/playwright.camera.config.ts` (`testDir: ./tests/camera`, `workers: 1`, `globalSetup: ./tests/e2e/global-setup.ts`, `use: { trace: 'off', screenshot: 'off', video: 'off' }`) and `apps/desktop/tests/camera/paper-camera.spec.ts`
- Modify: `apps/desktop/package.json` (`e2e:camera` = `playwright test -c playwright.camera.config.ts`)
- Modify: `scripts/dev.mjs`:
  - `docker compose up -d db s3`;
  - on macOS, `node scripts/native.mjs build` before Electron, with a warning and no failure when Swift is missing;
  - unless `TASSEL_PAPER_SOURCE` is set, set `TASSEL_PAPER_SOURCE=fake-clip` and `TASSEL_FAKE_CLIP=<the dfa-demo clip>`, generating it if missing. A human who wants real capture from a terminal sets `TASSEL_PAPER_SOURCE=auto`;
  - pass `TASSEL_PAPER_*` and P3's other variables through.
- Modify: `README.md` (a "Paper view" section, and the owner checklists below), `CLAUDE.md` (the agent rules below), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: everything above. Task 1's verdicts H, C and E choose the branch below.
- Produces: the spec, the scripts and the docs; no new product interfaces.

- **H PASS and C PASS:** `paper-camera.spec.ts` skips unless `TASSEL_E2E_CAMERA=1` and darwin. The shared global setup has already started the E2E server.
  1. It launches through LaunchServices with `--remote-debugging-port=9334`. It passes the E2E `TASSEL_*` with `--env`: the server URL, `TASSEL_TOKEN_STORE=file`, a temp `TASSEL_USER_DATA`, `TASSEL_PAPER_SOURCE=auto` and `TASSEL_HELPER_TAG=<a fresh uuid>`.
  2. It waits for the page, then attaches with `chromium.connectOverCDP` through `browser.contexts()[0]`.
  3. It runs `startPaperSession`.
  4. Within 15 s, `paper-video` has `videoWidth` ≥ 1280. At least 30 `requestVideoFrameCallback` callbacks arrive within 3 s.
  5. It takes **no screenshot**, and saves no frame or trace.
  6. In `finally`, it calls `DELETE /v1/sessions/{id}` with the app's token. That removes every real frame from the local store.
  7. It closes through CDP `Browser.close`, or by killing the app's pid. Within 2 s, `pgrep -f <uuid>` finds nothing. The tag keeps another checkout's helper out of the check.
- **The owner's checklists** (in the README), run with `node scripts/camera.mjs`:
  - **C FAIL:** the same checks as the camera spec, done by hand, with no screenshot.
  - **H FAIL:** "Window-capture check": pick the Desk View window in the system picker; expect live video, an upload in the debug pill, and the dot neutral after End.
  - **T FAIL:** the window-capture and unavailable flows that Task 13 had to skip.
- **CI** (P1 Task 15's workflow):
  - the server and E2E jobs gain the `versity/versitygw:v1.8.0` service with Task 4's env (`VGW_META_SIDECAR` can be dropped on a Linux runner);
  - the E2E job caches `.cache/paper-clips`, keyed on `packages/paper-synth/src/**`;
  - a new `native` job on `macos-latest` runs `node scripts/native.mjs test`. GitHub's runners have Xcode, and the script's CLT flags apply only under Command Line Tools;
  - the unit jobs on `macos-latest` and `windows-latest` already run paper-synth's golden hash: that is the Windows parity check.
- **`CLAUDE.md` rules:**
  - No agent-run test or tool opens the real camera. E2E goes through `launchApp`, which pins a fake paper source and the capture guard.
  - `pnpm dev` from an agent shell keeps its fake-clip default. Agents never set `TASSEL_PAPER_SOURCE` to `auto`, `deskview-helper`, `window-capture` or `screen` without a clip or `TASSEL_FAKE_DISPLAY=self`.
  - Camera checks run only through `node scripts/camera.mjs` or the camera spec, with the owner at the Mac.
  - Never commit, post or screenshot a real camera frame; `pnpm check` enforces the file part.
  - Agents never answer TCC prompts.
  - `TASSEL_HELPER_CLIP` tests the helper without the camera.

- [ ] **Step 1: Write the failing camera spec** (on H PASS and C PASS).
- [ ] **Step 2 (owner at the Mac): Run it and confirm it fails.** Run `TASSEL_E2E_CAMERA=1 pnpm --filter @tassel/desktop e2e:camera`. Expected: FAIL (`scripts/camera.mjs` or the launch helper is missing).
- [ ] **Step 3: Implement `scripts/camera.mjs`, the camera config, the `dev.mjs` changes, the docs and CI.**
- [ ] **Step 4 (owner at the Mac): Run it and confirm it passes.** Same command, or the checklist on a FAIL branch. Expected: PASS, and no new file under `test-results/` holds an image.
- [ ] **Step 5: Verify the whole plan.**
  - `pnpm check`: exit 0, including `check-no-frames`.
  - `pnpm test`, then `node scripts/native.mjs test`, then `pnpm e2e`: all pass.
  - Windows: CI's `windows-latest` unit job passes with the golden hash unchanged. A Windows E2E run (`pnpm test`, then `pnpm e2e paper-fake-clip`) is an owner item for when a Windows PC is available; record it as open in the report until then.
- [ ] **Step 6: Run `pnpm dev`, then `node scripts/camera.mjs`** (owner at the Mac for the camera). Expected: `pnpm dev` opens the library and plays the clip in a paper session. With the camera, a paper session shows her paper live with the dot red, and the camera light goes off after End session.
- [ ] **Step 7 (owner at the Mac): Check the unverified links.** With camera access turned off for Electron in System Settings, the denied state's "Open System Settings" opens Privacy & Security → Camera. "Open Desk View setup" brings up the Desk View app. Note both results in the report.
- [ ] **Step 8: Commit, then push the branch.** `git add -A && git commit -m "chore(paper): LaunchServices camera run, dev workflow, docs and CI"`, then `git push -u origin claude/p3-paper-view`.

---

## Source notes

These are the sources behind the APIs and behaviors pinned above, beyond those linked inline, all checked on 2026-10-17. If an implementer finds one changed, the task report says so before the code changes.

- **Versity Gateway:**
  - [env and Docker wiki](https://github.com/versity/versitygw/wiki/Docker), [v1.8.0 flags](https://github.com/versity/versitygw/blob/v1.8.0/cmd/versitygw/main.go), [Dockerfile](https://github.com/versity/versitygw/blob/main/Dockerfile);
  - tested locally with boto3 1.43.114 for create, put, get, head, presign, list and delete; a wrong secret was refused.
- **Vultr Object Storage** (for P10):
  - endpoints are `<cluster>.vultrobjects.com` ([FAQ](https://docs.vultr.com/products/storage/object-storage/faq.md));
  - virtual-hosted style is recommended and path-style is allowed ([security guide](https://docs.vultr.com/platform/security-best-practices/vultr-object-storage));
  - the region is the cluster name ([Python guide](https://docs.vultr.com/how-to-use-vultr-object-storage-in-python)).
- **FastAPI:**
  - [request files](https://fastapi.tiangolo.com/tutorial/request-files/) and [form models](https://fastapi.tiangolo.com/tutorial/request-form-models/);
  - FastAPI calls `request.form()` without limits ([routing.py 0.143.3](https://github.com/fastapi/fastapi/blob/0.143.3/fastapi/routing.py)).
- **Playwright 1.64.1:**
  - the `_electron` API ([docs](https://playwright.dev/docs/api/class-electron)) launches Electron with `--remote-debugging-port=0` and attaches the way `connectOverCDP` does ([electron.ts](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/electron/electron.ts));
  - while connecting, pages without a renderer are dropped ([crPage.ts](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/crPage.ts)), hence "attach after the page loads".
- **`open`** on macOS 26.6.2: `man open` and `open -h` list `-a`, `-n`, `-W`, `-g`, `-j`, `-F`, `--args`, `--env` and `--stdin`, `--stdout`, `--stderr`. That a LaunchServices launch makes the app its own responsible process was confirmed on this Mac with a probe: a direct spawn reported Claude Code as responsible.
- **Electron `systemPreferences`:**
  - `getMediaAccessStatus('camera')` returns `not-determined`, `granted`, `denied`, `restricted` or `unknown`;
  - `askForMediaAccess('camera')` is macOS-only. After a denial it shows no alert and resolves with the existing status, and a change in System Settings needs an app restart ([docs](https://www.electronjs.org/docs/latest/api/system-preferences)).
- **Workers and CSP:**
  - Vite's `worker.format` defaults to `'iife'` ([worker options](https://vite.dev/config/worker-options));
  - `importScripts()` "will automatically fail inside module workers" ([HTML, workers](https://html.spec.whatwg.org/multipage/workers.html));
  - local-scheme workers inherit their creator's policy, and others take it from their own response. Mike West's 2026 TAG note says the details are still being converted to policy containers ([whatwg/html#11316](https://github.com/whatwg/html/issues/11316)).

## Review response

The independent review (`.superpowers/sdd/2026-10-17-p3-paper-view/plan-review.md`: 2 Critical, 9 Important, 34 Minor) is applied in place. Every Critical and Important finding is fixed in the task that owns the code:

| Finding | Where |
|---|---|
| C1 | Privacy constraints; Tasks 9 (`TASSEL_REQUIRE_FAKE_CAPTURE`), 10 (fake clip needs its file), 13 (`launchApp` default, capture guard), 14 (`dev.mjs`, `CLAUDE.md`); "Merging with P2" (`launchVoice`) |
| C2 | Detector values; Task 6 (timelines; `starts-with-hand`, `slide-and-hold`); Task 7 (step order, stale recovery) |
| I1 | `compareLongSide`; Task 7 (fixed size, floor, jitter test) |
| I2 | Task 8: no page CSP change; a classic worker; an `importScripts` fallback that can run |
| I3 | Task 7 (`tsconfig.test.json`); R6 |
| I4 | Task 1 (`DETECTOR_VERSION` in the contracts); Task 11 |
| I5 | Tasks 12–13: P1's `TopLine`, tag text and `trailing` slot |
| I6 | Task 13 |
| I7 | Task 1 (E runs `--mode status`) |
| I8 | Tasks 9, 10, 12 |
| I9 | Architecture; R11; Tasks 13–14 |

All four proposed amendments (R6, R8, R9, R11) are applied. R8 and R9 follow main's ruling: onboarding goes to P9, thumbnails to P8. Minors m1–m3, m5, m7–m26 and m28–m34 are applied as proposed, and m4, m6 and m27 are applied with changes (below). R12–R16 record the new decisions.

C2's "large dark non-ink blob" is pinned as a 4-connected cluster of smooth dark cells (`occluderSmoothness`), so dense handwriting never reads as a hand. m7's fresh-sheet test counts only the ink she added on the sheet, so a printed margin never blocks it. P1's built Task 13 is followed: its `TopLine` and `PinIndicator` (R17), `SourceLabel` with R29, the `Waiting` fallback, `setWindowSize`, `cameraOn` (already on by default), and the `--color-*` token pattern.

Applied with changes, with reasons:
- **m4:** on macOS before 15 the handler denies rather than preselecting the Desk View window (R16). It can't tell a window request from a screen request, and a wrong guess would share more than she chose.
- **m6:** measured and recorded in Task 13 Step 6 rather than gated. Spec §2 gives P3 no budget of its own, and pre-resizing is P4's call.
- **m27:** `--paper-selftest` is dropped rather than specified. If check C fails, the owner's checklist replaces the spec, which needs no new IPC channel or renderer hook.
- **The fake clip's tag** (I5 and m9): it shows Desk View's tag and live label rather than "Test clip". It stands in for Desk View, and P1's built specs find the paper panel by that name; the debug pill names the real kind.
