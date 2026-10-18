---
version: 1
slug: "er-src-features-session-sessionscreen-tsx-a096c7a1"
primary_target: "apps/desktop/src/renderer/src/features/session/SessionScreen.tsx"
related_targets: ["apps/desktop/src/renderer/src/features/session/Stage.tsx","apps/desktop/src/renderer/src/features/session/Dock.tsx","apps/desktop/src/renderer/src/features/session/TutorTile.tsx","apps/desktop/src/renderer/src/features/session/Captions.tsx","apps/desktop/src/renderer/src/features/session/TitleStrip.tsx","apps/desktop/src/renderer/src/features/chat/ChatSidebar.tsx"]
---

# Session screen: "One stage, her work first"

- **Scope:** the live session screen in `features/session/` (SessionScreen, TitleStrip, Stage, TutorTile, AvatarPlaceholder, Captions, Dock). In P1 the paper and board are placeholders, nothing is captured, and the fake tutor drives the screen.
- **Mode:** Operate. **Build path:** code-led. The locked decision card is the HTML sketch `.impeccable/mocks/decision/stage.html`, which the build matches and the finish review audits against.
- **Audience and moment:** a student at a desk, pencil in hand, her paper under the Desk View camera. She works in English, Spanish or Korean, is mid-problem and often unsure, and glances up between strokes.
- **Job:** keep her work at the center while Ada listens, watches, talks and shows. Her main actions are physical: writing and talking. On screen she has mute, camera, board view, captions and End session.
- **Content:** her live paper (P3; a placeholder in P1), Ada's board (P5; a dotted canvas in P1), Ada's tile with her state, two caption lines with speaker labels, the title and chips, the source, the timer and the language.
- **Memorable moment:** Ada's counterexample. The board slides in beside the paper, her marks land on the student's own work, and the caption asks the question.
- **Constraints:** spec §6; the Task 13 brief; rulings R7 (the timer counts from mount), R17 (the pin cycle with Follow Ada and a pin indicator) and R18 (End is the only exit; only M, B and C are bound; Share is visible but disabled). Full parity in en, es and ko, reduced motion, and keyboard parity.
- **Unresolved:**
  - the pin indicator's final treatment (the builder and the design reviewer settle it within this contract);
  - how honest the live dot is while P1 captures nothing;
  - Ada's presence at tile size, the decision card's named risk, until P6 brings the real avatar and lip-sync.

## Direction contract

THESIS: Her paper owns the window. The board slides in beside it only when Ada has something to show, and Ada stays a small, live presence in the stage's corner. It refuses the call layout (Ada as the main tile, a filmstrip, a call bar) and the chat layout (bubbles, a timeline, a right rail).

OWN-WORLD: Hume's instrument on a desk: a bone ground, paper panels with 16px radii and a 12px gap, and ink for text and pressed controls. Iris belongs to Ada alone: her speaking ring, her caption label, her marks. Add a blush tile, mono uppercase lab labels, pills, and hairlines instead of shadows.

STORY: She sees her own work, large and untouched, and knows Ada is watching it. Ada's words arrive as subtitles. When Ada shows something, the board comes in beside the paper, and she keeps writing.

FIRST VIEWPORT: At 1440×900 in split:
- a 52px bone strip: title and chips centered; source, timer and language pill on the right;
- the stage inset 60, 16 and 104, with paper left and board right at exactly 1:1;
- Ada's 212×176 tile 14px in from the stage's top right;
- ink captions (880 wide at most) above a centered pill dock whose primary action is End session.

FORM: One stage, her work first. It was the second of three structures dealt in the decision round, after "Living notebook" and ahead of "A call with your tutor".
- Signature interaction: the 240ms split reflow, with an exponential ease-out and cross-faded contents.
- It is the same for Ada's requests and the student's Board cycle. A pinned view never moves.
- It is instant under reduced motion, with no motion on first mount.
- seed: 73b7d851c29a5f41

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Extension: the chat sidebar (2026-10-18, owner's decision)

The owner chose a right sidebar for the conversation, which overrides the THESIS's refusal of "a right rail" for this one element. Everything else in the contract stands: the rail is subordinate to her work, and the stage keeps its world. Extension of an established surface: no concept round, code-led.

### Direction contract (sidebar)

THESIS: A transcript with hands, not a messenger. The rail is the session's written record beside her work: Ada speaks unboxed, the student's lines are the only boxes, and what Ada did on the stage reads as small pills that take you there. It refuses chat-app chrome: avatars, bubbles on both sides, timestamps on every line, typing dots, a coloured header.

OWN-WORLD: The window's bone ground continues into the rail; one hairline on its left edge, no shadow. Ada's label is mono uppercase iris-ink, her text ink 14/21 on bone. Student lines are paper cards (12px radius, hairline), right-aligned; spoken ones italic behind a 12px mic glyph. Action rows are hairline pills on paper with a 14px line icon and an optional mono item tag. The composer is one paper card (16px radius, hairline) at the rail's foot: chips, the textarea, then a row of 32px round icon controls, the voice pill and the ink send circle.

STORY: She glances right and sees what was said and done, in order, and can type when talking won't do: a photo of part b, a question while Ada speaks. Clicking "Drew on the board" brings the board back.

FIRST VIEWPORT: 1440x900, a fresh session, rail open: title strip across the window; the stage, captions and dock re-centred in the 1080px left of the rail; the rail 360 wide from under the strip to the window's bottom: a 44px header (CONVERSATION label, close), the log, and the composer card 12px from the edges. Under 1120 window width the rail lies over the stage's right side instead, and the tiles, captions and dock move clear of it.

FORM: Extension. Signature interaction: Ada's line grows in step with her voice and settles; cut off, it ends with a quiet mono CUT OFF. The rail opens and closes in 200ms (exponential ease-out), the stage re-fitting once; instant under reduced motion.
- seed: none (extension of an established surface)

FINISH: an impeccable-finish-reviewer pass on the E2E screenshots (open and closed at 1440x900 and 1024x680, a full conversation), with its material findings fixed.

## Extension: the app shell and Settings (2026-10-18, workstream U)

Extension of the established world, code-led, no concept round.

### Direction contract (shell)

THESIS: Settings is a quiet instrument panel in the app's bone world, not a modal form dump: a full-window view with its own 52px strip, the sections down a left rail (the chosen one on a paper pill with a hairline), each section's controls in paper panels with hairline rows. The strips lead with the work: the session's editable title on the left, its tools on the right. It refuses choice chips, icon-and-heading card grids, coloured side borders and shadows.

OWN-WORLD: Underline tabs (a 2px ink rule on a hairline) for sections; a soft segmented control (paper thumb on a 5% ink track) for short value sets; option cards (paper, hairline, an ink ring and check when chosen) for "How you'll work"; menus as paper cards with bone-highlighted rows for the library sort, a card's "⋯" (Rename, Delete) and the title's menu (Rename, type). One status pill ("source · timer") and a language pill in the same paper-and-hairline style.

FORM: Extension. Signature interaction: the title renames in place (click, double click or Enter; Enter saves, Escape cancels).
- seed: none (unavailable)

FINISH: an impeccable-finish-reviewer pass on the shell-*.png screenshots (settings.spec.ts), with its material findings fixed.
