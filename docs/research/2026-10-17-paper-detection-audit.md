# Paper detection and new-work audit

2026-10-17. Examined the original detector at live base `7e0ceb9`, in the isolated
`team2/windows-webcam` checkout. The owner's request is to keep ordinary Windows
webcam access, remove the added first-page upload, and investigate the existing
automatic paper/new-work detector. No replacement detector, timer-based capture,
manual send button, or threshold relaxation was installed in this audit.

## Rollback

The added `sendInitialPage` option, its worker message, detector branch, and
first-page test were removed. `client.ts`, `messages.ts`, `worker.ts`,
`detector.ts`, and the original `detector.test.ts` match the base versions.
`use-paper-capture.ts` retains webcam source/watchdog support, without the extra
upload option. The webcam E2E expectation now requires an original `ink` event.
Source selection, device dropdown, webcam frame API support and its database
migration remain. Drawing code is unchanged.

## What was actually demonstrated

These are deterministic synthetic reproductions, not a claim that we have
identified the exact pixels behind the owner's mistaken upload. No live camera,
microphone, image in the owner's database, or API credential was read. No real
image was captured, saved or sent to a provider. Tests run the actual detector,
browser OpenCV page finder, and server page-image code where indicated.

| Finding | Reproduction | Observed result |
|---|---|---|
| Motion starves page detection | Alternate 97 pixels of the 160×120 motion image while the paper sample is unchanged | 50 samples / 10 seconds, zero paper lookups; quiet remains zero |
| Slight paper movement fails the same gate | Translate an 80×80 white page on dark background horizontally by one pixel in a 160×120 image, then apply the real 3×3 blur and motion comparison | 2.563% of pixels exceed the intensity delta; the limit is 0.5% |
| Cached paper never expires | Find one page, then fail subsequent detections, including a sample 30 seconds later | The frame loop still reports `found: true` with the old quad |
| Small writing gets lost | Add an 8×3 pixel dark stroke inside one 16×16 comparison cell after the reference is established | One changed cell, no upload; after the 30-second reference refresh the change disappears |
| No-paper content can upload | Set page detection to false, then change two cells of the central fallback crop | The original detector emits an `ink` trigger with `pageFound: false` |
| The model can receive that fallback as paper | Uniform gray image, no detectable page, client metadata `page_found=false`, valid central fallback quad | `_page_view` returns a model image instead of None |
| Bright surroundings defeat page finding | Same visible page and handwriting, move background brightness near paper brightness | Both browser and server finders return no page |
| A larger distractor hides a valid page | Add a larger bright oval beside a valid rectangular page | Both finders return none; the smaller valid rectangle is never tried |
| Geometry is mistaken for document identity | Empty bright rectangle, without any writing | Both finders classify its quad as a page |
| Framing restrictions reject visible paper | Sheet below 20% of frame, sheet touching frame boundary, or page connected to a bright region reaching that boundary | All rejected by both finders |
| Debug counts can describe an earlier sample | Compute changed cells, then send a busy motion sample | `quiet=0`, but `changed` is retained from the previous successful comparison |
| Existing work is invisible at acquisition | Begin on an already-written, stable page and leave it unchanged for 20 seconds | Baseline is established; no upload. This is original behavior, now restored |

The six primary detector reproductions, one motion measurement, seven browser
geometry cases and eight server cases pass as **diagnostic assertions of current
behavior**. Passing does not mean these behaviors are correct. When fixing a
finding, replace its failure-preserving assertion with the desired outcome.

## Why the current pipeline behaves this way

### 1. Global stillness is checked before paper can be localized

`apps/desktop/src/renderer/src/paper/detector/detector.ts:341` compares the entire
motion image against the previous sample and returns immediately if over 0.5%
of its pixels change by more than 15 gray levels. It requires five consecutive
quiet samples at 200 ms intervals before calling `samplePage` at line 363.

This is not just a handwriting quietness check. A face, moving hand, curtain,
auto-exposure change or small shift of the page can prevent paper detection
altogether. Registration and lighting normalization happen later, so neither
can rescue a sample already rejected here. The observed `QUIET 0/5` is consistent
with this failure, but the debug strip alone cannot say what moved.

The original repo's research cites Microsoft's whiteboard work. The actual paper
maintains **per-cell age and foreground/background classification**, allowing
unobstructed cells to progress while others are blocked; the repo's whole-frame
gate loses that distinction. The report also discusses the static-camera/static-
surface assumptions behind frame comparison. Our inference is that this is a
material mismatch for handheld sheets, not evidence the underlying research is
invalid. [Microsoft Research, sections 2.2 and 4.1](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2004-91.pdf)

### 2. Last-seen geometry is treated as current paper presence

`detector/frame-loop.ts:151–164` updates `lastQuad` when detection succeeds but
does not invalidate or age it when detection fails. Later frames are warped
through the cached rectangle and labeled found. There is no optical-flow or
feature-track validation supporting that cache. Only a resolution change or
session restart clears it.

Keeping geometry briefly can bridge a passing hand; retaining it indefinitely
turns a useful smoothing measure into a false-presence signal. If a page leaves
and the student/background occupies those coordinates, new pixels can be
processed as though the document were still there.

### 3. The server's no-page safeguard does not hold for real client metadata

`services/server/src/tassel/vision/turn_image.py:60` gives every stored quad to
`flatten_page`. In `vision/page.py:161`, geometrically valid supplied corners
take precedence over image detection. The output's `found` flag therefore means
"a supplied quad was usable OR the image detector found one."

The client always sends a quad, including a central crop when its `pageFound`
is false. That central quad passes the server's geometric checks. The metadata
flag `page_found=false` is not consulted by `_page_view`. Consequently its
`if not page.found` guard does not reject this route. Existing server tests
exercise no-paper images with **quad=None**, or explicitly trust supplied quads;
they miss the real false-flag-plus-fallback combination.

This is a concrete pathway by which a background image can become tutor-visible
"paper." It does not establish whether the owner's specific picture followed
this route or the cached-quad route.

### 4. The page finder is a single brightness contour heuristic

Both browser and server use grayscale → global Otsu threshold → morphological
close → external contours → **largest contour only** → polygon approximation.
They require exactly four convex corners, at least 20% frame area, and separation
from the frame boundary. There is no document-content classifier, confidence,
candidate ranking, or second-candidate retry.

Otsu separates image-wide brightness populations; it does not identify paper.
OpenCV explains that spatially varying illumination can make a single global
threshold unsuitable. External contours also discard nested boundaries. These
mechanics explain the bright-background/connection failures, while selecting
only the largest contour explains the distracting-oval failure. Merely lowering
the area threshold would introduce more false positives without solving either.
[OpenCV thresholding](https://docs.opencv.org/4.x/d7/d4d/tutorial_py_thresholding.html),
[contour hierarchy](https://docs.opencv.org/4.x/d9/d8b/tutorial_py_contours_hierarchy.html)

### 5. The change detector has a real small-edit blind spot

`detector.ts:454` requires at least two changed cells, regardless of whether a
single cell contains a meaningful small correction. At line 462, a change below
that threshold is eventually folded into the refreshed reference. There is no
independent pending-edit accumulator protecting it from refresh.

Separately, `seen` records a cell the first time it crosses the change threshold;
continued changes in that same cell do not update `lastNewInkAt`. That is a
code-review concern for pause timing, not an independently measured false-trigger
rate in this audit. The five-second minimum upload interval also limits apparent
responsiveness, even after an edit is detected correctly.

### 6. Occlusion and model consumption are separate bottlenecks

Four connected dark/smooth cells can reset quietness for the **entire** page
(`detector.ts:372`). That proxy cannot reliably distinguish a hand from a sleeve,
shadow, filled shape or textured ink in all environments. More tolerant thresholds
alone trade missed work for unwanted foreground images.

Even a successful upload is not a tutor intervention: the lightweight live path
fetches the latest stored page when student speech begins. It does not run a
complete proactive vision tutor on every upload. The frame lookup has a 0.8-second
wait cap. Reading a frame early in a spoken turn can also miss a later upload
during that turn. These timing paths need separate tests; they do not explain
`0 sent` and must not be conflated with detector failure.

## What the document-scanner research suggests

Apple publicly describes its Vision document detector as an ML segmentation
model that returns a document mask and corners. It contrasts that with geometric
rectangle detection, which struggles with folds and obscured corners. This is
evidence for separating document presence from a bright quadrilateral; it is
not proof of Notes' complete private implementation or a Windows-portable API.
[Apple WWDC21](https://developer.apple.com/videos/play/wwdc2021/10041/)

DocAligner is a candidate for a Windows-compatible experiment: its authors
publish ONNX inference and explain why an explicit document-existence head is
needed alongside corners. Its repository license is Apache-2.0; weights,
preprocessing, runtime and redistribution details still need validation for any
chosen artifact. No model was downloaded or installed here, and its speed or
accuracy on this app's handwriting/rooms has not been measured.
[DocAligner authors' repository](https://github.com/DocsaidLab/DocAligner)

Image registration can stabilize page-coordinate comparisons after acquisition.
OpenCV offers feature/optical-flow methods and intensity-based ECC alignment with
masks. These are candidates to benchmark, not a guaranteed drop-in repair:
weakly textured paper, hands, changed writing and convergence failure require
quality checks and bounded tracking loss.
[OpenCV tracking/alignment](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html)

SmartDoc supplies annotated real document videos and a useful paper-localization
benchmark; its scope is document capture, not handwritten-edit timing. A separate
new-work dataset is necessary. One published video-detection method explicitly
uses temporal candidate consistency and evaluates illumination, blur and complex
backgrounds. These are relevant tests missing from the clean-room demo loop.
[SmartDoc dataset](https://zenodo.org/records/1230218),
[document detection in smartphone videos](https://www.lre.epita.fr/dload/papers/movn.19.icdarw.pdf)

## Recommended repair order — research proposal, not deployed behavior

1. **Correct presence semantics end to end.** Distinguish current detection,
   confidence-checked tracking, cached geometry and fallback crop. Expire stale
   tracks; carry detection time/quality; make server interpretation honor those
   distinctions. A valid rectangle alone is insufficient evidence of paper.
2. **Decouple acquisition from global movement.** Search for paper even when
   the room/person moves. Once acquired, align the document into page coordinates
   and assess motion/occlusion locally. Keep continuous capture, bounded analysis
   and automatic selection; do not add a manual send step.
3. **Benchmark paper candidates.** Try multiple geometric candidates and edge/
   illumination variants as a baseline; compare with a document-presence model.
   Require temporal consistency and calibrated rejection on no-paper video.
4. **Preserve unacknowledged edits.** Keep stable, non-occluded ink changes until
   sent, including single-cell corrections. Reference refresh must not erase
   pending evidence. Measure additions, erasures and retracing separately.
5. **Make failures observable.** Distinguish no paper, tracking lost, moving,
   occluded, unchanged, queued, upload failed, and image delivered to model.
   `sent` is only an HTTP upload count; `changed` is not semantic work and can be
   stale. Do not imply Ada has seen an image merely because preview is live.
6. **Validate image freshness and intervention.** Test student-turn image timing,
   image-provider compatibility and whether vision events actually reach the
   tutor. This is distinct from webcam access and requires its own acceptance run.

For first acquisition, the restored original behavior establishes a baseline
without sending it. If the intended product must recognize existing work upon
arrival, define that as a validated document-acquired event in the redesigned
pipeline. Do not quietly reinstate the reverted "first plausible rectangle"
upload or replace it with unconditional periodic snapshots.

## Acceptance data and metrics

Before changing thresholds, evaluate sequences with labeled page masks/corners,
paper entry/exit, camera/page motion, no-paper periods and edit times. Include
paper held up and paper lying on a desk; bright walls/tables; competing monitors
and windows; camera auto-exposure/autofocus; edge clipping; occluding fingers;
thin pencil, dark pen, mathematical subscripts, and diagrams. Split by camera,
person and room so nearly identical frames do not leak across evaluation sets.

Track localization overlap/corner error; false paper events per no-paper minute;
missed-page time; recovery time after occlusion; edit precision/recall and latency
after the hand clears; false changes due to motion/light; delivery age at the
model; CPU/memory use. Any latency/accuracy targets must be agreed product
targets, not presented as achieved results from these synthetic examples.

The existing large variants suite uses ground-truth page corners in its harness
(`tests/unit/paper/detector/harness.ts`). That is useful for ink logic but bypasses
the page finder. Existing page-finder tests mainly use generated demo geometry;
the combined pipeline needs realistic positives and no-paper negatives. Public
data is useful, but does not replace an owner-run real webcam acceptance test.

## Reproduce this audit

From a Windows PowerShell with the prepared local tool environment loaded:

```powershell
node scripts/team2.mjs desktop-test tests/unit/paper/detection-audit.test.ts tests/unit/paper/detection-page-audit.test.ts
node scripts/team2.mjs server-test tests/vision/test_detection_audit.py -q
```

These diagnostic suites contain 14 browser/detector checks and 8 server checks.
All 22 passed in this audit, reproducing the limitations above. The baseline
detector/frame-loop and webcam unit checks also passed. Desktop TypeScript,
Biome and ruff checks passed, and the Windows desktop build completed.

The post-rollback Electron webcam E2E passed: it used a synthetic camera, uploaded
an `ink` event from the original detector (rather than an initial `page` event),
and verified that End session stopped the video track. Test duration was 14.7
seconds, including waiting for the synthetic clip's new handwriting. The original
detector and worker files were also compared against Git HEAD with no differences.
