# Chat image arrows implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make diagram edges and short edge labels addressable in student attachments, and prevent Pointer from choosing an unrelated kind of marker.

**Architecture:** Keep the existing figure and text detector and wire schema. Extract connected strokes outside figures, retain nearby short labels, and describe their geometry in the legend. Pointer uses that geometry to validate IDs and box snapping.

**Tech Stack:** Python, OpenCV, Pillow, pytest; fake provider clients only.

**Spec:** The owner's task in this session, including the real-token dfa-page failure.

## Global constraints

- Work in the supplied chat-vision worktree on claude/chat-vision-arrows; leave changes uncommitted.
- Never read .env files or tokens; no provider calls or device capture.
- Run only the owner-approved vision and two voice test modules, plus ruff check/format. No watch modes or background services.
- Preserve MAX_MARKS, deterministic reading order, badge legibility, and old fixture recall/precision.
- Write the conventional commit message to /tmp/chat-vision-arrows-commit.txt with the supplied co-author trailer.

## Review focus

- Thin, headless, diagonal and curved edges must survive figure removal.
- Labels near arrows must remain separate when disconnected, including one glyph.
- Connected diagrams must not turn states and edges into one bounding box.
- An incompatible ID must not sneak back through box snapping.
- Paper legends without richer geometry must retain existing compatibility.

### Task 1: Attachment geometry

**Files:** services/server/src/tassel/vision/image_marks.py; services/server/tests/image_marks_fixtures.py; services/server/tests/vision/test_image_marks.py.

**Interfaces:** image_view(bytes) continues returning ImageView; its legend describes arrow and label kinds while DetectedElement retains the existing wire kinds.

- [x] Add dfa-page and a synthetic diagram with independent truth boxes; assert 100% recall and precision, kind descriptions, stable IDs, and legible badges. Pin old fixture precision to baseline.
- [x] Run the regression tests and observe missing arrows/labels.
- [x] Detect exterior strokes and short nearby labels without splitting existing enclosed figures or tables.
- [x] Run vision tests and print every fixture's metrics.

### Task 2: Pointer compatibility

**Files:** services/server/src/tassel/voice/pointer.py; services/server/tests/voice/test_pointer_marks.py.

**Interfaces:** Pointer.resolve keeps its public signature and accepts geometry through legend_text.

- [x] Add fake-client tests for q2→q3, q1's 1 label, circle retention, incompatible IDs, and incompatible snaps; observe failure before implementation.
- [x] Require matching kinds for named subjects, preserving relational wording and legacy paper behavior; request boxes when no marker fits.
- [x] Run the exact owner-approved scoped suite and ruff; inspect the diff and marked fixture images.
- [x] Leave the work uncommitted and write the requested commit message.

## Evidence

- Baseline: 513 passed, two dependency deprecation warnings.
- Old fixture baseline: textbook 9/9, slide 5/5, photograph 9/9, screenshot 9 truths/11 marks; recall 1.000 for all, precision 1.000/1.000/1.000/0.818.
- Red regressions: DFA initially 5/12 targets; synthetic diagram 5/14; Pointer selected m5 for arrows and labels. All now pass at 12/12 and 14/14, with old scores unchanged.
- Additional red-to-green checks cover resized start arrows, junction halos, touching labels, attached self-loops, and compound noun targets such as "the arrow label".
- Fresh static review identified the compound-label issue and attached-loop coverage gap; both received failing tests and fixes. Focused verification: 61 passed.
- Visually inspected the marked DFA and synthetic diagram; badges remain legible and leave ink unobscured.
- Final owner-approved suite: 532 passed, two pre-existing dependency deprecation warnings. Scoped ruff check and format check passed; git diff --check passed. No provider calls, app/device startup, commits, or background services.
