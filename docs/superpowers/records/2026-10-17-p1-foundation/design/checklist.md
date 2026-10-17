# Design acceptance checklist: P1 UI (Tasks 10–14)

The design reviewer checks every task against this list. Read it before any UI edit. Each line gives the value, where the value comes from, and how severe a miss is.

**Sources:**
- **K:** the direction contract, `teams/session-surface-brief.md`. It covers the session screen only.
- **M:** the chosen mock, `.impeccable/mocks/decision/stage.html`.
- **D:** `docs/design-system/DESIGN.md`.
- **T:** `packages/shared/src/styles/tokens.css`, `base.css` and the global constraints.
- **B:** the task brief.
- **F:** the impeccable craft floor.
- **G:** the Vercel web interface guidelines.
- **P:** `PRODUCT.md` and the spec.
- **R:** my own recommendation. Other choices are fine if they're consistent.

**Severity if missed:**
- **C** (Critical): contradicts the contract, or breaks usability or accessibility.
- **I** (Important): visibly off the mock or the tokens, weak hierarchy, or a craft-floor ban.
- **m** (Minor): polish. It doesn't block.

**Exact values in the brief beat this list,** and so do the rulings in `teams/ui-team.md` (R4, R7, R14, R16–R18). If a line here conflicts with either, tell me and we'll settle it.

**Mock captures for comparison,** in `design/mock/`:
- `stage-1440x900.png` and `@2x`: the mock as the owner saw it.
- `stage-1024x680-reflow.png` and `@2x`: the mock's layout resolved at the minimum window. The 1440×900 pin on `html, body` is released, so its insets (60/16/104, captions at bottom 118, dock at bottom 22) apply to the smaller window. It's a derived reference, not an approved comp.
- `stage-geometry.json`: the box and computed style of every mock element at both sizes.

---

## 0. Every screen

### 0.1 Color roles

| Token | Value | Use it for | Never use it for |
|---|---|---|---|
| ink | `#222222` | Text, icons, primary pills, pressed toggles, the active segment, the language pill, the board tag, the caption panel, focus rings | Never substitute `#000` (T, I) |
| paper | `#ffffff` | Cards, stage panels, the dock, sheets, chips and tags on bone, Ada's label pill | The page canvas (D, I) |
| bone | `#fff9f3` | The app canvas, including the 52px strip; a chip's fill on a white card; hover fill on white | |
| smoke-text | `#6b6966` | Small secondary text: chips, timer, helper and body text, placeholders, the untitled title | Text on blush (4.44:1) or sky (4.01:1): use ink there (T, C) |
| smoke | `#7a7876` | Text ≥ 24px (≥ 18.66px bold) and non-text only | Any smaller text: 4.40:1 on paper, 4.21:1 on bone (T, I) |
| **iris** | `#c094e4` | **Ada's live presence only:** the 2px speaking ring, Ada's caption speaker label, her marks and highlights | Buttons, links, focus rings, selection, active tabs, hover, chips, scrollbars, loaders, the student's label. **K, C** on the session screen; **D, I** elsewhere |
| iris-ink | `#7d4fc4` | Ada's state label (`SPEAKING`) on white; her marks on paper | Chrome or links (K, I) |
| blush | `#fce0ee` | Ada's tile; light washes such as text selection | A second blush surface on the session screen that competes with her tile (R, m) |
| **live** | `#e5484d` | **The live/capture dot only** | Errors, End session, destructive actions, badges, validation (K, I) |
| rose-mist, meringue, mint, seafoam, sky | | Surface washes and category tints, with ink text | Text color, CTA fill, icon stroke (D, I) |

Some mock values aren't tokens. Define each once as a named variable and use the name, never a raw hex in components (m):
- hairline `#ece5dc`: the dock ring, the separator, input and card rings. Task 10 adds this as the shared token `--color-hairline`;
- board dot `#e6e1da`;
- the previous caption line `#bdb8b4` on ink;
- desk `#cdc4b6`: only behind a real camera feed, so not for the P1 paper placeholder.

**Measured contrast:**
- ink on paper 15.9, on bone 15.2, on blush 12.9;
- smoke-text on paper 5.47, on bone 5.24;
- iris-ink on paper 5.54, on blush 4.50 (keep it on the white pill);
- iris on ink 6.51, `#bdb8b4` on ink 8.09;
- live dot on bone 3.75 (non-text).

The iris ring is only 2.34:1 against bone (non-text), so it can never be the only signal: the state label always names the state (K, C).

### 0.2 Type

| Role | Face | Size / weight / leading | Color | Source |
|---|---|---|---|---|
| Wordmark | Geist + authored tassel glyph (18×20) | 17 / 520, lowercase `tassel`, gap 7 | ink | M |
| Session title | Geist | 15 / 520, one line, ellipsis | ink; the untitled placeholder in smoke-text | M, B |
| Lab labels: chips, tags, status, Ada's state | Geist Mono | 11, uppercase, +0.025em, `"calt" 0, "liga" 0` | per role | M, T |
| Segmented and tab labels | Geist Mono | 12, uppercase | ink or smoke-text; white when active | D |
| Buttons | Geist | 14 / 520 | | D, M |
| Ada's name in her pill | Geist | 13 / 520 | ink | M |
| Caption, previous line | Geist | 15 / 400 | `#bdb8b4` | M |
| Caption, current line | Geist | 21 / 450 / 1.35 | paper | M |
| Library heading | Geist | 24 / 520 / 1.25 | ink | D, R |
| Card title | Geist | 16–18 / 520, clamped to 2 lines | ink, or smoke-text for untitled | B, R |
| Secondary body text | Geist | 14 / 400 | smoke-text | D |
| Sheet title | Geist | 20–24 / 520 | ink | R |

- **Size floor:** functional text is never below 11px (T, I). DESIGN.md's 10px mono size doesn't apply here.
- **Weights:** 400, 450 and 520 only; never 600 or above (D, I). For mono labels, use 400 consistently (m).
- **Sans tracking:** −0.025em (T). It's fine if large sizes inherit the body's −0.4px, as the mock does (m).
- **Korean:**
  - `:lang(ko)` sets letter-spacing 0 and line-height 1.6 (T), and `.mono:lang(ko)` sets letter-spacing 0 (ruling, Task 10) (I).
  - Hangul renders in Pretendard (I).
  - `word-break: keep-all`, plus `overflow-wrap: anywhere` as a fallback, on Korean headings, titles and captions (R, m).
- **Content in another language:** text whose language differs from the UI carries its own `lang`, so the Korean rules apply.
  - Captions: `lang` from the event (P, I; a Korean segment in an English UI otherwise gets negative tracking on Hangul).
  - Session titles: `lang={session.language}` (R, m).
- **Numerals:** the timer, relative times and counts use `font-variant-numeric: tabular-nums`, so nothing shifts as they tick (G, m).

### 0.3 Shape, surface, depth

- **Radii:**
  - pills (`9999px`) for every action, chip, tag, segment and the dock;
  - cards and panels 16, small cards and notices 12, inputs 8;
  - sheets 24 (the brief).
  - Never pill-shaped cards (D, I).
- **No shadows anywhere.** Only `box-shadow: 0 0 0 1px` hairlines, plus Ada's 2px iris ring. No blur, glass or backdrop-filter (K and T: C on the session screen, I elsewhere).
- **Separation** comes from white on bone, hue and space. No divider lines between sections (D, m).

### 0.4 Focus

- Every interactive element shows `:focus-visible { outline: 2px solid var(--color-ink); outline-offset: 2px }`.
  - The offset leaves a bone or white gap, so the ring also reads around ink pills and pressed toggles.
  - Never the browser's blue, never iris, and never `outline: none` without a replacement (G, F, C).
- Show it on keyboard focus only (`:focus-visible`), not on mouse click (G, m).
- Text inputs show it on any focus (G).
- Segmented controls ring the focused item, not just the track (C).
- Whole-card buttons in the library ring the whole card (C).
- **Sheets and dialogs:**
  - focus moves in on open and is trapped;
  - Escape closes;
  - focus returns to the opener (C).
- Floating layers (dock, captions, Ada's tile) never cover the focused element (G, I).

### 0.5 Hover and press

All of these are R and m unless marked. Use color and hairline only: no transform, scale, bounce or shadow.

- **Primary ink pill:** hover lightens the ink, for example `color-mix(in oklab, var(--color-ink) 88%, white)`.
- **Ghost button:** a pill fill on hover (bone on white, white on bone).
- **IconButton, off:** a bone fill plus the hairline ring. **Pressed:** lightened ink.
- **Segment, inactive:** a paper or bone fill. **Active:** stays ink.
- **Library card:** a hairline ring on hover.
- **Not interactive:** chips, tags and the language pill (while it's display-only) get no hover and no pointer cursor.
- **Transitions:** list the properties (`background-color, color, box-shadow`), 120ms. Never `transition: all` (G, m).
- **Hover is stronger than rest:** hover, focus and active each add contrast, never remove it (G).

### 0.6 Motion

- **One authored moment:** the stage reflow (K). Everything else is quick and quiet. No entrance animations, no staggered cards, no idle loops (F, I).
- **Easing:** exponential ease-out, for example `cubic-bezier(0.16, 1, 0.3, 1)`. Never bounce, elastic or overshoot (F, I).
- **Durations** (R): hover and press 120ms; sheet in 180ms (fade plus 8px rise or 0.98→1 scale) and out 140ms; text and state swaps up to 150ms fades; **stage reflow 240ms** (K).
- **`prefers-reduced-motion: reduce`:**
  - the stage change is instant (K, C);
  - sheets fade only, at most 120ms, or snap;
  - skeletons are static;
  - caption and state swaps are instant;
  - no level-meter animation (G, I).
- **Animate from a visible default.** No `opacity: 0` start state that a failed animation would leave stuck (F, I).
- Animations stay interruptible: pressing B during the tween retargets cleanly (G, I).

### 0.7 Copy and i18n

- Every visible string comes from the catalog in en, es and ko. No hard-coded English, and no student name such as "Josephine": the student's caption label needs a catalog key, for example "You" (T, I).
- **Fixed copy is exact:** `Untitled Session`, `Couldn't reach Tassel's server`, `platform.windowsNoDeskView`. These use straight apostrophes, so the rest of the copy does too; don't mix (T, m).
- **Case:** actions use sentence case as the briefs write them ("New session", "End session"). I won't flag the guidelines' Title Case rule (B).
- **Ellipsis:** loading copy and placeholders end with `…`, never `...` (G, m).
- **Spanish runs about 30% longer:**
  - controls never clip or wrap mid-label at 1024 (I);
  - titles ellipsize (title strip) or clamp (cards) (B, C);
  - flex children that hold text get `min-width: 0` (G).

### 0.8 Browser surfaces (F)

All are R and m unless marked.

- **Selection:** `::selection` uses a pastel with ink text (blush or sky). Not iris, not the default blue.
- **Caret:** `caret-color: var(--color-ink)` in inputs.
- **Scrollbars:** only the library scrolls. Use a thin warm thumb (hairline) on a transparent track, or the macOS overlay default. The session screen never scrolls at 1024×680 (B, I).
- **Color scheme:** `color-scheme: light` on `<html>`; nothing flips in macOS dark mode.
- **Rubber-band:** `overscroll-behavior: none` on `<html>` (G).
- **Selecting chrome:** `user-select: none` on the strip, dock, chips, tags and buttons, so a window drag never selects text. Titles and captions stay selectable.

### 0.9 Never, on any screen

- Drop or offset shadows, blur, glass, gradient text, or the iris gradient. DESIGN.md reserves it for a hero wordmark this app doesn't have (F, D, I).
- A colored `border-left` or `border-right` wider than 1px on cards, notices or rows (F, I).
- **An eyebrow or kicker above a heading,** for example a mono `SESSIONS` over "Your sessions". This is a craft-floor ban (F, I).
- Emoji or Unicode glyphs as icons (`✕ ← ⟳ ✓ ⚠`). Icons come from `icons.tsx`, drawn in one hand (F, I). The `·` separator inside labels is punctuation, so it's fine.
- Red for anything except the live dot. Iris on chrome. Pastels as text or CTA fills.
- Monospace for body copy or anything ≥ 16px (D, I).
- Numbers, statistics, testimonials or study claims, and lorem ipsum (P, I).
- A modal where nothing needs protected focus, for example confirming Back (F, m).
- Default browser form controls, an unstyled `<select>`, or the default blue focus ring (F, I).
- Layout shift from the ticking timer, a new caption, a title update or a hover (G, I).

---

## 1. App frame and base components (Task 10)

**AppFrame**
- **Strip:** 52px tall; bone; no border, no bottom line, no shadow (B, M; I).
- **Drag region:** `-webkit-app-region: drag` on the strip, and `no-drag` on every interactive child (B, C if a control can't be clicked).
- **macOS:** left inset 84px for the traffic lights, which the window places at x 20, y 18. Nothing interactive in the first 84px (B, C). Right padding 20 (M).
- **Windows:** `titleBarOverlay` draws minimize, maximize and close (about 140px) at the top right of the strip. Keep that area clear, using `env(titlebar-area-width)` or about 150px of right padding on win32, so "New session" and the language pill never sit under the window controls (I; checked in code).
- **Alignment:** strip items are vertically centered at 22–36px tall, with a gap of 18 between groups (M).

**Button**
- **Primary:** `bg-ink text-paper rounded-pill`, 14 / 520 (B, D).
  - **Heights:** 48 with 22px side padding for the dock's End session, the sheet's Start, and the empty-state and error CTAs (M). 36 with 16px side padding in the 52px strip (R).
  - The DESIGN.md hero padding of 16×24 doesn't fit a 52px strip (R).
- **Ghost:** no fill, no border, ink 14 / 520 (D). Hover as in 0.5.
- **Disabled:** opacity 0.4, no hover (R).
- **Busy:** keeps its width and shows progress. It's disabled only once the request starts, which also blocks a double submit (G, I).

**Chip**
- Mono 11px uppercase, `+0.025em`, padding 4px 10px, pill, smoke-text text (B, M).
- **Fill:** paper on bone surfaces. On a white card, bone or a hairline ring, because a white chip vanishes on a white card (R, I if invisible).
- Long subjects truncate with an ellipsis at about 200–240px max (R, I if they overflow).

**SegmentedControl** (Radix ToggleGroup)
- **Items:** mono 12px uppercase (D), at least 32px tall (R), about 6×12px padding (R).
- **Active:** an ink pill with white text (B, D; I).
- **Inactive:** ink or smoke-text, with hover as in 0.5.
- **Track:** a paper pill on bone, or bone on paper (R). Gap 2–4px.
- **Keyboard:** arrows move the selection (B), and Tab enters at the active item and leaves the control (C).
- **Never empty:** clicking the active item never leaves the control with no active pill (Radix's single mode allows that by default) (I).
- **Disabled items:** opacity 0.4, `disabled`, skipped by the arrow keys, still legible (R).

**Sheet** (Radix Dialog)
- Radius 24 (B), paper, about 32px padding (D, R), no shadow (T, I).
- **Scrim:** ink at about 24–40% alpha, no blur (F, R).
- **Width:** about 520px, so Spanish options fit (R). Max height `100vh − 64px`.
- **Title:** 20–24 / 520, left-aligned, wired as the dialog's title (C).
- **Closing:** Escape, the scrim, and an explicit Cancel or close. A close icon, if any, comes from `icons.tsx` and has an `aria-label` (C, F).
- **Inside the sheet:** `overscroll-behavior: contain` (G, m).
- **Motion** as in 0.6.

**IconButton**
- A 48px circle (B, M).
- **Icon:** 24-unit viewBox drawn at 22px, as in the mock's dock (M; m if drawn at 24).
- **Off:** transparent with an ink stroke. **Pressed:** an ink fill with a paper stroke (B, M; I).
- **Accessible name:** `aria-label` from props (B, C).
- **State:** use either a stable name plus `aria-pressed` (preferred), or a name that changes with no `aria-pressed`, never both. This affects the dock's "Microphone" / "Microphone off" (G, I).
- **Tooltip** with the name and the shortcut, for example "Microphone (M)" (R, m).

**Icons**
- 24×24 viewBox, `stroke-width: 1.6`, round caps and joins, `fill: none`, `currentColor` (B, M; I).
- Mic, Camera, Screen, Board and Captions follow the mock's dock glyphs. MicOff, Globe, Plus, Search and Retry are drawn in the same hand (I).
- Decorative icons get `aria-hidden` (G).

**global.css**
- The four imports, in the brief's order (B).
- `.mono:lang(ko) { letter-spacing: 0 }` (ruling).
- The browser surfaces in 0.8.
- `html[lang]` set by `initI18n` (B).

---

## 2. Library (Task 11)

No mock exists for this screen. It extends the session world (ledger ruling, line 107), so DESIGN.md, the tokens and the base components govern.

**Top strip**
- **Wordmark at left,** after the 84px inset: the tassel glyph plus `tassel`, 17 / 520, exactly as in the mock's strip, with `aria-label="Tassel"` (M, B; m).
- **Search, centered** (B):
  - about 320–400 wide and 32–36 tall; radius 8 (`--radius-input`) (T);
  - paper fill with a hairline ring at rest, because white on bone is only 1.04:1 (R, I if the field can't be seen);
  - 14px text, a smoke-text placeholder, and the Search icon at 16–18px;
  - a label: `aria-label` or a visually hidden label (G, C).
- **"New session" at right:** a 36px primary pill (B, R). A Plus icon is optional.

**Heading and sort**
- "Your sessions" (`library.title`), 24 / 520 / 1.25, left-aligned. Not centered: this is an Operate surface (R).
- **No eyebrow above it** (F, I).
- The sort SegmentedControl reads Recent activity · Date created · Topic (B). Place it on the heading's row at the right, or directly beneath it (R).
- **Spacing:** 24–32px from the strip to the heading; 16–24px from the heading row to the grid. There's more space above a heading than below it (F, m).

**Grid**
- `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` (B), with a gap of 16 (D: 12–16).
- Content width at most 1200 and centered (D), with at least 32px side padding (R).
- That gives 4 columns at 1440 and 3 at 1024, with no horizontal scroll (C).

**Card**
- Paper on bone, radius 16, padding 20–24, no shadow (B, D; I).
- **Title:** 16–18 / 520, `line-clamp-2` (B, C if it overflows). The untitled placeholder is smoke-text (B, I).
- **Chips:** subject and type (B), styled as in §1 Chip.
- **Meta row:** the language badge and the relative time, in smoke-text, at 11px or more, with `tabular-nums` (B, R). The language badge stays quiet (mono text or a hairline pill), not an ink pill on every card. Ink fills belong to actions and active states (R, m).
- **Equal heights:** cards in a row share a height, with the meta row pinned to the bottom (R, m).
- **Interaction:** the whole card is one `<button>` (or link) named by its title, with a hover ring and a visible focus ring (G, C).
- **No thumbnail in P1:** don't fake a board or paper preview with a stock image (P, I).
- **Tutor titles persist (R16):** after a session's title event, its card shows the tutor's title and subject once she's back in the library. A titled session never shows "Untitled Session", not even for a moment (I).

**Topic sort**
- A semantic group header (`h2`) per subject, in sans 16 / 520 ink or a mono 12 smoke-text label. Pick one, and don't stack both (R; a stacked pair counts as an eyebrow, F, I).
- "No topic" (`library.noTopic`) comes last (B).

**States.** Each one replaces the grid in place, centered in the content area. No toasts.

- **Empty** (B, I):
  - An authored SVG illustration, about 160–200px: pastel washes plus ink strokes at 1.6, for example a worksheet with a small DFA. Ada's iris-ink marks are allowed. No emoji, no stock icon, no gradient.
  - Title 20–24 / 520, body 14–16 smoke-text at most 44ch, and a 48px primary "New session" CTA.
  - No sample or fake cards.
- **Loading:**
  - Skeleton cards the same size as real cards: paper cards with hairline-colored bars (B, I).
  - Static, or a slow opacity pulse of at least 1.2s; static under reduced motion (G, I).
  - `aria-busy` on the grid, plus a hidden "Loading…" (G).
  - Wait about 150–200ms before showing them, so a fast load doesn't flash (R, m).
- **Error:**
  - Title exactly "Couldn't reach Tassel's server", then the body text (`library.error.body`, which names the recovery) and a Retry primary pill with the Retry icon (B, C).
  - No red, no warning glyph, `role="alert"` (G).
  - Retry shows progress while it's in flight (R, m).
- **No results** for a search: distinct from empty. It names the query and offers to clear the search (R, m).
- **`tokenReset` notice** (ruling):
  - A one-time inline notice above the heading: paper, radius 12, hairline, ink 14px text, and a dismiss control drawn from `icons.tsx` or as a ghost button.
  - Not a modal, not red, and gone after it's dismissed or after a restart (I).

**Sizes and languages:** 1440×900 and 1024×680, in en, es and ko. "No se pudo conectar con el servidor de Tassel" wraps cleanly without clipping, and the Spanish sort labels fit on one row at 1024 (I).

---

## 3. New session sheet (Task 12)

- **The Sheet itself,** as in §1:
  - title "New session" (`newSession.title`);
  - three labeled groups, each a `fieldset` and `legend` (or `role="group"` with `aria-labelledby`) (G, C);
  - the group labels need new catalog keys.
- **Spacing:** 20–24px between groups, and 8–10px from a label to its control (R, m).
- **Controls:**
  - type: Homework, Studying, Research, Other;
  - language: English, Español, 한국어; it defaults to the UI language (B);
  - source: Paper · Desk View, Screen share, Just talk.
  - Each control is a SegmentedControl that fits on one row in es at 1024×680, for example "PAPEL · DESK VIEW" and "COMPARTIR PANTALLA" (I).
- **Actions** at the bottom right:
  - Cancel (ghost), then Start (primary, 48px; B: "Start" pill).
  - Start disables once the request is in flight, so a double click creates one session (G, I).
  - An error appears inside the sheet, next to Start, in ink text. Not red, not a toast, and the sheet stays open (G, I).
- **Windows:**
  - "Paper · Desk View" is disabled and stays legible (B).
  - `platform.windowsNoDeskView` sits directly under the source control in smoke-text at 13px or more, tied to the control with `aria-describedby` (B, C for the exact copy).
  - Screen share is preselected (B).
- **Fit:** at 1024×680 the whole sheet is visible with no inner scroll (I).

---

## 4. Session screen (Tasks 13 and 14)

### 4.1 Layout values (mock; K and B where marked)

| Element | 1440×900 | 1024×680 | Values |
|---|---|---|---|
| Title strip | 1440×52 | 1024×52 | Bone, no border; padding 0 20 (left 84 on macOS); gap 18 (K, B) |
| Title cluster | centered in the free space | | Title 15 / 520, one line, ellipsis, `min-width: 0` (K, B); gap 10 to the chips; chips don't shrink (fixed width, ellipsis inside) |
| Status cluster | right edge at 20 | | Gap 14. **Live:** a 7px dot plus mono 11 ink, gap 6. **Timer:** mono 11 smoke-text, `tabular-nums`. **Language pill:** 22 tall, padding 4×10, ink fill, paper text (K, M) |
| Stage | x16 y60, 1408×736 | x16 y60, 992×516 | Insets top 60, sides 16, bottom 104. Split is `1fr 1fr` with a 12 gap (K, B) |
| Panels | 698×736 each | 490×516 each | Paper fill, radius 16, `overflow: hidden`, no shadow (K) |
| Panel tags | top 14, left 14 | | 26 tall, padding 6×12, mono 11. **Paper tag:** paper fill, plus a hairline on the white placeholder or it vanishes. **Board tag:** ink fill, "Ada's board" (M) |
| Board canvas | | | `radial-gradient(#e6e1da 1.2px, transparent 1.3px) 0 0 / 22px 22px` on paper (B, M) |
| Ada tile | x1198 y74 (14 in from the stage's top and right) | x782 y74 | 212×176, blush, radius 16 (K). Avatar 156×156 at 28, 6 (M). Ring `0 0 0 2px #c094e4` **only while speaking** (K) |
| Ada's label pill | left 10, bottom 10 | | 27 tall, padding 5×10, gap 6, paper fill. "Ada" 13 / 520 ink, then the state in mono 11 iris-ink (M) |
| Captions | x280 y699, 880×83 for two lines | x72 y479 | Ink, radius 16, padding 14 / 22 / 16. Centered with `bottom: 118`, so it grows upward. Width `min(880px, 100% − 144px)` (K, M) |
| Caption lines | | | **Previous:** 15 / 400 `#bdb8b4`, 6 below. **Current:** 21 / 450 / 1.35 paper. **Speaker labels:** mono 11, 8 to the right. Ada's label is iris; the student's is `#bdb8b4`, never iris (K, M) |
| Dock | x492 y814, 456×64 | x284 y594 | Paper pill, padding 8, gap 6, hairline `0 0 0 1px #ece5dc`, centered at `bottom: 22` (K, M) |
| Dock contents | | | Mic, level meter, Camera, Share (visible but disabled in P1, R18), Board, Captions, separator, End session (K, B) |
| Level meter | | | 5 bars, 3 wide, gap 2, radius 2, ink, ≤ 18 tall, margin 0 6 0 2 (M) |
| Separator | | | 1×28 hairline, margin 0 4 (M) |
| End session | 118×48 in en | | Ink pill, padding 0 22, paper text 14 / 520. **Never red** (M, K) |
| Rhythm | stage → dock 18; captions → dock 32 | the same | Preserve these at both sizes (M) |

### 4.2 Contract checks (K, all C)

- **Her work is the largest thing on screen.**
  - Paper mode: paper fills the stage.
  - Split: exactly 1:1.
  - Ada's tile never grows beyond 212×176 and never becomes a panel.
- **Never the rejected layouts:** no main tile for Ada, no filmstrip, no full-width call bar, no chat bubbles or message timeline, no right rail of controls.
- **Ada's state is always visible:** the mono label on her tile reads `CONNECTING`, `LISTENING`, `WATCHING`, `THINKING` or `SPEAKING`, localized. The ring shows only while she speaks and is never the only signal.
- **The caption panel is ink,** sits above the dock, and never overlaps the dock or Ada's tile. It may cover the bottom of the stage, as subtitles do. This holds at 1024×680 in es and ko, with 2–3-line captions (B: bounding-box E2E).
- **Captions are always available:** C and the dock button toggle them; they're never removed.
- **Pinning (R17):**
  - The student can pin a view, and Ada's `requestMode` waits until she unpins.
  - The pinned state is always visible: the pin indicator in 4.4 is on screen whenever a view is pinned.
  - Unpinning is reachable by mouse (the indicator's Unpin), by keyboard (Tab to Unpin), and through the Board cycle's fourth step.
- **The live dot is `#e5484d`,** and it appears only beside the source label.
- **No shadows anywhere:** not on the panels, the tile, the captions, the dock or the sheets.

### 4.3 The signature interaction (K)

- When Ada calls `requestMode('split')` from Paper, the panel widths tween over **240ms** with exponential ease-out, and the panel contents **cross-fade**. If she pinned a view, nothing moves (C if missing; I if the duration or easing is off).
- **Reduced motion:** the change is instant (C).
- **Student-initiated changes** (B and the dock's Board button, R17) use the same 240ms reflow, so every change of view feels the same (R, m).
- **Layout properties:** the guidelines say to animate only transform and opacity, but the contract asks for a width tween. Tween only the two panel widths (or `grid-template-columns`) and nothing else.
- **During the tween** (I'll capture frames at 0, 60, 120, 180 and 240ms):
  - Ada's tile stays anchored to the stage's top right. Position it on the stage, not inside a panel, so it doesn't jump.
  - Text inside a shrinking panel never reflows or squashes: center it at a fixed width and clip it.
  - Tags stay pinned at the top left of each panel.
  - The board's dots don't swim.
- **No animation on first mount,** and none when a session opens (F, I).

### 4.4 P1 placeholders and additions (not in the mock)

- **Initial mode is Paper** (her work first). Ada's split request at 27.6s (Task 14) brings in the board (K).
- **Paper placeholder** "Waiting for Desk View" (B):
  - A paper card, not the desk color.
  - The tag "Your paper · Desk View" (with a hairline) at the top left.
  - Centered: an authored line glyph, the label, and an optional smoke-text line.
  - Calm and static. No spinner, because nothing is loading (I if a spinner runs forever).
- **Board placeholder:** the dotted canvas and the "Ada's board" ink tag (B). Empty is fine.
- **AvatarPlaceholder:**
  - A woman, in the soft flat style of the reference (`docs/source/ghh-avatar-reference.png`). The mock's sketch avatar is an acceptable placeholder (P, C).
  - Never a generic person icon, initials, emoji, a robot or sparkle "AI" mark, or a photo (P, C).
- **Exit (R18):**
  - From Task 13 on, End session, confirmed through the Sheet, is the only way back. No Back control remains (I if one does).
  - The strip's wordmark, as in the mock, is display-only, never a home link, because a link would be a second exit (I).
  - Task 12's interim Back, until Task 13, is a ghost button after the 84px inset: `no-drag`, with visible focus, never competing with the title (m).
- **Live dot honesty:**
  - P1 captures nothing, but the catalog's `session.liveSource.paper` reads "Desk View · Live".
  - A red LIVE beside a panel that says "Waiting for Desk View" contradicts itself.
  - I recommend a neutral smoke dot and the source alone until capture is real. If the brief's literal label wins, I'll log it as a minor, not a blocker (R, m).
- **Language pill:**
  - Display-only in P1 is fine, with no hover and no pointer.
  - If it's interactive, it needs a name ("Session language: English"), hover and focus states, and a real menu (R, m).
- **Timer:**
  - Starts at `00:00` when the screen mounts (R7), mono 11, `tabular-nums`.
  - Its accessible name is `session.timer`, and it's **not in a live region**, which would announce every second (G, I).
- **Level meter:**
  - P1 has no microphone input, so the bars sit flat at their minimum height, and lie flat or hide while the mic is off.
  - Animated fake levels are a fake signal (F, I).
- **Captions semantics:**
  - The current line sits in `aria-live="polite"` and announces final lines only (G, I).
  - Each line carries its event's `lang` (P, I).
- **Board button (R17):**
  - The dock button and B cycle Paper pinned → Split pinned → Board pinned → Follow Ada → Paper pinned.
  - It's pressed (ink) while any view is pinned, and unpressed while following Ada (R, I if the two look the same).
  - Its accessible name states the current state, for example "Board: Split, pinned" or "Board: following Ada". Its tooltip shows the same (R17, C for the name).
- **Pin indicator (R17).** This is my proposed treatment; the builder and I settle it at Task 13.
  - **Where:** top left of the stage, 8px after the leftmost panel's tag and on the same 26px line. It never touches Ada's tile, top right, or the captions.
  - **Shape:** a paper pill with the hairline, 26px tall, padding 0 4 0 12. It holds:
    - a Pin icon (14px, authored in the `icons.tsx` hand);
    - mono 11 ink `PINNED · SPLIT` (localized view name);
    - a small ghost **Unpin** button inside (sans 13 / 520 ink, 20–22px tall pill, bone hover, its own focus ring).
  - **When Ada asks for another view during a pin:** add `ADA ASKS: BOARD` in mono 11 iris-ink inside the same pill, before Unpin. Iris-ink is her voice color, as on her state label. The pill's chrome stays neutral: no iris fill, ring or button.
  - **Motion:** it fades in and out over 120–150ms, instantly under reduced motion. It's not in a live region; the Board button's name carries the state.
  - **Fit:** in es and ko at 1024×680 in split, the pill ends inside the paper panel. (Estimated: tag plus pill end near x 390, against a panel edge at 506.)
- **End session:**
  - Confirms through the Sheet: "End this session?", then "Keep going" (ghost, focused first) and "End session" (ink primary, not red). Then it returns to the library (B; focus order R, m).
- **Shortcuts (R18):**
  - P1 binds only M, B and C. Space (P2) and S (P7) do nothing yet.
  - The keys fire only with no modifier, and never inside an input or while a sheet is open (B, I).
  - The keys are discoverable through tooltips or `aria-keyshortcuts` (R, m).
- **Share, disabled (R18):**
  - Visible in its dock slot and never pressed. Its icon is smoke `#7a7876` (non-text) or 0.4 opacity, with no hover fill and a default cursor.
  - Prefer `aria-disabled="true"` over `disabled`, so it stays focusable and its tooltip can say why, for example "Screen sharing comes later" (a new catalog key) (R, m).
  - It must not look like a broken button: same size and spacing as its neighbors (I).

### 4.5 Fake tutor, as seen on screen (Task 14)

- **States** show in order on the tile's label, localized. The iris ring appears and disappears with `speaking` and causes no layout shift: it's a box-shadow ring, not a border that resizes the tile (K, C; I).
- **Captions:**
  - The previous line takes over from the current one with at most a 150ms fade, instant under reduced motion.
  - Student lines carry the student's label; tutor lines carry "Ada".
  - The panel keeps its bottom edge (I).
- **The title event** ("Strings that start with 010" with "Automata · DFA") replaces the untitled placeholder in place. The chip appears without pushing the status cluster around (I).
- **The stage event** at 27.6s runs the signature reflow from 4.3, unless the student pinned a view (K, C).
- **E2E capture `p1-fake-tutor`:** I'll compare it against `design/mock/stage-1440x900.png`, the same moment. The content is placeholder, but the structure should match: split 1:1, the tile top right, the ink captions with the 1010 line, the dock (I for structural drift).

---

## 5. How I'll review each task

1. **Sync and build:** sync to the head, then build. I run E2E on port 8999 against `tassel_design`.
2. **Capture:**
   - my own captures at 1440×900 and 1024×680, in en, es and ko;
   - hover and focus states, and reduced-motion runs;
   - frames through the reflow;
   - computed styles compared against `stage-geometry.json`.
3. **Run the tools on the changed files:**
   - impeccable critique and audit;
   - the impeccable detector. A `cream-palette` flag on bone is expected, because the brief pins it, so I won't count it as a finding;
   - the web interface guidelines.
4. **Record:** findings go in `design/task-<N>-design.md`, each citing the rule it breaks, a `file:line`, a capture path and a proposed change.
