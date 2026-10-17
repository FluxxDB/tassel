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
- **Detection.** A module worker samples at 5 fps and gates on motion at 160×120. It then compares a flattened, lighting-normalized page in 16 px cells against a stable reference. A trigger carries a full-resolution JPEG, a crop and a cell mask. OpenCV.js finds the page.
- **Storage.** `POST /v1/sessions/{id}/frames` writes the JPEGs through an `ObjectStore` (S3 via boto3, or in memory for unit tests) and adds a `frames` row. Deleting a session deletes its frames.
- **Proof.** E2E drives the real app in three ways: on the synthetic clip (every OS), on the helper streaming that clip (macOS), and on the real camera through a LaunchServices launch (macOS, opt-in, no screenshots).

**Tech Stack:**
- **Desktop:** P1's stack, unchanged. Electron is exactly 44.9.0, which ships Chromium 152.0.7977.167 and Node 24.22.0 ([release](https://releases.electronjs.org/release/v44.9.0)). Also React 19, Zustand 5, Vitest, and Playwright 1.64.1 `_electron` ([npm](https://www.npmjs.com/package/playwright)). New:
  - `@techstark/opencv-js` 5.0.0-release.1, Apache-2.0, 13.3 MB, with the WebAssembly embedded ([npm](https://www.npmjs.com/package/@techstark/opencv-js));
  - WebCodecs `VideoFrame`, `MediaStreamTrackProcessor` (Window only in Chromium 152), `OffscreenCanvas.convertToBlob` and canvas `captureStream()`; the links are in Tasks 8 and 10.
- **Synthetic clip:** a pure TypeScript rasterizer plus `jpeg-js` 0.4.4, BSD-3-Clause ([npm](https://www.npmjs.com/package/jpeg-js)), so the bytes are identical on every OS.
- **Native:** Swift 6.3.3 with Command Line Tools only, SwiftPM tools-version 6.0, Swift Testing. AVFoundation (`.deskViewCamera`, `AVCaptureDeskViewApplication`), Network.framework (`NWListener` + `NWProtocolWebSocket`) and Core Image; the links are in Task 3.
- **Server:** FastAPI 0.143.3 ([PyPI](https://pypi.org/project/fastapi/)) with python-multipart 0.0.32 ([PyPI](https://pypi.org/project/python-multipart/)); boto3 1.43.114 ([PyPI](https://pypi.org/project/boto3/)); Pillow 13.0.0 for test JPEGs only ([PyPI](https://pypi.org/project/pillow/)).
- **Local S3:** Versity Gateway `versity/versitygw:v1.8.0`, Apache-2.0, amd64 and arm64 ([Docker Hub](https://hub.docker.com/r/versity/versitygw), [releases](https://github.com/versity/versitygw/releases)).

**Spec:** `docs/superpowers/specs/2026-10-17-tassel-design.md`, mainly §2 goal 2, §4.1 (paper sources, change detector), §4.3, §5.2 step 1, §6 (session states, privacy defaults) and §7. Read it with:
- `docs/research/02-desktop-camera-vision.md` §2–§6, the source of the detector values;
- `docs/research/spikes/README.md`, the permission rules;
- the roadmap (`docs/superpowers/plans/2026-10-17-tassel-roadmap.md`) and the P1 plan, whose conventions this plan follows.

**Starts from:** `claude/p1-foundation` after P1 Task 15 has merged; Task 13 below replaces P1 Task 13's paper placeholder. Work on branch `claude/p3-paper-view`, with the SDD workspace `.superpowers/sdd/2026-10-17-p3-paper-view/`. P2 runs at the same time; see "Merging with P2".

## Global Constraints

Every task's requirements include this section.

### Carried from P1
- Node ≥ 22.18, pnpm 12, Python 3.12. Every script runs on macOS **and Windows**: Node scripts use `cross-spawn`, and nothing is bash-only.
- Electron stays at **exactly `44.9.0`**. macOS ties the owner's camera, microphone and screen grants to that ad-hoc-signed binary.
- Renderers keep `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. `window.tassel` is the only IPC surface, and every IPC handler refuses senders outside the renderer's origin (`isTrustedUrl`).
- No provider key ever reaches the desktop app.
- Every UI string goes through i18next keys present in `en`, `es` and `ko`, and `pnpm check:i18n` passes. Korean uses polite 해요체.
- Design tokens only. Iris (`#c094e4`, `#7d4fc4`) is for Ada alone, never paper chrome. The live red `#e5484d` is for the capture dot alone. No drop shadows (hairline `0 0 0 1px` only). Functional text is never below 11px.
- Commits go on `claude/p3-paper-view` and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Privacy and permissions
- **A frame from the real camera stays on this machine.** It is never committed, never posted, and never in a screenshot. Specs that use the real camera take no screenshots. From Task 1 on, `pnpm check` fails on any tracked `.jpg`, `.jpeg`, `.mjpeg` or `.y4m` file.
- Only screenshots of the synthetic clip may go to Discord; `main` posts them.
- Frames are stored with their session until she deletes it (spec §6). Deleting a session deletes its objects first, then its rows.
- The title strip's live dot is red only while a paper source is actually delivering frames (spec §6, "A visible live dot shows whenever the camera or screen is being captured").
- **Screen frames never upload on their own** (spec §4.1: they "leave the device only when she asks"). The detector and heatmap run for the `screen` source, but its triggers are never uploaded. P7 adds on-request screen frames.
- **macOS grants follow the responsible process.** An Electron that Playwright, `pnpm dev` or an agent's shell starts inherits that shell's grants, which include no camera. Camera checks launch Electron through LaunchServices (`open -n -W -a …`) or use the synthetic clip.
- Agents never answer TCC prompts and never change Privacy & Security settings. Steps that need either are marked **owner at the Mac**.

### Native
- Swift 6.3.3 with Command Line Tools only (`xcode-select -p` is `/Library/Developer/CommandLineTools`). Build with SwiftPM (`swift build`, `swift test`) or `swiftc`; never `xcodebuild`.
- `node scripts/native.mjs build|test|path` wraps SwiftPM. On any other OS it prints `native: skipped (Desk View is macOS-only)` and exits 0.
- **Tests under Command Line Tools.** `swift test` fails with "no such module 'Testing'" ([Swift Forums 74784](https://forums.swift.org/t/error-no-such-module-testing/74784)), and XCTest isn't available at all. Verified on this Mac on 2026-10-17: it passes with these flags, where `<CLT>` is `/Library/Developer/CommandLineTools` (`lib_TestingInterop.dylib` lives in the last path):

  `-Xswiftc -F -Xswiftc <CLT>/Library/Developer/Frameworks -Xlinker -F -Xlinker <CLT>/Library/Developer/Frameworks -Xlinker -rpath -Xlinker <CLT>/Library/Developer/Frameworks -Xlinker -rpath -Xlinker <CLT>/Library/Developer/usr/lib`
- **Platform:** `.macOS(.v14)`, because the CLT `Testing.framework` is built for macOS 14.
- **The helper's `Info.plist`** is embedded with `-sectcreate __TEXT __info_plist` through SwiftPM `unsafeFlags` ([doc](https://developer.apple.com/documentation/packagedescription/linkersetting/unsafeflags(_:_:))); Apple's advice for CLI tools is in [forum 111100](https://developer.apple.com/forums/thread/111100). The linker's ad-hoc signature leaves that plist unbound, so `native.mjs build` re-signs with `codesign --force --sign -` to bind it.
- The helper exists only on macOS. Windows has no Desk View (spec §2 non-goals).

### Detector values
These are research 02 §5's starting values. Change them only in `DEFAULT_PARAMS` (Task 7), and only after tuning with the heatmap.

| Name | Value | Meaning |
|---|---|---|
| `sampleIntervalMs` | 200 | 5 fps, by frame timestamp |
| `motionWidth` × `motionHeight` | 160 × 120 | Gray, after a 3×3 box blur |
| `motionDelta` | 15 | A pixel moves when it changes by more than 15/255 |
| `busyFraction` | 0.005 | The frame is busy when more than 0.5% of pixels move |
| `stableSamples` | 5 | Quiet samples (about 1 s) before comparing |
| `compareLongSide` | 800 | Flattened page: long side 800 px, short side the nearest multiple of 16 |
| `fallbackCrop` | 0.8 | No page found: the central 80% of the frame, at 640×480 |
| `lightingBlur` | 31 | Normalize: gray divided by its 31 px box blur |
| `inkDelta` | 0.10 | Ink when reference − current > 0.10; erasure when current − reference > 0.10 |
| `cellSize` | 16 | Cell edge in compare pixels |
| `cellMinPixels` | 6 | A cell changes at ≥ 6 ink or erasure pixels |
| `triggerMinCells` | 2 | Changed cells needed to trigger |
| `quietInkMs` | 2000 | Time with no new ink before a trigger; tunable from 1500 to 3000 |
| `minTriggerIntervalMs` | 5000 | At most one trigger every 5 s |
| `bigChangeFraction` | 0.40 | More than 40% of cells changed: a new page. Re-find the page, reset, send the full page |
| `pageMoveFraction` | 0.02 | A page-quad corner moved more than 2% of the frame diagonal: the page moved; same handling as a big change |
| `referenceRefreshMs` | 30000 | Replace the reference after 30 s with fewer than `triggerMinCells` changed |
| `solidCellFraction` | 0.5 | A cell more than 50% changed is solid: a hand, sleeve or shadow, not pen ink |
| `occlusionMinSolidCells` | 4 | That many solid cells means occluded: treat the sample as busy |

`DETECTOR_VERSION = 'p3.1'` goes with every upload.

### Helper protocol v1
Task 2 owns the protocol, and Task 10 mirrors it in TypeScript.
- **Process.**
  - Electron passes a per-launch token in the env as `TASSEL_HELPER_TOKEN` (64 hex characters; never on argv). `TASSEL_HELPER_CLIP` optionally names an MJPEG file to stream instead of the camera.
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
- **Buckets** are private: `tassel-frames` in dev and `tassel-e2e` in E2E (`TASSEL_E2E_S3_BUCKET` overrides it, so the QA and design checkouts use their own). Server tests use one bucket per test run, `tassel-test-<8 hex>`.
- **Local S3** is the compose service `s3`: `versity/versitygw:v1.8.0` on `127.0.0.1:7070`, region `us-east-1`. The dev credentials are `tassel` / `tassel-dev-only`; like the dev database password, they are not secrets.
- **The boto3 client config** is `Config(signature_version="s3v4", s3={"addressing_style": "path"}, request_checksum_calculation="when_required", response_checksum_validation="when_required", connect_timeout=2, read_timeout=10, retries={"max_attempts": 3, "mode": "standard"})`. The option names are in [botocore config.py](https://github.com/boto/botocore/blob/develop/botocore/config.py).
  - `when_required` keeps `put_object` free of the CRC32 trailers that boto3 ≥ 1.36 adds by default ([boto3#4392](https://github.com/boto/boto3/issues/4392)), which some S3-compatible stores reject.
  - `delete_objects` sends CRC32 regardless ([httpchecksum.py](https://github.com/boto/botocore/blob/develop/botocore/httpchecksum.py)). Versity accepts it. P10 must check Vultr, and fall back to per-key `delete_object` if Vultr refuses it.
- **Limits:** a full frame ≤ 8 MiB, a crop ≤ 2 MiB, and at most one upload per session per second (HTTP 429).

### New environment variables
`TASSEL_PAPER_*` and `TASSEL_FAKE_*` are read only when `app.isPackaged` is false; a packaged app ignores the fakes.

| Variable | Read by | Values |
|---|---|---|
| `TASSEL_PAPER_SOURCE` | main | `auto` (default), `deskview-helper`, `window-capture`, `fake-clip`, `screen` |
| `TASSEL_FAKE_CLIP` | main | Absolute path of an MJPEG file. With `fake-clip`, it is passed to Chromium's fake camera |
| `TASSEL_HELPER_CLIP` | main → helper | MJPEG path; the helper streams it instead of the camera (no TCC needed) |
| `TASSEL_DESKVIEW_HELPER` | main | Path of the helper binary (defaults in Task 9) |
| `TASSEL_FAKE_DISPLAY` | main | `self`: `getDisplayMedia` captures the requesting frame; no OS permission, used by E2E |
| `TASSEL_FAKE_CAMERA_ACCESS` | main | `granted`, `denied` or `not-determined`, in place of `systemPreferences` |
| `TASSEL_PAPER_DEBUG` | main | `1` shows the heatmap toggle |
| `TASSEL_PAPER_PARAMS` | main → worker | JSON object of `DetectorParams` overrides |
| `TASSEL_OBJECT_STORE`, `TASSEL_S3_ENDPOINT_URL`, `TASSEL_S3_REGION`, `TASSEL_S3_BUCKET`, `TASSEL_S3_ACCESS_KEY_ID`, `TASSEL_S3_SECRET_ACCESS_KEY` | server | Task 4 |
| `TASSEL_E2E_S3_BUCKET` | E2E setup | Default `tassel-e2e` |
| `TASSEL_E2E_CAMERA` | camera spec | `1` opts in to the real-camera spec (Task 14) |

### Fake and live pairs (spec §7)
None of these needs a key.

| Part | Fake | Live |
|---|---|---|
| Desk View capture | Helper `ClipProducer` (`TASSEL_HELPER_CLIP`) | Helper `CameraProducer` |
| A camera inside Chromium | Fake-camera switches playing the synthetic MJPEG | n/a: Chromium never lists Desk View (research 02 §2) |
| Display capture | `TASSEL_FAKE_DISPLAY=self` | The system picker (macOS) or the primary screen (Windows) |
| Camera permission | `TASSEL_FAKE_CAMERA_ACCESS` | `systemPreferences` |
| Object store | `MemoryObjectStore` | `S3ObjectStore`, against local Versity in dev and Vultr in P10 |

## Rulings on spec conflicts

Each ruling gives the decision, why, and the cost if it's wrong.

- **R1. Detector resolution.** Spec §4.1 says "160×120 grayscale … compare 16 px cells", which would give 10×7 cells, each larger than a state circle. **Ruling:** use research 02 §5. Motion is gated at 160×120, and ink cells are compared on the flattened page with a long side of 800. *Cost if wrong:* new parameter values only.
- **R2. Transcript with each upload.** Spec §5.2 step 1 uploads "the last ~20 s of transcript". **Ruling:** the client uploads the frame, crop and mask (spec §4.1), and P4 attaches the transcript on the server, which already holds the voice state. *Cost if wrong:* one optional field later.
- **R3. Is ObjectStore fake or live?** Spec §7 puts ObjectStore under `TASSEL_PROVIDERS=fake|live`. **Ruling:** local S3 needs no keys, so S3 is the default everywhere, as Postgres is. `TASSEL_OBJECT_STORE=memory` is the fake for unit tests, and `TASSEL_PROVIDERS` doesn't switch it. *Cost if wrong:* one settings line.
- **R4. The local S3 server.** MinIO's community edition is source-only since 2025-10-15, its repository is archived, and `hub.docker.com/r/minio/minio` returns 404 (see [the README history](https://github.com/minio/minio/commits/master/README.md) and [the API](https://api.github.com/repos/minio/minio)). **Ruling:** use Versity Gateway v1.8.0. A test on 2026-10-17 passed create, put, get, head, presign, list and delete with boto3 1.43.114. RustFS 1.0.1 and SeaweedFS 4.48 also passed; they are larger, and RustFS is newer. *Cost if wrong:* swap one compose service.
- **R5. Chromium's fake camera fakes the microphone too.** The switch is documented to "replace actual camera and microphone" ([media_switches.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/base/media_switches.cc)), and the fake microphone beeps. **Ruling:** `fake-clip` is a dev and E2E mode. P2's fake STT needs no microphone. A live-voice developer uses the helper (`TASSEL_HELPER_CLIP`) or window capture instead. *Cost if wrong:* none.
- **R6. P3's touch list.** The roadmap lists `native/**`, `renderer/src/paper/**` and `server/…/frames/**`. **Ruling:** P3 also owns:
  - `apps/desktop/src/main/paper/**`, `apps/desktop/src/shared/paper-bridge.ts` and `packages/paper-synth/**`;
  - the `s3` service in `docker-compose.yml`, and migration `0003`;
  - one-line hooks in P1 files: `main/index.ts`, `main/ipc.ts`, `preload/index.ts`, `shared/bridge.ts`, `app.py`, `config.py`, `api/sessions.py`, `tests/conftest.py`, the session screen files (Task 13), E2E setup, `scripts/dev.mjs`, the README, `CLAUDE.md` and CI;
  - the generated `packages/shared/src/api/*`.

  *Cost if wrong:* merge work (see "Merging with P2").
- **R7. Screen frames.** Spec §4.1 says a trigger uploads, and also that screen frames leave only on request. **Ruling:** `screen` triggers never upload (`shouldUpload('screen') === false`). *Cost if wrong:* none; P7 owns screen frames.
- **R8. Onboarding.** Spec §6's onboarding "Desk View check" and consent notice belong to no roadmap plan. **Ruling:** P3 builds the parts a check needs: the helper's device list, a live preview, "Open Desk View setup" and the permission states. The onboarding screen and its consent copy wait for their own plan, before real students use uploads. *Cost if wrong:* the owner assigns onboarding to P3 as one extra task.
- **R9. Library thumbnails.** Spec §6's "last … paper thumbnail" on library cards is not in P3. `GET …/frames/{id}/image` makes it possible later. *Cost if wrong:* one small UI task.
- **R10. Helper frame rate.** The spec targets "1920×1440 at up to 30 fps"; research suggests 10–15. **Ruling:** default 15, maximum 30. *Cost if wrong:* one default.
- **R11. Paper on Windows in dev.** P1's new-session sheet disables Paper on win32, but research 02 §3 develops paper view on Windows with the fake clip. **Ruling:** the sheet enables Paper on win32 only when `TASSEL_PAPER_SOURCE=fake-clip`, which a packaged app ignores. *Cost if wrong:* one condition.

## Review Focus

These are the five failure modes a student is most likely to meet that the spec never names. Each one has a test in the task named.

1. **A hand, sleeve or shadow resting still on the page.** Expected: no interruption, because it isn't ink. Once it leaves, only real ink triggers. Tested by `hand-rests` and `shadow-pass` in Task 7.
2. **Leaving the session, turning the camera off, or quitting.** Expected: the camera is released (the helper exits, the camera light goes off) and the live dot goes neutral. Tested by helper stdin EOF in Task 3, the supervisor quit and stop in Task 9, controller unmount and camera off in Task 12, and the helper-clip E2E's process check in Task 13.
3. **The camera vanishes mid-session** (the iPhone walks away, another app takes it, the lid closes). Expected: "Desk View stopped" with Try again, no crash, and no upload burst. Tested by `device-lost` and socket close mapping in Task 10, and the controller's lost state in Task 12.
4. **A lighting change** (auto-exposure, a lamp, slow daylight drift). Expected: no trigger. Tested by `exposure-step` and `slow-drift` in Task 7.
5. **She slides the page or turns to a new one.** Expected: one `page` upload and a fresh reference, not a burst of ink triggers. Tested by `page-shift` in Task 7.

## Parallel tracks

Task 1 runs first, with the owner at the Mac for its camera steps. Three sub-teams then build in disjoint directories, at most three at a time. One builder then converges Tasks 12–14.

| Track | Tasks, in order | Directories it writes |
|---|---|---|
| **A: native and main** | 2 → 3 → 9 → 10 | `native/**`, `scripts/native.mjs`, `docs/research/spikes/p3-tcc/**` (Task 3's `helper` mode), `apps/desktop/src/main/paper/**`, `apps/desktop/src/renderer/src/paper/{sources/**,types.ts,select-source.ts,paper-store.ts}`, `apps/desktop/tests/unit/paper/{main,sources}/**`; hooks in `main/index.ts`, `main/ipc.ts`, `preload/index.ts`, `shared/bridge.ts` (and `shared/paper-bridge.ts`, only after a failed check D) |
| **B: server and upload** | 4 → 5 → 11 | `services/server/**` (`frames/**`, `alembic/versions/0003_frames.py`, `tests/frames/**`, plus hooks in `config.py`, `app.py`, `api/sessions.py`, `tests/conftest.py`, `pyproject.toml`), `docker-compose.yml`, `packages/shared/src/api/*` (regenerated), `apps/desktop/src/renderer/src/paper/upload/**`, `apps/desktop/tests/unit/paper/upload/**` |
| **C: vision** | 6 → 7 → 8 | `packages/paper-synth/**`, `apps/desktop/src/renderer/src/paper/detector/**`, `apps/desktop/tests/unit/paper/detector/**` |
| **Converge** (one builder) | 12 → 13 → 14 | `apps/desktop/src/renderer/src/paper/*.tsx`, `paper/debug/**`, the i18n catalogs, the session-screen hooks, `apps/desktop/tests/e2e/**`, `apps/desktop/tests/camera/**`, `scripts/camera.mjs`, `scripts/dev.mjs`, README, `CLAUDE.md`, CI |

Each track works on its own branch: `claude/p3-native`, `claude/p3-server` or `claude/p3-vision`, each cut from `claude/p3-paper-view` after Task 1. Each merges back when it finishes.

Shared files:
- root `package.json`: Track A adds `build:native` and `test:native`; Track C adds `gen:paper-clip`.
- `pnpm-lock.yaml` and `apps/desktop/package.json`: only Track C adds JavaScript dependencies (`@tassel/paper-synth`, `@techstark/opencv-js`), and only Track C edits `apps/desktop/src/renderer/index.html` (the CSP).

Before Task 12, merge in the order A, B, C. Rerun `pnpm install` after merging C.

Types that cross tracks are committed in Task 1, before the tracks split, as two type-only files:
- `apps/desktop/src/shared/paper-bridge.ts`;
- `apps/desktop/src/renderer/src/paper/contracts.ts`.

No track redefines them. A track that needs a change to one sends a `QUESTION:` to `main` first.

## Merging with P2

P2 touches `services/server/src/tassel/voice/**` and `renderer/src/tutor/live/**`. The two plans meet in these files:
- **`config.py` and `pyproject.toml`:** both plans append fields or dependencies. Keep both, then run `uv lock`.
- **`packages/shared/src/api/openapi.json` and `schema.d.ts`:** never hand-merge them. Merge, then run `pnpm gen:api`.
- **Alembic:** whichever plan merges second points its migration's `down_revision` at the other's head, and renumbers its file if both used `0003`. Run `uv run alembic heads`; expect one head.
- **`shared/bridge.ts`, `preload/index.ts`, `main/index.ts`:** both plans add adjacent lines. Keep both.
- **CI and `scripts/dev.mjs`:** both plans add steps. Keep both.

---

### Task 1: TCC and capture spike (the gate)

**Files:**
- Create: `docs/research/spikes/p3-tcc/probe.swift`, `docs/research/spikes/p3-tcc/Info.plist`, `docs/research/spikes/p3-tcc/main.cjs`, `docs/research/spikes/p3-tcc/run.mjs`, `docs/research/spikes/p3-tcc/RESULTS.md`
- Create: `scripts/check-no-frames.mjs`
- Create (type-only contracts for the parallel tracks): `apps/desktop/src/shared/paper-bridge.ts`, `apps/desktop/src/renderer/src/paper/contracts.ts`
- Modify: `.gitignore` (add `.cache/`, `native/deskview-helper/.build/`, `docs/research/spikes/p3-tcc/.out/`)
- Modify: root `package.json` (`check` gains `node scripts/check-no-frames.mjs`)
- Modify: `docs/research/spikes/README.md` (add a row for `p3-tcc/`)

**Interfaces:**
- Produces: `paper-bridge.ts` exactly as in Task 9's Interfaces (types and `PAPER_IPC`; Task 9 wires it), and `contracts.ts`:

```ts
import type { PaperSourceKind } from '../../../shared/paper-bridge';
export type { PaperSourceKind };
export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt];                                    // TL, TR, BR, BL, in frame pixels
export interface NormRect { x: number; y: number; w: number; h: number } // page coordinates 0–1
export interface CellMask { cols: number; rows: number; cells: Array<[number, number]> }
export interface DetectorStats { t: number; busy: boolean; occluded: boolean; quiet: number; cols: number; rows: number;
  changed: number[]; solid: number[]; quad: Quad | null; refAgeMs: number | null; triggers: number }
export interface DetectorTrigger { reason: 'ink' | 'page'; capturedAt: string; full: Blob; crop: Blob | null; width: number; height: number;
  pageFound: boolean; pageQuad: Quad; cropRect: NormRect | null; mask: CellMask | null; changedCells: number; inkPixels: number; erasePixels: number }
export interface UploadStats { sent: number; pending: number; failed: number; lastError: 'offline' | 'server' | 'rejected' | 'gone' | null }
```

- Produces: `RESULTS.md`, with one verdict per check (`PASS`, `FAIL` or `NOT RUN`), the JSON lines each check printed, and no images. Later tasks branch on these verdicts:

| Check | What it shows | On PASS | On FAIL |
|---|---|---|---|
| **H** | A probe spawned by a LaunchServices-launched Electron reads Desk View frames using Electron's camera grant | Task 10 sets `MACOS_DEFAULT = 'deskview-helper'`; Task 3 builds `CameraProducer`; Task 14 runs the real-camera spec | `MACOS_DEFAULT = 'window-capture'`. Task 3 builds the server and `ClipProducer`, and records "camera producer deferred to P10 (Developer ID-signed bundle)". Task 14 swaps the camera spec for the owner's window-capture check |
| **A** | The same probe under an Electron the agent started is not authorized (expected) | The responsible-process rule is confirmed | Record it; nothing changes |
| **F** | Chromium's fake camera plays an MJPEG in an agent-started Electron, with no TCC prompt | Task 10's `fake-clip` source as written | Task 10 builds `fake-clip` as an in-renderer MJPEG player: `fetch` → split JPEGs → `createImageBitmap` → canvas `captureStream()` |
| **P** | `new MediaStreamTrackProcessor({track})` works in the window, and its `readable` transfers to a worker | Task 8's sampler as written | Task 8 samples with `requestVideoFrameCallback` and `new VideoFrame(video)`, transferred to the worker |
| **T** | A display-media handler that answers `callback({ video: request.frame })` gives `getDisplayMedia` frames in an agent-started Electron, with no Screen Recording grant | Task 13's window-capture and unavailable specs as written | Those two specs become unit-only, and Task 14 adds them to the owner's checklist |
| **C** | Playwright `chromium.connectOverCDP` drives an Electron started by `open -n -a … --args … --remote-debugging-port=9333`, attached only after the window has loaded its page, through `browser.contexts()[0]` | Task 14 drives the UI over CDP | Task 14 uses a `--paper-selftest=<file>` mode: the app records frame counts to the file and quits |
| **E** | `open --env TASSEL_SPIKE=1` reaches `process.env` of the launched app (`open -h` on this Mac lists `--env`) | Task 14 passes `TASSEL_*` with `--env` | Task 9 adds `--tassel-env-file=<json>`, read at startup when not packaged |
| **D** | `AVCaptureDeskViewApplication` presents the Desk View app from the probe (**owner at the Mac** watches) | Task 3 implements `openSetup` | Task 9 adds `paper.openDeskViewApp()`, which calls `shell.openPath('/System/Library/CoreServices/Applications/Desk View.app')` (bundle `com.apple.DeskCam`); Task 12's setup button uses it |
| **S** | The system picker (`useSystemPicker`) lets the owner pick the Desk View window, and capture runs without a Screen Recording grant (**owner at the Mac**) | Task 10's window capture as written | Record it. Window capture still ships, and Task 12's denied state covers its permission |

- [ ] **Step 1: Write the frame guard's failing check.** Run `node scripts/check-no-frames.mjs --paths a.JPG docs/x.png`. Expected: fails, because the script doesn't exist yet.
- [ ] **Step 2: Implement `scripts/check-no-frames.mjs`.**
  - It reads `git ls-files` (or the `--paths` list) and exits 1 naming every path that ends in `.jpg`, `.jpeg`, `.mjpeg` or `.y4m`, ignoring case.
  - Otherwise it prints `check-no-frames: no camera frames tracked` and exits 0.
  - Add it to `check`, and add the `.gitignore` lines.
- [ ] **Step 3: Verify the guard.** `node scripts/check-no-frames.mjs --paths a.JPG docs/x.png` exits 1 and lists only `a.JPG`. Then `node scripts/check-no-frames.mjs` exits 0.
- [ ] **Step 4: Write `probe.swift` and `Info.plist`.** The probe is one file with no dependencies. Build it with `swiftc probe.swift -o .out/probe -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist`. The plist has `CFBundleIdentifier` `dev.tassel.p3-probe` and `NSCameraUsageDescription`. Flags:
  - `--status`: print `{"check":"status","camera":<raw authorizationStatus>}`. Never call `requestAccess`.
  - `--capture <n>`: request access if not determined, open the first `.deskViewCamera` device, count `n` frames, then print `{"check":"capture","camera":…,"device":"<name>","frames":n,"width":w,"height":h,"fps":f}`. It writes no image anywhere.
  - `--present-setup`: call `AVCaptureDeskViewApplication().present()` and print the outcome.
  - `--write-mjpeg <path> <frames>`: write a synthetic MJPEG (solid frames with a moving bar, via Core Image JPEG). It is not a camera frame, and the guard forbids committing it.
- [ ] **Step 5: Write `main.cjs`.** This is an Electron main for the spike only, not product code. It reads `--mode`, `--probe`, `--out` and `--clip` from argv, and appends one JSON line per result to `--out`. Every mode first records `systemPreferences.getMediaAccessStatus` for camera, microphone and screen. The modes:
  - `status` and `capture`: spawn the probe with that flag and relay its line.
  - `fake-camera`:
    - append `use-fake-device-for-media-stream` and `use-file-for-fake-video-capture=<clip>` before ready (the file switch does nothing without the first);
    - open a hidden window on a privileged `spike://` scheme (`standard`, `secure`), mirroring `app://tassel`;
    - call `getUserMedia({ video: true })` (video only, so no microphone prompt can reach the agent);
    - read 10 frames through `MediaStreamTrackProcessor`, with `readable` transferred to a worker (check P);
    - record the track's settings and label and the frame count.
  - `self-capture`: register a display-media handler that answers `{ video: request.frame }`, call `getDisplayMedia({ video: true })` in a hidden window, and record the frame count and size (check T).
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
    3. Run `chromium.connectOverCDP('http://127.0.0.1:9333')`, using Playwright from `apps/desktop`. Take `browser.contexts()[0].pages()[0]` and evaluate `document.title` ([connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)).
    4. Close the app with the CDP `Browser.close`.
  - **E:** H's command plus `--env TASSEL_SPIKE=1`; `main.cjs` records `process.env.TASSEL_SPIKE`.
  - **D and S:** H's launch with `--mode capture --present-setup`, or `--mode picker`. Both print what the owner should look for and wait for Enter.
- [ ] **Step 7: Run the unattended checks.** Run `node docs/research/spikes/p3-tcc/run.mjs A F P T C E`. Expected:
  - A reports the probe isn't authorized;
  - F shows at least 10 frames at the clip's size;
  - P shows frames reaching the worker;
  - T shows frames at the hidden window's size;
  - C reads the title `p3-spike`;
  - E reads `1`.
- [ ] **Step 8 (owner at the Mac): Run H, D and S.** Run `node docs/research/spikes/p3-tcc/run.mjs H D S`. If macOS asks about the camera for Electron, the owner decides; an agent never clicks it. Expected for H: frames 30, with the Desk View device's size (1920×1440 on this Mac if the WWDC22 format holds).
- [ ] **Step 9: Write `RESULTS.md`.** Include the date, macOS 26.6.2, Electron 44.9.0, Swift 6.3.3, each check's verdict and JSON line, and the filled-in decision table.
- [ ] **Step 10: Write the contracts.** Create `paper-bridge.ts` (Task 9's Interfaces, types and `PAPER_IPC` only) and `contracts.ts` (above). Run `pnpm --filter @tassel/desktop typecheck`. Expected: exit 0.
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
- Modify: root `package.json` (`build:native` = `node scripts/native.mjs build`, `test:native` = `node scripts/native.mjs test`)

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
  - `build`: `swift build -c release --package-path native/deskview-helper`, then `codesign --force --sign - <binary>` to bind the embedded `Info.plist`. Before Task 3 adds the executable, only the build runs.
  - `test`: `swift test --package-path native/deskview-helper`, plus the Command Line Tools flags from Global Constraints whenever `xcode-select -p` ends with `/CommandLineTools`.
  - `path`: prints `<swift build -c release --show-bin-path>/deskview-helper`.
  - On another OS: the skip line, exit 0.

- [ ] **Step 1: Write the failing tests** (Swift Testing, `import Testing`):
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
- [ ] **Step 2: Run them and confirm they fail.** Run `node scripts/native.mjs test`. Expected: FAIL (the package or its sources are missing).
- [ ] **Step 3: Implement `DeskViewCore` and `scripts/native.mjs`.**
- [ ] **Step 4: Run them and confirm they pass.** Run `node scripts/native.mjs test`. Expected: PASS, every test above.
- [ ] **Step 5: Commit.** `git add native scripts/native.mjs package.json && git commit -m "feat(native): Desk View helper core with protocol v1, auth and pacing"`

### Task 3: Helper server, producers and Desk View setup (Swift)

**Files:**
- Modify: `native/deskview-helper/Package.swift`:
  - add the executable target `deskview-helper`, which depends on `DeskViewCore`, uses Swift 5 language mode if AVFoundation's delegate isolation fights strict concurrency, and sets `linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Sources/deskview-helper/Info.plist"])]`;
  - add the test target `DeskViewHelperTests`, which depends on the `deskview-helper` executable target, so that `swift test` builds the binary first.
- Create: `native/deskview-helper/Sources/deskview-helper/main.swift`. It reads the env, starts the server, prints the ready line, and exits on stdin EOF or SIGTERM.
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
  - loops the file's JPEGs at `fps`, with pts from a monotonic clock;
  - reports `devices()` as `[{id: "clip", name: "Test clip", builtIn: true}]`;
  - reports `welcome` camera `authorized`, and requests no camera access.
- **`CameraProducer`:**
  - discovers devices with `AVCaptureDevice.DiscoverySession(deviceTypes: [.deskViewCamera], mediaType: .video, position: .unspecified)` ([deskViewCamera](https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicetype-swift.struct/deskviewcamera), macOS 13+);
  - picks the requested device, else the first that isn't a Continuity Camera (`builtIn`), else the first;
  - uses `AVCaptureVideoDataOutput` with `alwaysDiscardsLateVideoFrames = true` ([doc](https://developer.apple.com/documentation/avfoundation/avcapturevideodataoutput/alwaysdiscardslatevideoframes));
  - paces in software with `Pacer`, leaving the device's `activeVideoMinFrameDuration` alone. WWDC22 gives Desk View one format, 420v 1920×1440 at 30 fps ([10018](https://developer.apple.com/videos/play/wwdc2022/10018/)).
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
- Modify: `services/server/src/tassel/config.py`, `services/server/src/tassel/app.py`, `services/server/pyproject.toml` (`boto3>=1.43,<2`), `docker-compose.yml`
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
    - `VGW_META_SIDECAR=/meta`: a bind mount on macOS has no xattrs, and the sidecar removes that dependency;
    - `VGW_PORT=:7070`, `VGW_HEALTH=/health`, `VGW_REGION=us-east-1`;
  - named volumes `s3-data:/data` and `s3-meta:/meta`;
  - healthcheck `["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:7070/health"]`: the image is Alpine with busybox wget but no curl ([Dockerfile](https://github.com/versity/versitygw/blob/main/Dockerfile)).
- **Region:** Versity checks the region inside the signature, so `s3_region` must equal `VGW_REGION`.

- [ ] **Step 1: Write the failing tests:**
  - `test_memory_store_roundtrip_and_prefix_delete`: put `a/1`, `a/2`, `b/1`; `delete_prefix("a/")` returns 2; `get("a/1")` is `None`; `b/1` remains.
  - `test_s3_store_roundtrip_against_local_s3`: bucket `tassel-test-<8 hex>`, created on first put. Put and get the bytes; `delete_prefix` with `page_size=2` over 5 objects returns 5; then `get` is `None`. The fixture fails with "Local S3 isn't running: docker compose up -d s3" when port 7070 refuses, and deletes its bucket afterwards.
  - `test_s3_store_is_lazy`: constructing it never calls a spy `client_factory`.
  - `test_make_object_store_picks_the_setting`.
- [ ] **Step 2: Run them and confirm they fail.** Run `docker compose up -d db s3 && uv run --directory services/server pytest tests/frames/test_objects.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement the store, settings, compose service and wiring.**
- [ ] **Step 4: Run them and confirm they pass.** Run `uv run --directory services/server pytest -v && uv run --directory services/server ruff check`. Expected: PASS, and P1's tests still pass.
- [ ] **Step 5: Commit.** `git add docker-compose.yml services/server && git commit -m "feat(server): object store with S3 and memory backends, local Versity S3"`

### Task 5: Frames API

**Files:**
- Create: `services/server/src/tassel/frames/models.py`, `tables.py`, `repo.py`, `jpeg.py`, `keys.py`, `api.py`
- Create: `services/server/alembic/versions/0003_frames.py`
- Modify:
  - `services/server/src/tassel/app.py` (include the frames router);
  - `services/server/src/tassel/config.py` (`frame_max_bytes: int = 8 * 1024 * 1024`, `crop_max_bytes: int = 2 * 1024 * 1024`, `frame_min_interval_s: float = 1.0`);
  - `services/server/src/tassel/api/sessions.py` (the delete route deletes frame objects first);
  - `services/server/tests/conftest.py`: split the `client` fixture. A new `app` fixture builds `create_app(Settings(database_url=…, object_store="memory", frame_min_interval_s=0))`; `client` wraps that app; a new `store` fixture returns `app.state.object_store`. Tests that need other settings build their own app the same way;
  - `services/server/pyproject.toml` (`python-multipart>=0.0.32`; dev group `pillow>=12`).
- Modify (generated): `packages/shared/src/api/openapi.json`, `packages/shared/src/api/schema.d.ts`
- Test: `services/server/tests/frames/test_frames_api.py`, `test_jpeg.py`, `test_frame_meta.py`, `services/server/tests/frames/frame-meta-example.json`

**Interfaces:**
- Consumes: `ObjectStore` and `get_object_store` (Task 4); `current_learner`, `sessions_repo.get_for` and `get_db` (P1).
- Produces:

```python
FrameReason = Literal["ink", "page"]
PaperSourceKind = Literal["deskview-helper", "window-capture", "fake-clip", "screen"]
class Point(BaseModel): x: float; y: float                         # frame pixels, >= 0
class NormRect(BaseModel): x: float; y: float; w: float; h: float  # page coordinates in [0, 1]; x+w and y+h <= 1 (1e-6 slack)
class CellMask(BaseModel): cols: int; rows: int; cells: list[tuple[int, int]]  # cols, rows in 1..200; <= 40000 cells, each in range
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

- **Table `frames`:**
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
  - `test_foreign_session_404_on_post_list_and_image`.
  - `test_list_is_newest_first_and_limited`.
  - `test_image_returns_full_and_crop_bytes`, `test_image_missing_crop_404`.
  - `test_delete_session_deletes_objects_then_rows`: the store has no keys left under the prefix, and the frames table is empty.
  - `test_jpeg_dimensions`: baseline and progressive (Pillow `progressive=True`) give `(64, 48)`; `b"nope"` raises `NotJpeg`.
  - `test_frame_meta_example_validates`. `frame-meta-example.json` is an `ink` meta: source `fake-clip`, `captured_at` `2026-10-17T14:32:05.120Z`, `page_found` true, a quad, crop_rect `{x:0.1, y:0.2, w:0.3, h:0.25}`, a mask `{cols:50, rows:38, cells:[[5,12],[6,12]]}`, and detector `{changed_cells:2, ink_pixels:31, erase_pixels:0, version:"p3.1"}`. Task 11's contract test reads the same file.
- [ ] **Step 2: Run them and confirm they fail.** Run `uv run --directory services/server pytest tests/frames -v`. Expected: FAIL.
- [ ] **Step 3: Implement the models, migration `0003` (`down_revision = "0002"`), repo, routes and delete hook.**
- [ ] **Step 4: Run them and confirm they pass.** Run `uv run --directory services/server pytest -v && uv run --directory services/server ruff check && uv run --directory services/server alembic heads`. Expected: PASS, clean, and one head.
- [ ] **Step 5: Regenerate the API types.** Run `pnpm gen:api && pnpm check:api`. Expected: exit 0, with `FrameOut` and the frame routes in `schema.d.ts`.
- [ ] **Step 6: Commit.** `git add services/server packages/shared/src/api && git commit -m "feat(server): frames API with JPEG checks, S3 objects and session cleanup"`

### Task 6: The synthetic clip (`packages/paper-synth`)

**Files:**
- Create: `packages/paper-synth/package.json`:
  - name `@tassel/paper-synth`, `"type": "module"`;
  - `exports: {".": "./src/index.ts"}`;
  - scripts `test` (`vitest run`) and `typecheck`;
  - dependency `jpeg-js` 0.4.4.
- Create: `packages/paper-synth/tsconfig.json` (extends the base; `allowImportingTsExtensions: true`, `noEmit: true`, `types: ["node"]`). Relative imports carry `.ts`, so Node runs the CLI directly.
- Create: `packages/paper-synth/src/index.ts`, `rng.ts`, `geometry.ts`, `glyphs.ts`, `scene.ts`, `raster.ts`, `variants.ts`, `mjpeg.ts`, `truth.ts`
- Create: `packages/paper-synth/scripts/gen-clip.ts`
- Modify: root `package.json` (`gen:paper-clip` = `node packages/paper-synth/scripts/gen-clip.ts`)
- Test: `packages/paper-synth/tests/determinism.test.ts`, `variants.test.ts`, `mjpeg.test.ts`, `truth.test.ts`, `glyphs.test.ts`

**Interfaces:**
- Produces:

```ts
export type VariantName = 'dfa-demo' | 'dfa-short' | 'hand-rests' | 'shadow-pass' | 'exposure-step' | 'page-shift' | 'erase' | 'slow-drift';
export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt];                         // TL, TR, BR, BL
export interface NormRect { x: number; y: number; w: number; h: number }
export interface ExpectedTrigger { reason: 'ink' | 'page'; atMs: number; toleranceMs: number; groups: string[] }
export interface ClipTruth {
  dfa: { states: Array<{ id: string; center: Pt; radius: number; accept: boolean; start: boolean }>;   // page coordinates 0–1
         transitions: Array<{ from: string; to: string; label: string; labelAt: Pt }> };
  groups: Array<{ id: string; startMs: number; endMs: number; bbox: NormRect }>;
  expectedTriggers: ExpectedTrigger[];
}
export interface Clip { name: VariantName; durationMs: number; pageQuadAt(tMs: number, width: number, height: number): Quad; truth: ClipTruth }
export const GENERATOR_VERSION = 1;
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
  - it enters over 0.4 s and leaves the frame over 0.5 s.
- **Timelines** (times in seconds). Expected triggers are computed from the defaults as retract end + 1.0 (stable) + 2.0 (quiet ink), with a tolerance of ±0.7 s.
  - The two clips the app plays, `dfa-demo` and `dfa-short`, open with 6 s of blank page. The worker and OpenCV need that long to start, and a reference taken after the first stroke would hide it.
  - The other variants are for unit tests only, where the detector starts at t = 0.

| Variant | Length | Script | Expected triggers |
|---|---|---|---|
| `dfa-demo` | 56 | The page is blank to 6.0. Then, with the hand moving throughout: start arrow 6.0–7.0; q0 7.2–9.2; edge q0→q1 with `0` 9.6–11.2; q1 11.6–13.6; edge `1` 14.0–15.6; q2 16.0–18.0; edge `0` 18.4–20.0; q3 (double circle) 20.4–23.2. Retract 23.2–23.7, then still to 32.0. Loop `0,1` on q3 32.0–35.0, retract to 35.5, still to 41.0. Loop `1` on q0 41.0–43.6, retract to 44.1, still to 56 | ink at 26.7 (every group so far), ink at 38.5 (`loop-q3`), ink at 47.1 (`loop-q0`) |
| `dfa-short` | 20 | Blank to 6.0; q0 6.0–8.0, retract to 8.5, still | ink at 11.5 (`q0`) |
| `hand-rests` | 16 | q0 1.0–3.0; the hand rests still on the lower right of the page 3.0–9.0, then leaves by 9.5 | ink at 12.5 (`q0` only) |
| `shadow-pass` | 12 | Blank page; a soft shadow (25% darker, Gaussian) crosses it 2.0–5.0 | none |
| `exposure-step` | 12 | q0 already drawn; global brightness −15% at 3.0, and it stays | none |
| `page-shift` | 12 | q0 already drawn; the page slides 60 px right 3.0–3.4 | page at 4.4 |
| `erase` | 14 | q0 and its label already drawn; the label is erased 2.0–3.5, with the hand moving | ink at 7.0 (the label's cells) |
| `slow-drift` | 45 | Blank page; brightness drifts −8% across 40 s | none |

- **The CLI.** `node packages/paper-synth/scripts/gen-clip.ts --variant <name> --out <dir> [--width 960 --height 720 --quality 80 --no-noise]`:
  - writes `<dir>/<variant>-<w>x<h>-<hash8>.mjpeg` and `.truth.json`, where `hash8` is the first 8 hex digits of the SHA-256 of the options and `GENERATOR_VERSION`;
  - skips the work when that file already exists;
  - prints `{"mjpeg","truth","frames","sha256"}` as one JSON line.
- **MJPEG:**
  - 30 fps: Chromium plays MJPEG at the constant `kMJpegFrameRate = 30.0f` and loops at end of file ([file_video_capture_device.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/file_video_capture_device.cc));
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
  - `the hand is out of frame from each expected trigger's atMs − 3000 to atMs`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm install && pnpm --filter @tassel/paper-synth test`. Expected: FAIL.
- [ ] **Step 3: Implement the package and the CLI.** Record the golden hash.
- [ ] **Step 4: Run them and confirm they pass.**
  - Run `pnpm --filter @tassel/paper-synth test && pnpm --filter @tassel/paper-synth typecheck`. Expected: PASS.
  - Then run `pnpm gen:paper-clip --variant dfa-demo --out .cache/paper-clips`. Expected: one JSON line, with 1680 frames.
- [ ] **Step 5: Commit.** `git add packages/paper-synth package.json pnpm-lock.yaml && git commit -m "feat(paper-synth): deterministic synthetic clips of the demo DFA"`

### Task 7: Change-detector core (pure TypeScript)

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/detector/params.ts`, `gray.ts`, `normalize.ts`, `cells.ts`, `homography.ts`, `detector.ts`
- Modify: `apps/desktop/package.json` (devDependency `"@tassel/paper-synth": "workspace:*"`)
- Test:
  - `apps/desktop/tests/unit/paper/detector/gray.test.ts`, `normalize.test.ts`, `cells.test.ts`, `homography.test.ts`, `params.test.ts`, `detector.test.ts`, `variants.test.ts`;
  - the helper `apps/desktop/tests/unit/paper/detector/harness.ts`.

**Interfaces:**
- Consumes: `Pt`, `Quad`, `NormRect`, `CellMask` and `DetectorStats` from `paper/contracts.ts` (Task 1).
- Produces:

```ts
// params.ts
export interface DetectorParams { /* every name in the Global Constraints table */ }
export const DEFAULT_PARAMS: Readonly<DetectorParams>;
export const DETECTOR_VERSION = 'p3.1';
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
export interface CellDiff { cols: number; rows: number; changed: number[]; solid: number[]; inkPixels: number; erasePixels: number }
export function compareCells(reference: Float32Array, current: Float32Array, w: number, h: number, p: DetectorParams): CellDiff;
// homography.ts
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export function homography(from: Quad, to: Quad): Mat3;
export function applyH(h: Mat3, p: Pt): Pt;
export function invertH(h: Mat3): Mat3;
export function quadShift(a: Quad, b: Quad): number;                    // largest corner distance
export function compareSize(quad: Quad, longSide: number, cell: number): { width: number; height: number };
// detector.ts
export interface MotionSample { gray: Uint8Array; width: number; height: number }             // already blurred
export interface PageSample { gray: Uint8Array; width: number; height: number; quad: Quad; found: boolean; frameDiagonal: number }
export interface DetectorTriggerCore { reason: 'ink' | 'page'; t: number; mask: CellMask | null; cropRect: NormRect | null;
  quad: Quad; pageFound: boolean; changedCells: number; inkPixels: number; erasePixels: number }
export function createDetector(params?: Partial<DetectorParams>): {
  step(t: number, motion: MotionSample, samplePage: () => PageSample): DetectorTriggerCore | null; // samplePage only when stable
  stats(): DetectorStats;
  reset(): void;
};
```

- **The `step` algorithm.** Only the decision order is pinned here; the arithmetic follows the signatures.
  1. `busy = movingFraction(previous, motion) > busyFraction`. Busy sets `quiet = 0` and returns null.
  2. Otherwise `quiet++`. Below `stableSamples`, return null.
  3. Call `samplePage()` and normalize it. With no reference yet, the page becomes the reference and step returns null.
  4. The reference's quad and the page's quad differ by more than `pageMoveFraction · frameDiagonal`, or the compare size changed: emit `page` (no mask or crop), and the page becomes the reference.
  5. `diff = compareCells(…)`. With `occlusionMinSolidCells` or more solid cells: `quiet = 0` and return null.
  6. More than `bigChangeFraction` of the cells changed: emit `page` and reset the reference.
  7. Any changed cell that wasn't in the last stable comparison sets `lastNewInkAt = t`.
  8. Trigger `ink` when all three hold: changed ≥ `triggerMinCells`, `t − lastNewInkAt ≥ quietInkMs`, and `t − lastTriggerAt ≥ minTriggerIntervalMs`. The mask is the changed cells; `cropRect` is their bounding box padded by one cell and clamped. The page becomes the reference.
  9. With fewer than `triggerMinCells` changed and `t − refAt ≥ referenceRefreshMs`, the page becomes the reference.

  Both kinds of emit respect `minTriggerIntervalMs`.
- **`harness.ts`:**
  - it renders a paper-synth clip at 640×480, at t = 0, 200, 400 … ms, with noise off unless a test turns it on (`frameIndex` = t / 200);
  - motion is `blur3(boxDownsample(toGray(…), 160×120))`;
  - `samplePage` warps the frame by the clip's true `pageQuadAt(t)` to `compareSize`, with bilinear sampling (test-only code);
  - it returns the triggers and the last stats.

- [ ] **Step 1: Write the failing unit tests:**
  - `toGray uses the integer BT.601 weights`: pure red gives 76.
  - `movingFraction counts only pixels past delta`.
  - `boxBlur matches a naive blur on a 7×5 image`.
  - `normalizeLighting flattens a left-to-right gradient to 1.0 ± 0.02 away from the edges`.
  - `a cell changes at 6 ink pixels and not at 5`; `erasure counts as change`; `a cell over 50% changed is solid`.
  - `homography maps the corners exactly and invertH round-trips within 1e-9`.
  - `compareSize keeps the long side at 800 and the short side a multiple of 16`.
  - `parseParams keeps quietInkMs 2500 and drops quietInkMs -1 and unknown keys`.
  - `detector ignores busy samples, waits for five quiet ones, and makes the first stable page the reference`.
- [ ] **Step 2: Write the failing variant tests (`variants.test.ts`).** Each variant runs through the harness, and every expected trigger must match one actual trigger of the same reason within its tolerance:
  - `dfa-demo triggers three times, each mask covering only its new groups' cells`;
  - `dfa-short triggers once`, and `dfa-short with noise on still triggers once` (sensor noise must never read as ink or motion);
  - `hand-rests never triggers while the hand rests, and its one trigger's mask excludes the hand's cells`;
  - `shadow-pass, exposure-step and slow-drift never trigger`;
  - `slow-drift refreshes the reference by 31 s`;
  - `page-shift emits one page trigger and no ink trigger`;
  - `erase triggers ink with the label's cells`;
  - `no variant triggers twice within 5 s`.
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/detector`. Expected: FAIL.
- [ ] **Step 4: Implement the modules.**
- [ ] **Step 5: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test paper/detector && pnpm --filter @tassel/desktop typecheck`. Expected: PASS. A variant failure means changing the algorithm, never the expected windows. If a default really must change, change it in `DEFAULT_PARAMS`, give the reason in the task report, and recompute the windows in Task 6's table.
- [ ] **Step 6: Commit.** `git add apps/desktop && git commit -m "feat(paper): change-detector core with cell diff, gates and fixtures"`

### Task 8: Page finder and the detector worker

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/detector/opencv-page.ts`, `messages.ts`, `frame-loop.ts`, `worker.ts`, `client.ts`
- Modify: `apps/desktop/package.json` (dependency `@techstark/opencv-js` 5.0.0-release.1)
- Modify: `apps/desktop/src/renderer/index.html`: `script-src 'self' 'wasm-unsafe-eval'`. opencv-js calls `WebAssembly.instantiate` on its embedded binary, and the directive allows WebAssembly compilation only, never `eval`.
- Test: `apps/desktop/tests/unit/paper/detector/opencv-page.test.ts`, `frame-loop.test.ts`, `client.test.ts`

**Interfaces:**
- Consumes: `createDetector`, `DEFAULT_PARAMS`, `parseParams`, `toGray`, `blur3`, `compareSize` and `DETECTOR_VERSION` (Task 7); `DetectorTrigger`, `DetectorStats`, `Quad` and `NormRect` (`paper/contracts.ts`, Task 1).
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
  createWorker?: () => Worker }): { stop(): void };
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
  - until `loadOpenCv` settles, it posts motion-only stats and never calls `detector.step`, so the first reference always comes from the real page finder. If OpenCV fails to load, the whole run uses the fallback crop, and one `error` message says so;
  - on a stable sample it reads the frame at a long side of 960. It calls `findQuad`, keeping the last good quad when that returns null, and falls back to the central `fallbackCrop` region at 640×480 when no quad has ever been found;
  - on a trigger:
    - `encodeFull` makes a JPEG at native size inside `contentRect`, at quality 0.9, with `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob); an unsupported type falls back to PNG, so assert the blob type);
    - `encodeCrop` warps the color page at twice the compare size and crops it to `cropRect`, at quality 0.9;
    - `capturedAt` is the ISO time when the kept frame was sampled.
- **Frames in the worker:** `VideoFrame` is exposed in workers, is transferable, and can be drawn with `drawImage` ([IDL](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/modules/webcodecs/video_frame.idl)).
- **`client.ts`:**
  - It spawns `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
  - It creates `new MediaStreamTrackProcessor({ track })` in the window and transfers `processor.readable`. Chromium 152 exposes the processor on Window only ([IDL](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/modules/breakout_box/media_stream_track_processor.idl), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor)). A track itself can't be transferred to a worker ([chromestatus](https://chromestatus.com/feature/5747241384935424)), but streams can ([chromestatus](https://chromestatus.com/feature/5298733486964736)).
  - If Task 1's check P failed, it uses the `requestVideoFrameCallback` sampler instead.
- **OpenCV in the worker:** `@techstark/opencv-js`'s default export is a Promise that resolves to `cv`, with the WebAssembly embedded in the JS ([repo](https://github.com/TechStark/opencv-js)).
  - Whether Vite bundles it into a module worker is unverified; Step 4's build and Task 13's E2E prove it.
  - If Vite can't bundle it, load it in the worker with `importScripts` from a copied `public/opencv.js`, and say so in the report.

- [ ] **Step 1: Write the failing tests:**
  - `findPageQuad finds the dfa-demo page within 4 px of its true corners` (Node; renders frame t=0 at 960×720; loads OpenCV once per file).
  - `findPageQuad returns null on a frame of plain desk`.
  - `warpGray fills the output with page`: the mean of each 10×10 corner patch is above 235.
  - `frame loop samples every 200 ms and closes every frame it doesn't keep`: 60 fake frames at 30 fps lead to 10 samples, and every frame but the kept one has `close` called.
  - `frame loop posts stats once per sample`.
  - `frame loop never steps the detector before OpenCV settles, and falls back to the central crop when it fails`.
  - `frame loop encodes the full frame at native size on trigger, and the crop inside the page`.
  - `createChangeDetector forwards stats and triggers, and terminates the worker on stop` (fake Worker).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/detector`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.** `worker.ts` wires `createFrameLoop` to `OffscreenCanvas`, `loadOpenCv` and `postMessage`.
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e shell`. Expected: PASS. The build emits a worker chunk containing OpenCV, and the shell spec still refuses inline scripts under the new CSP.
- [ ] **Step 5: Commit.** `git add apps/desktop pnpm-lock.yaml && git commit -m "feat(paper): OpenCV page finder and change-detector worker"`

### Task 9: Main-process paper plumbing

**Files:**
- Create: `apps/desktop/src/main/paper/config.ts`, `switches.ts`, `display-media.ts`, `helper-path.ts`, `helper-supervisor.ts`, `camera-access.ts`, `ipc.ts`
- Modify:
  - `apps/desktop/src/shared/paper-bridge.ts`, from Task 1: only if Task 1's check D failed, adding `openDeskViewApp(): Promise<void>` and its channel `paper:openDeskViewApp`;
  - `apps/desktop/src/shared/bridge.ts` (`paper: PaperBridge` on `TasselBridge`);
  - `apps/desktop/src/preload/index.ts` (expose `paper`);
  - `apps/desktop/src/main/ipc.ts` (export its `handle` as `handleTrusted`; no behavior change);
  - `apps/desktop/src/main/index.ts`:
    - `applyPaperSwitches(app.commandLine)` right after `applyUserDataOverride()`;
    - after ready, `registerDisplayMedia(session.defaultSession, …)` and `registerPaperIpc(…)`;
    - `app.on('will-quit', () => void helper.stop())`.
- Test: `apps/desktop/tests/unit/paper/main/config.test.ts`, `switches.test.ts`, `display-media.test.ts`, `helper-path.test.ts`, `helper-supervisor.test.ts`, `camera-access.test.ts`, `ipc.test.ts`

**Interfaces:**
- Consumes: `paper-bridge.ts`, which Task 1 committed with exactly the first block below.
- Produces:

```ts
// shared/paper-bridge.ts (committed in Task 1)
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
// main/paper/*
export function readPaperConfig(env?: NodeJS.ProcessEnv, packaged?: boolean): PaperConfig;
export function applyPaperSwitches(commandLine: { appendSwitch(name: string, value?: string): void }, env?: NodeJS.ProcessEnv, packaged?: boolean, exists?: (p: string) => boolean): void;
export function registerDisplayMedia(session: Session, opts: { platform: NodeJS.Platform; fakeDisplay: 'self' | null;
  getSources: typeof desktopCapturer.getSources }): void;
export function helperPath(env: NodeJS.ProcessEnv, at: { packaged: boolean; resourcesPath: string; startDir: string; platform: NodeJS.Platform;
  exists(p: string): boolean }): string | null;
export interface HelperSupervisor { start(): Promise<HelperStart>; stop(): Promise<void> }
export function createHelperSupervisor(deps: { path: string | null; platform: NodeJS.Platform; clip: string | null;
  spawn: typeof import('node:child_process').spawn; randomToken(): string; readyTimeoutMs?: number; log(line: string): void }): HelperSupervisor;
export function createCameraAccess(deps: { platform: NodeJS.Platform; systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus' | 'askForMediaAccess'>;
  openExternal(url: string): Promise<void>; fake: CameraAccess | null; log(line: string): void }): { status(): CameraAccess; request(): Promise<boolean>; openSettings(): Promise<void> };
export function registerPaperIpc(deps: { config: PaperConfig; helper: HelperSupervisor; camera: ReturnType<typeof createCameraAccess> }): void;
```

- **`readPaperConfig`:**
  - `source` is a known value or `auto`;
  - `debug` is `TASSEL_PAPER_DEBUG === '1'`;
  - `helperClip` means `TASSEL_HELPER_CLIP` names an existing file;
  - `fakeClip` means the source is `fake-clip` and `TASSEL_FAKE_CLIP` names an existing file;
  - `params` is the finite numbers in `TASSEL_PAPER_PARAMS`; invalid JSON gives `{}` with one warning;
  - when packaged, the source is `auto`, `deskview-helper`, `window-capture` or `screen`, and every fake is off.
- **`applyPaperSwitches`:** only when not packaged, the source is `fake-clip` and the clip exists, it appends `use-fake-device-for-media-stream` and `use-file-for-fake-video-capture=<absolute path>`. A missing file logs its path and appends nothing, and the panel then shows the unavailable state.
  - Switches must be appended before `ready` ([command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)); Electron's own test runner appends `use-fake-device-for-media-stream` this way ([spec/index.js](https://github.com/electron/electron/blob/44-x-y/spec/index.js)).
  - The file switch is read only inside the fake-device branch, so it needs both ([create_video_capture_device_factory.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/create_video_capture_device_factory.cc), [media_switches.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/media/base/media_switches.cc)).
- **`registerDisplayMedia`** ([setDisplayMediaRequestHandler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts); [44-x-y source](https://github.com/electron/electron/blob/44-x-y/docs/api/session.md)):
  - `fakeDisplay === 'self'` (not packaged): the handler answers `callback({ video: request.frame })`, which captures the tab holding that frame, with no system picker.
  - Otherwise, on darwin: `{ useSystemPicker: true }`. It is experimental and macOS 15+; when the picker exists, the handler is never invoked. Its handler grants the first `screen` source, for older macOS only.
  - Elsewhere, the handler grants `(await getSources({ types: ['screen'] }))[0]` ([desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)).
  - With no source, or a null `request.frame`, it calls `callback(null)`, which rejects `getDisplayMedia` with an AbortError. An empty `{}` would make Electron throw "Video was requested, but no video stream was provided".
- **`helperPath`:**
  - `TASSEL_DESKVIEW_HELPER` if set;
  - packaged: `<resourcesPath>/deskview-helper`, which P10 places;
  - otherwise it walks up from `startDir` (`__dirname`, which is `out/main`) at most six levels, to the first directory holding `native/deskview-helper/Package.swift`, and returns `native/deskview-helper/.build/release/deskview-helper` under it. This works for `pnpm dev`, Playwright and LaunchServices launches alike;
  - null off darwin, or when nothing is found.
- **Supervisor:**
  - off darwin, `start()` returns `unsupported` without spawning;
  - one process at a time: a second `start()` returns the running handle;
  - the token is 32 random bytes in hex;
  - the child's env is `PATH`, `HOME`, `TMPDIR`, `TASSEL_HELPER_TOKEN` and, when set, `TASSEL_HELPER_CLIP`;
  - stdio is `['pipe', 'pipe', 'pipe']`, and stdin stays open, so the helper exits if Electron dies;
  - the ready line, within `readyTimeoutMs` (5000), gives `{ ok: true, url: 'ws://127.0.0.1:<port>', token }`; a timeout kills the child and returns `timeout`; ENOENT returns `missing-binary`; any other spawn error returns `spawn-failed`;
  - stderr lines go to `log`;
  - `stop()` sends SIGTERM, then SIGKILL after 2 s;
  - an unexpected exit clears the handle.
- **Camera access** ([systemPreferences docs](https://www.electronjs.org/docs/latest/api/system-preferences)):
  - on darwin it maps `getMediaAccessStatus('camera')`; elsewhere it returns `unknown`;
  - `request()` calls `askForMediaAccess('camera')`;
  - `openSettings()` opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Camera` with `shell.openExternal`, which goes through `NSWorkspace`. Apple doesn't document these links. On macOS 26.6.2 the Privacy & Security extension still accepts that id and contains `Privacy_Camera`, and through `NSWorkspace.open` they have worked where `open <url>` failed ([forum 709289](https://developer.apple.com/forums/thread/709289)). Task 14 has the owner confirm the pane opens.
  - with `TASSEL_FAKE_CAMERA_ACCESS` set and not packaged, `status()` returns the fake, `request()` returns `fake === 'granted'`, and `openSettings()` logs `[tassel] fake: open camera settings` instead of opening anything.

- [ ] **Step 1: Write the failing tests** (mocked `electron` and `child_process`, as in P1's `ipc.test.ts`):
  - **config:** `defaults to auto with fakes off`; `reads every variable`; `a packaged app ignores the fakes and fake-clip`; `bad params JSON gives {}`.
  - **switches:** `appends both switches with the absolute clip path`; `nothing when packaged`; `nothing and one error line when the clip is missing`; `nothing for other sources`.
  - **display-media:** `the self fake answers with request.frame`; `a null frame denies with callback(null)`; `darwin sets useSystemPicker true`; `win32 grants the first screen`; `no sources denies with callback(null)`.
  - **helper-path:** `the env override wins`; `finds the repo from out/main`; `packaged uses resourcesPath`; `null off darwin`.
  - **supervisor:**
    - `resolves url and token from the ready line`;
    - `the token is 64 hex characters and reaches the child only through its env`: never argv, and none of the parent's other variables;
    - `times out after 5 s and kills the child` (fake timers);
    - `ENOENT is missing-binary`; `a second start reuses the process`;
    - `stop sends SIGTERM, then SIGKILL after 2 s`;
    - `unsupported off darwin without spawning`.
  - **camera-access:** `maps each status`; `the fake overrides`; `openSettings uses the Privacy_Camera URL`.
  - **ipc:** `every paper channel refuses an untrusted sender`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/main`. Expected: FAIL.
- [ ] **Step 3: Implement the modules and the wiring.** Task 1's verdict E decides whether `--tassel-env-file` is also needed: if E failed, `index.ts` applies the JSON file's `TASSEL_*` keys to `process.env` before anything reads the config, only when not packaged, and that gets a test too.
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck && pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e shell`. Expected: PASS. The shell spec still sees `window.tassel`, now with `paper`.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(desktop): paper bridge, helper supervisor, display media and fake switches"`

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
export interface PaperSource { readonly kind: PaperSourceKind; start(opts?: { deviceId?: string | null; signal?: AbortSignal }): Promise<PaperFeed> }
export class PaperSourceError extends Error { constructor(readonly code: 'denied' | 'unavailable' | 'cancelled' | 'error', message?: string) }
// select-source.ts
export const MACOS_DEFAULT: PaperSourceKind;            // set from Task 1's verdict H
export function choosePaperSource(configured: PaperSourceKind | 'auto', platform: Platform): PaperSourceKind;
export function shouldUpload(kind: PaperSourceKind): boolean;                       // false only for 'screen'
export function needsCameraAccess(kind: PaperSourceKind, config: PaperConfig): boolean; // helper without a clip
export function createPaperSource(kind: PaperSourceKind, deps: SourceDeps): PaperSource;
export interface SourceDeps { bridge: PaperBridge; mediaDevices: MediaDevices; WebSocketCtor?: typeof WebSocket; document?: Document;
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

- **`choosePaperSource`:** a configured kind wins. `auto` gives `MACOS_DEFAULT` on darwin and `screen` on win32 and linux.
- **The helper source:**
  1. `bridge.startHelper()` (not ok → `unavailable`).
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
  - `mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })`;
  - `NotFoundError` or `NotReadableError` → `unavailable`;
  - the track ending → `lost`.
  - In file mode Chromium shows one device, labelled with the file path. It plays at 30 fps and loops ([factory](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/create_video_capture_device_factory.cc), [file device](https://github.com/chromium/chromium/blob/152.0.7977.167/media/capture/video/file_video_capture_device.cc)).
  - `app://tassel` is a secure context, so `getUserMedia` is available there ([is_potentially_trustworthy.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/services/network/public/cpp/is_potentially_trustworthy.cc)).
- **Window capture:**
  - `getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })`;
  - `NotAllowedError` (picker cancelled) → `cancelled`;
  - on the first frame, `findContentTop` runs on a grayscale draw of the video, and gives `contentRect = { x: 0, y: top/h, w: 1, h: 1 − top/h }`;
  - the track ending → `ended`.
- **Screen:** `getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false })`; the track ending → `ended`.
- **`findContentTop`:**
  - scan rows 0 to `floor(0.15·h)`;
  - for each row, take the mean and standard deviation over x from `0.4·w` to `w` (this skips the traffic lights);
  - the title band is the longest prefix of rows whose standard deviation is under 4 and whose mean is within 6 of row 0's (0–255 units);
  - return the band's height if it is at least `0.02·h`, else 0.

- [ ] **Step 1: Write the failing tests:**
  - `choosePaperSource: configured wins; auto picks MACOS_DEFAULT on darwin and screen on win32 and linux`.
  - `shouldUpload is false only for screen` (ruling R7).
  - `decodeFrame reads the contract fixture`: the Global Constraints hex gives seq 7, pts 1234567, 4×3 and a 4-byte JPEG. It rejects bad magic, a buffer under 24 bytes and version 2.
  - `parseServerMessage reads kebab error codes and returns null for an unknown type`.
  - Helper source (FakeSocket, and `decodeImage` and the canvas feed stubbed):
    - `sends hello with the token first, then list and start with fps 15`;
    - `resolves after the first binary frame with the helper's devices`;
    - `permission-denied → denied; no-device → unavailable; close before the first frame → error`;
    - `close after live ends the feed with lost` (Review Focus 3);
    - `stop sends stop, closes the socket and stops the helper`;
    - `startHelper not ok → unavailable`.
  - `findContentTop`: a 40-row band over noise gives 40; noise from row 0 gives 0; a 40-row band with traffic-light circles at the left gives 40; a 10-row band at 720 high gives 0.
  - Display sources:
    - `window capture maps NotAllowedError to cancelled and its ended track to ended`;
    - `fake clip maps NotFoundError to unavailable and its ended track to lost`;
    - `screen requests at most 10 fps`.
  - Paper store: `retry bumps restartNonce and sets retrying`; `useInstead sets the override and bumps restartNonce`; `useDevice sets deviceId and bumps restartNonce`; `reset clears everything`.
  - Helper source: `welcome notDetermined asks for access once, and a refusal gives denied`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/sources`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.** Set `MACOS_DEFAULT` from `docs/research/spikes/p3-tcc/RESULTS.md`, and cite the verdict in a one-line comment.
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(paper): PaperSource for the helper, window capture, fake clip and screen"`

### Task 11: Frame uploader

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/upload/frame-meta.ts`, `frames-api.ts`, `frame-uploader.ts`
- Test: `apps/desktop/tests/unit/paper/upload/frame-meta.test.ts`, `frames-api.test.ts`, `frame-uploader.test.ts`

**Interfaces:**
- Consumes: the regenerated `components['schemas']['FrameOut']` and `ApiClient` (Task 5, `@tassel/shared/api`); `DetectorTrigger`, `UploadStats` and `PaperSourceKind` (`paper/contracts.ts`, Task 1).
- Produces:

```ts
export interface FrameMetaJson {
  reason: 'ink' | 'page'; source: PaperSourceKind; captured_at: string; page_found: boolean;
  page_quad: Array<{ x: number; y: number }> | null; crop_rect: { x: number; y: number; w: number; h: number } | null;
  mask: { cols: number; rows: number; cells: Array<[number, number]> } | null;
  detector: { changed_cells: number; ink_pixels: number; erase_pixels: number; version: string };
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

- **Multipart.** `uploadFrame` uses openapi-fetch's `bodySerializer` to build `FormData`: `frame` = `full`, then `crop` when present, then `meta` = `JSON.stringify(meta)`.
- **Uploader policy:**
  - one upload at a time, in FIFO order;
  - `maxQueue` is 3. When the queue is full, drop the oldest queued `ink` item (a `page` item outlives ink) and count it as failed;
  - a network error or 5xx retries after 1000, 2000 and 4000 ms, then drops the item with `lastError` `offline` (network) or `server` (5xx);
  - 429 waits `Retry-After` seconds (default 1) and doesn't use up an attempt, up to 5 times;
  - 413, 415 or 422 drops the item at once, with `lastError` `rejected`;
  - 404 stops the uploader for good, with `lastError` `gone` (the session was deleted);
  - the first success clears `lastError`;
  - `Clock` is P1's `tutor/clock.ts` interface.

- [ ] **Step 1: Write the failing tests:**
  - `buildFrameMeta matches the server's example`: it reads `services/server/tests/frames/frame-meta-example.json` (relative from the test file), builds from the equivalent trigger, and deep-equals it. This is the contract across languages.
  - `uploadFrame posts frame, crop and meta parts to /v1/sessions/<id>/frames` (a fake fetch inspects the `FormData`).
  - `uploads one at a time, in order`.
  - `5xx retries at 1, 2 and 4 s, then fails with server` (manual clock).
  - `429 waits for Retry-After without spending an attempt`.
  - `422 drops at once with rejected`.
  - `404 stops the uploader with gone`.
  - `a full queue drops the oldest ink item and keeps page items`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper/upload`. Expected: FAIL.
- [ ] **Step 3: Implement the modules.**
- [ ] **Step 4: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm --filter @tassel/desktop typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/desktop && git commit -m "feat(paper): frame uploader with retries, queue cap and the frames API client"`

### Task 12: Capture controller, paper panel and heatmap

**Files:**
- Create: `apps/desktop/src/renderer/src/paper/use-paper-capture.ts`, `PaperPanel.tsx`, `PaperVideo.tsx`, `PaperStateCard.tsx`, `CaptureIndicator.tsx`, `crop-transform.ts`, `paper.css`
- Create: `apps/desktop/src/renderer/src/paper/debug/Heatmap.tsx`
- Modify: `packages/shared/src/i18n/en.json`, `es.json`, `ko.json` (the `paper.*` keys below)
- Test: `apps/desktop/tests/unit/paper/use-paper-capture.test.tsx`, `paper-panel.test.tsx`, `crop-transform.test.ts`, `heatmap.test.tsx`

**Interfaces:**
- Consumes: Tasks 8, 10 and 11; `parseParams` and `invertH`/`homography` (Task 7); `useApi` and `Source` (P1); `Button` and the icons (P1 Task 10).
- Produces:

```ts
export interface CaptureDeps { bridge: PaperBridge; platform: Platform; api: ApiClient; mediaDevices: MediaDevices;
  createSource: typeof createPaperSource; createChangeDetector: typeof createChangeDetector; createUploader: typeof createFrameUploader }
export function usePaperCapture(args: { sessionId: string; sessionSource: Source; cameraOn: boolean; deps?: Partial<CaptureDeps> }): void;
export function PaperPanel(): JSX.Element;                          // reads usePaperStore and the paper config
export function CaptureIndicator(): JSX.Element;                    // the title strip's dot and label, for paper sessions
export function cropTransform(video: { w: number; h: number }, crop: NormRect | null, box: { w: number; h: number }):
  { scale: number; x: number; y: number };                          // contain-fit of the crop region, in CSS pixels
```

- **The controller.** It is mounted once per session screen, so capture continues while the board fills the stage.
  - It does nothing unless `sessionSource === 'paper'`.
  - The uploader lives as long as the session screen: created on mount, stopped on unmount. Turning the camera off never drops queued uploads.
  - The source and the change detector live for one camera-on run. It reruns them on `cameraOn`, `override`, `deviceId` and `restartNonce`.
  - Camera off: stop the source and the detector, and release the helper; status `off`.
  - Camera on:
    1. Status `starting`; kind = `override ?? choosePaperSource(config.source, platform)`.
    2. If `needsCameraAccess`, and the run didn't come from `retry()`: `bridge.cameraAccess()`. `not-determined` asks once with `requestCameraAccess`; `denied` or `restricted` gives `denied` without starting the helper.
       - A retry skips this check. Electron's answer can stay stale until the app restarts ([systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences)), so the fresh helper's `welcome` decides.
       - The run clears `retrying` when it settles.
    3. `createSource(kind).start({ deviceId })`. Errors map to statuses: `denied` → `denied`, `unavailable` → `unavailable`, `cancelled` → `ended`, anything else → `error`.
    4. `setFeed`, then status `live`.
    5. `createChangeDetector(stream, { params: parseParams(config.params), contentRect })`. Its stats go to the store; each trigger goes to `uploader.enqueue({ full, crop, meta: buildFrameMeta(trigger, kind) })` when `shouldUpload(kind)`.
  - `feed.onEnd(reason)` sets the status to that reason and stops the detector.
  - Unmount stops the detector, the feed and the uploader, and resets the store.
- **Layout.** These values come from the mock and the P1 design checklist §4.4 (`docs/superpowers/records/2026-10-17-p1-foundation/design/checklist.md`):
  - **Live:** the video fills the 16px-radius stage card with `object-fit: contain` through `cropTransform`, on the desk color `#cdc4b6`, defined once as `--paper-desk` in `paper.css` (desk only behind a real feed).
  - **Tag:** top-left at 14/14. A paper pill 26px tall, mono 11 uppercase, showing `paper.tag.<kind>`, with a hairline ring.
  - **States:** `PaperStateCard`, on a paper (white) card, not the desk color.
    - It is centered, at most 360px wide, with `role="status"`.
    - Contents: an authored 32px line glyph in `icons.tsx`'s hand (1.6 stroke); the title (Geist 17/520, ink); the body (14/400, smoke-text, wrapping with `text-wrap: pretty`; `word-break: keep-all` under `:lang(ko)`); and pill actions (the first is the ink primary, the rest ghost).
    - No spinner: `starting` is static text.
  - **Actions by state:**
    - `off`: Turn camera on (`useStageStore`'s `toggleCamera`, from P1 Task 13).
    - `denied`: Open System Settings (`openCameraSettings`), then Retry.
    - `unavailable`: Open Desk View setup (Task 10's `openDeskViewSetup`, or `paper.openDeskViewApp()` if Task 1's D failed), then Share the Desk View window instead (`useInstead('window-capture')`).
    - `lost` and `error`: Retry.
    - `ended`: Share again (Retry).
  - **Devices:** when there's more than one, a ghost "Switch camera" button (`paper.devices.switch`) sits beside the tag and cycles `useDevice`.
  - **Uploads failing:** after a failure with `lastError` `offline` or `server`, a paper pill at bottom-left shows `paper.upload.failing` (sans 13, ink, hairline) until the next success.
  - **Debug:** when `config.debug`, a pill at bottom-right holds the heatmap toggle and `paper.debug.stats`. The heatmap is a canvas over the video:
    - changed cells filled with sky (`--color-sky`) at 55% opacity;
    - solid cells in ink at 25%;
    - the page quad as a 1.5px dashed ink line;
    - each cell drawn as a quad through `invertH(homography(quad → page))`.
  - **No iris** anywhere in the panel.
- **`CaptureIndicator`:**
  - status `live`: the red 7px dot and `paper.live` (for example "Desk View · Live");
  - otherwise: a smoke `#7a7876` dot and `paper.source.<kind>`;
  - mono 11.
- **Copy** (exact; ICU placeholders must match across the three languages):

| Key | en | es | ko |
|---|---|---|---|
| `paper.tag.deskview-helper` | Your paper · Desk View | Tu papel · Desk View | 내 종이 · Desk View |
| `paper.tag.window-capture` | Your paper · Desk View window | Tu papel · Ventana de Desk View | 내 종이 · Desk View 창 |
| `paper.tag.fake-clip` | Your paper · Test clip | Tu papel · Clip de prueba | 내 종이 · 테스트 영상 |
| `paper.tag.screen` | Your screen | Tu pantalla | 내 화면 |
| `paper.source.deskview-helper` | Desk View | Desk View | Desk View |
| `paper.source.window-capture` | Desk View window | Ventana de Desk View | Desk View 창 |
| `paper.source.fake-clip` | Test clip | Clip de prueba | 테스트 영상 |
| `paper.source.screen` | Screen | Pantalla | 화면 |
| `paper.live` | {source} · Live | {source} · En vivo | {source} · 실시간 |
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
| `paper.state.unavailable.window` | Share the Desk View window instead | Compartir la ventana de Desk View | 대신 Desk View 창 공유하기 |
| `paper.state.lost.title` | Desk View stopped | Desk View se detuvo | Desk View가 멈췄어요 |
| `paper.state.lost.body` | The camera disconnected or another app is using it. | La cámara se desconectó u otra app la está usando. | 카메라 연결이 끊겼거나 다른 앱이 사용 중이에요. |
| `paper.state.ended.title` | Sharing stopped | Se dejó de compartir | 공유가 중지됐어요 |
| `paper.state.ended.action` | Share again | Compartir de nuevo | 다시 공유하기 |
| `paper.state.error.title` | Something went wrong with the camera | Algo salió mal con la cámara | 카메라에 문제가 생겼어요 |
| `paper.devices.switch` | Switch camera | Cambiar de cámara | 카메라 바꾸기 |
| `paper.upload.failing` | Ada can't see your latest work yet. Reconnecting… | Ada todavía no ve tu trabajo más reciente. Reconectando… | Ada가 아직 최근 작업을 못 보고 있어요. 다시 연결하는 중이에요… |
| `paper.debug.toggle` | Heatmap | Mapa de calor | 히트맵 |
| `paper.debug.stats` | {changed} changed · quiet {quiet}/{stable} · {sent} sent | {changed} cambiadas · quieto {quiet}/{stable} · {sent} enviadas | 변경 {changed} · 정지 {quiet}/{stable} · 전송 {sent} |

  The retry button in the lost and error states reuses `common.retry`.

- [ ] **Step 1: Write the failing controller tests** (jsdom, `renderHook`, every dependency faked):
  - `camera on starts the chosen source, then status is live with the stream`;
  - `camera off stops the feed and detector and releases the helper, while a queued upload still finishes; turning it back on starts again` (Review Focus 2);
  - `unmount stops everything` (Review Focus 2);
  - `not-determined asks once; denied gives denied`; `helper clip mode skips camera access`;
  - `after a denial, Retry skips Electron's cached status and lets the helper's welcome decide`;
  - `unavailable, then useInstead window-capture restarts with window capture`;
  - `triggers upload for camera sources and never for screen`;
  - `a lost feed shows lost and stops the detector` (Review Focus 3);
  - `a non-paper session never starts a source`.
- [ ] **Step 2: Write the failing panel tests:**
  - `each state shows its title, body and actions in en`;
  - `denied in es shows Abrir Configuración del Sistema, which calls openCameraSettings`;
  - `unavailable in ko shows both actions`;
  - `live renders the video and the tag for its kind`;
  - `no heatmap toggle unless debug`;
  - `CaptureIndicator is red only while live`;
  - `cropTransform: no crop is contain-fit; a 10% top crop scales up and shifts by the crop`;
  - `the heatmap draws one quad per changed cell` (a fake 2D context counts the paths).
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop test paper`. Expected: FAIL.
- [ ] **Step 4: Implement the modules and add the catalog keys.** Before the UI, read `.impeccable/mocks/decision/stage.html`, `docs/design-system/DESIGN.md`, and the P1 design checklist §0 and §4.4, whose committed copy is `docs/superpowers/records/2026-10-17-p1-foundation/design/checklist.md`.
- [ ] **Step 5: Run them and confirm they pass.** Run `pnpm --filter @tassel/desktop test && pnpm check:i18n && pnpm --filter @tassel/desktop typecheck`. Expected: PASS, then exit 0.
- [ ] **Step 6: Commit.** `git add apps/desktop packages/shared/src/i18n && git commit -m "feat(paper): capture controller, paper panel states and debug heatmap"`

### Task 13: Stage integration and E2E on fakes

**Files:**
- Modify:
  - `apps/desktop/src/renderer/src/features/session/SessionScreen.tsx`: call `usePaperCapture({ sessionId, sessionSource: session.source, cameraOn })`, where `cameraOn` comes from `useStageStore`.
  - `Stage.tsx`: paper sessions render `<PaperPanel />` where P1 drew "Waiting for Desk View"; the placeholder stays for other sources.
  - `TitleStrip.tsx`: paper sessions render `<CaptureIndicator />` in place of the live dot.
  - `stage-store.ts`: a session opens with `cameraOn: true` (the mock's pressed Camera button), if P1 chose otherwise; update its test.
- Modify: `apps/desktop/src/renderer/src/features/new-session/defaults.ts` and `NewSessionSheet.tsx`: on win32, Paper is enabled only when `paper.getConfig()` says `source === 'fake-clip'` (ruling R11).
- Modify: `apps/desktop/tests/e2e/global-setup.ts`:
  - generate `dfa-short` into `<repo>/.cache/paper-clips` and set `process.env.TASSEL_E2E_CLIP_DFA_SHORT`;
  - on darwin, run `node scripts/native.mjs build` when the helper is missing;
  - give the server `TASSEL_S3_BUCKET` (from `TASSEL_E2E_S3_BUCKET`, default `tassel-e2e`);
  - fail early with "Local S3 isn't running: docker compose up -d s3" when port 7070 refuses.
- Modify: `apps/desktop/tests/e2e/fixtures.ts`, adding:
  - `startPaperSession(page, { type: 'homework', language: 'en' })`, which drives the new-session sheet;
  - `latestSession(page)`, an API call with the app's token;
  - `framesOf(page, sessionId)`.
- Create: `apps/desktop/tests/e2e/paper-fake-clip.spec.ts`, `paper-states.spec.ts`, `paper-window-capture.spec.ts`, `paper-helper-clip.spec.ts`
- Test: P1's `session-screen.test.tsx` gains two tests: `a paper session mounts the paper panel` and `the title strip's dot stays neutral until paper is live`.

**Interfaces:**
- Consumes: `usePaperCapture`, `PaperPanel` and `CaptureIndicator` (Task 12); `useStageStore` (P1 Task 13); `launchApp` and `snap` (P1 Task 8).
- Produces: the screenshots below. Every one shows the synthetic clip or our own window, so `main` may post them.

- [ ] **Step 1: Write the failing unit tests for the modified P1 components.**
- [ ] **Step 2: Write the failing E2E specs.** Every spec collects `page.on('console')` errors and expects none from `paper/`.
  - **`paper-fake-clip.spec.ts`**, with `TASSEL_PAPER_SOURCE=fake-clip`, `TASSEL_FAKE_CLIP=$TASSEL_E2E_CLIP_DFA_SHORT` and `TASSEL_PAPER_DEBUG=1`, and a 90 s timeout:
    1. `startPaperSession`. Within 10 s, `[data-testid=paper-video]` has `videoWidth` 960 and `videoHeight` 720.
    2. The title strip reads "Test clip · Live" next to the red dot.
    3. Within 25 s of going live (the clip's trigger is at 11.5 s), the debug pill reads "1 sent".
    4. `framesOf` returns one frame: reason `ink`, source `fake-clip`, 960×720, `has_crop` true. Its full image starts with `FF D8`.
    5. `snap('p3-paper-live-1440')`, with the heatmap on.
    6. The dock's Camera button turns it off: the panel shows "Camera is off" and the dot is the smoke color. Turned back on, it is live again.

    A second test launches with `TASSEL_UI_LANG=es` and sets the window to 1024×680 through `app.evaluate` (`setSize`). After the fake tutor's split (about 1.4 s in at speed 20), paper and board are both visible, and the paper tag's `scrollWidth ≤ clientWidth`. `snap('p3-paper-split-1024-es')`.
  - **`paper-states.spec.ts`:**
    - Denied: `TASSEL_PAPER_SOURCE=deskview-helper`, `TASSEL_FAKE_CAMERA_ACCESS=denied`, `TASSEL_UI_LANG=es`. The card reads "Tassel no puede usar la cámara", and "Abrir Configuración del Sistema" makes the main process log the fake line. `snap('p3-paper-denied-es')`.
    - Unavailable: `TASSEL_DESKVIEW_HELPER=<a missing path>`, `TASSEL_FAKE_CAMERA_ACCESS=granted`, `TASSEL_UI_LANG=ko`, `TASSEL_FAKE_DISPLAY=self`. The card reads "Desk View 카메라를 찾지 못했어요"; `snap('p3-paper-unavailable-ko')`. Then "대신 Desk View 창 공유하기" turns it live, with the tag "내 종이 · Desk View 창".
  - **`paper-window-capture.spec.ts`:** `TASSEL_PAPER_SOURCE=window-capture`, `TASSEL_FAKE_DISPLAY=self`. It goes live, the tag reads "Your paper · Desk View window", and `snap('p3-paper-window-1440')`.
  - The two specs that use `TASSEL_FAKE_DISPLAY=self` (this one and the unavailable one) rely on Task 1's check T. If T failed, skip them with `test.skip(…, 'needs check T')`; Task 14 moves them to the owner's checklist.
  - **`paper-helper-clip.spec.ts`**, skipped unless darwin: `TASSEL_PAPER_SOURCE=deskview-helper`, `TASSEL_HELPER_CLIP=$TASSEL_E2E_CLIP_DFA_SHORT`.
    1. It goes live at 960×720 through the helper.
    2. The first frame uploads with source `deskview-helper`.
    3. End session, then confirm. Within 2 s, `pgrep -P <app.process().pid> deskview-helper` finds nothing (Review Focus 2).
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @tassel/desktop build && pnpm --filter @tassel/desktop e2e paper-`. Expected: FAIL.
- [ ] **Step 4: Implement the integration.**
- [ ] **Step 5: Run every spec and confirm they pass.** Run `docker compose up -d db s3 && pnpm test && pnpm e2e`. Expected: every P1 and P3 spec passes, and the six P3 screenshots are in `apps/desktop/test-results/screens/`.
- [ ] **Step 6: Exercise it by hand.** Run `TASSEL_PAPER_SOURCE=fake-clip TASSEL_FAKE_CLIP=<dfa-demo clip> TASSEL_PAPER_DEBUG=1 pnpm dev`, through `cross-env` or the shell's own syntax on Windows. Watch three uploads at about 27, 39 and 47 s after the paper goes live, with the heatmap matching the new strokes. Write what you saw in the task report.
- [ ] **Step 7: Commit.** `git add apps/desktop && git commit -m "feat(paper): paper view on the session stage, E2E on the synthetic clip"`

### Task 14: The real camera through LaunchServices, dev workflow and CI

**Files:**
- Create: `scripts/camera.mjs`. On macOS it:
  1. builds the desktop app and the helper;
  2. reads `TASSEL_*` from the shell;
  3. runs `open -n -W -a <apps/desktop/node_modules/electron/dist/Electron.app> --env … --args <abs out/main/index.js>` (or `--tassel-env-file`, after Task 1's E);
  4. exits when the app quits.

  Elsewhere it prints `camera: skipped (Desk View is macOS-only)` and exits 0.
- Create: `apps/desktop/playwright.camera.config.ts` (`testDir: ./tests/camera`, `workers: 1`, `globalSetup: ./tests/e2e/global-setup.ts`, `use: { trace: 'off', screenshot: 'off', video: 'off' }`) and `apps/desktop/tests/camera/paper-camera.spec.ts`
- Modify: `apps/desktop/package.json` (`e2e:camera` = `playwright test -c playwright.camera.config.ts`)
- Modify: `scripts/dev.mjs`:
  - `docker compose up -d db s3`;
  - on macOS, `node scripts/native.mjs build` before Electron, with a warning and no failure when Swift is missing;
  - pass `TASSEL_PAPER_*` and `TASSEL_FAKE_*` through.
- Modify: `README.md` (a "Paper view" section), `CLAUDE.md` (the agent rules below), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: everything above. Task 1's verdicts H, C and E choose the branch below.
- Produces: the spec, the scripts and the docs; no new product interfaces.

- **H PASS and C PASS:** `paper-camera.spec.ts` skips unless `TASSEL_E2E_CAMERA=1` and darwin. The shared global setup has already started the E2E server.
  1. It launches through LaunchServices with `--remote-debugging-port=9334`, passing the E2E `TASSEL_*` with `--env`: the server URL, `TASSEL_TOKEN_STORE=file`, a temp `TASSEL_USER_DATA` and `TASSEL_PAPER_SOURCE=auto`.
  2. It waits for the page, then attaches with `chromium.connectOverCDP` through `browser.contexts()[0]`.
  3. It runs `startPaperSession`.
  4. Within 15 s, `paper-video` has `videoWidth` ≥ 1280. At least 30 `requestVideoFrameCallback` callbacks arrive within 3 s.
  5. It takes **no screenshot**, and saves no frame or trace.
  6. In `finally`, it calls `DELETE /v1/sessions/{id}` with the app's token. That removes every real frame from the local store.
  7. Close through CDP `Browser.close`. Within 2 s, `pgrep -x deskview-helper` finds nothing.
- **H PASS and C FAIL:** the same assertions, through `--paper-selftest=<file>`. Add that mode to `main/paper/config.ts`, with a test: it starts a paper session headlessly, counts 30 frames, writes `{frames, width, height}` and quits.
- **H FAIL:** the spec is replaced by the checklist "Window-capture check (owner at the Mac)" in the README: pick the Desk View window in the system picker; expect live video, an upload in the debug pill, and the dot neutral after End.
- **T FAIL:** that README checklist also covers the window-capture and unavailable flows that Task 13 had to skip.
- **CI** (P1 Task 15's workflow):
  - the server and E2E jobs gain the `versity/versitygw:v1.8.0` service with Task 4's env (`VGW_META_SIDECAR` can be dropped on a Linux runner);
  - the E2E job caches `.cache/paper-clips`, keyed on `packages/paper-synth/src/**`;
  - a new `native` job on `macos-latest` runs `node scripts/native.mjs test`. GitHub's runners have Xcode, and the script's CLT flags apply only under Command Line Tools;
  - the unit jobs on `macos-latest` and `windows-latest` already run paper-synth's golden hash: that is the parity check.
- **`CLAUDE.md` rules:**
  - Camera checks run through `node scripts/camera.mjs` or the camera spec, never `pnpm dev` from an agent shell.
  - Never commit, post or screenshot a real camera frame; `pnpm check` enforces the file part.
  - Agents never answer TCC prompts.
  - `TASSEL_HELPER_CLIP` tests the helper without the camera.

- [ ] **Step 1: Write the failing camera spec** (or the self-test test, for the H PASS and C FAIL branch).
- [ ] **Step 2 (owner at the Mac): Run it and confirm it fails.** Run `TASSEL_E2E_CAMERA=1 pnpm --filter @tassel/desktop e2e:camera`. Expected: FAIL (`scripts/camera.mjs` or the launch helper is missing).
- [ ] **Step 3: Implement `scripts/camera.mjs`, the camera config, the `dev.mjs` changes, the docs and CI.**
- [ ] **Step 4 (owner at the Mac): Run it and confirm it passes.** Same command. Expected: PASS, and no new file under `test-results/` holds an image.
- [ ] **Step 5: Verify the whole plan.**
  - `pnpm check`: exit 0, including `check-no-frames`.
  - `pnpm test`, then `node scripts/native.mjs test`, then `pnpm e2e`: all pass.
  - On a Windows PC: `pnpm test`, then `pnpm e2e paper-fake-clip`. Expected: PASS, with the golden hash unchanged; note who ran it in the report.
- [ ] **Step 6: Run `pnpm dev` and `node scripts/camera.mjs`** (owner at the Mac for the camera). Expected: the library opens; a paper session shows her paper live with the dot red; the camera light goes off after End session.
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
