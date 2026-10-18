# Tutor customization handoff

Branch: `team2/avatar-customization`, based on `origin/claude/live` at `67d10cf`.

The library's Customize tutor button opens a shared SVG preview and draft editor.
Style cycles through seven hair styles (including headscarf), eight hair colors,
four outfits, five outfit colors and five accessories (including none). Body
replaces those controls with eight skin swatches and four drawn, emoticon-style
faces. Tutor names are editable, trimmed, and limited to 30 characters.
Three selectable voice types are explicitly placeholders; no provider settings
or live prompt code changes.

Save writes a validated version-1 profile to `tassel.avatar` in localStorage,
then updates the menu and session tile. Failed storage leaves the previous
profile intact and the draft available. Cancel (including Escape and outside
click) discards the draft. Reset affects the draft until saved. Save celebrates
with happy eyes, a U-shaped smile, halo and sparkles for 1.2 seconds, then closes.
Reduced motion shows the static expression/halo for 450 milliseconds without
particles. Action buttons remain visible while short windows scroll.

## Asset contract

Artwork is authored SVG, not a collection of separately generated PNG cutouts.
All parts share a `0 0 200 220` viewBox and fixed facial/clothing anchors. Stable
IDs in `avatar/catalog.ts` select SVG layers and validated color palettes.
Back hair precedes the body, ears/face, front hair, facial strokes and accessories.
SVG gradient IDs are unique per instance. Add future assets as aligned SVG layers;
transparent raster accessories can be added later with explicit anchors and sizing.
There are no remote asset dependencies or image generation calls.

## Ownership

Implementation lives in renderer `avatar/`, with small hooks in
`features/library/LibraryScreen.tsx` and `features/session/TutorTile.tsx`, plus
EN/ES/KO strings and tests. No edits to server voice/vision/beats, renderer
`tutor/`, provider keys, Electron version, camera behavior or API contracts.
The displayed custom name does not alter the tutor's conversational identity;
that future wiring requires the live-voice owner's coordination. Full P6
lip-sync, idle animations, cloud sync and real voice previews remain separate.

## Validation

- Avatar behavior tests: five passed, including failed persistence, Cancel,
  arrow wrapping, keyboard tabs, save timing and reduced-motion behavior.
- Existing library/session regression tests: 53 passed.
- `pnpm check`: passed (Biome, all typechecks, EN/ES/KO catalogs, API parity,
  camera-frame guard and Ruff).
- Desktop build: passed.
- Electron customization E2E: passed; edit, palette, celebration, reload,
  draft reset/cancel, small window and use of the saved avatar/name in a session.
- Screenshots reviewed: Body palette, Style at 1024x680, save celebration.
- Fake capture/providers only. E2E port 8863, database
  `tassel_t2_avatar_e2e`, bucket `tassel-t2-avatar-e2e`. Shared Docker kept intact.
- Windows display scaling can return 1025 CSS pixels for requested 1024;
  this feature's small-window test tolerates a one-pixel difference without
  changing shared test helpers.

Run from a tool-configured PowerShell in this checkout:

```powershell
pnpm --filter @tassel/desktop test tests/unit/avatar.test.tsx tests/unit/library.test.tsx tests/unit/session-screen.test.tsx
pnpm check
pnpm --filter @tassel/desktop build
$env:TASSEL_E2E_PORT = '8863'
$env:TASSEL_E2E_DATABASE_URL = 'postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_t2_avatar_e2e'
$env:TASSEL_E2E_S3_BUCKET = 'tassel-t2-avatar-e2e'
$env:TASSEL_PROVIDERS = 'fake'
$env:TASSEL_VOICE_ENV_FILE = ''
pnpm --filter @tassel/desktop e2e tests/e2e/avatar.spec.ts
```

## Visual refinement pass

- The neck now renders behind one shared notched shoulder silhouette. Every
  clothing detail is clipped to that silhouette, so collars, hoodie trim and
  overall straps cannot protrude above the shoulders. Sweater ribbing and seams,
  hoodie pocket/drawstrings and overall bib/pocket were authored within it.
- The session tile passes its existing speaking state (excluding connection
  errors) to the SVG. Three exclusive mouth poses cycle with uneven timing
  while speaking; leaving that state removes the animation immediately.
  This is stylized movement, not audio-amplitude or phoneme lip-sync. It adds
  no audio processing, timers, provider calls or changes to speech playback.
  Celebration takes priority; reduced motion shows a static small O.
- Save now sweeps a pastel rainbow across the whole dialog behind its contents,
  with a stronger halo, a small happy bounce and 24 saturated colorful particles.
  Reduced motion keeps a static tint and expression without bounce or particles.
- Validation: 35 targeted unit tests passed; `pnpm check` and desktop build
  passed; both Electron avatar specs passed on port 8863 and the team2 database.
  E2E cycles all 28 outfit/hair combinations, verifies real CSS animation in
  speaking state and its reduced-motion/static rest behavior, and covers the
  full save/reload/session flow. All four outfit screenshots and the rainbow
  save screenshot were reviewed. No real devices or providers used.

## Save-close flash fix

The editor was conditionally removed as soon as `open` became false, while
Radix retained the outer Sheet for its 120 ms exit animation. That left a
collapsed white dialog briefly visible. The editor now stays mounted under
Sheet's presence lifecycle, so content and shell exit together. No timeout or
shared dialog changes were needed.

A new Electron regression failed before the fix because the celebration was
absent during `sheet-out`. Afterward it confirms content and full dialog size
at exit, complete unmount, and a fresh usable editor on reopen. All three avatar
Electron tests passed, along with seven avatar unit tests, TypeScript, focused
Biome checks and desktop build. Tests used the existing team2 port/database and
fake providers/devices.

## Dress, material contrast and prepared voices

Added a dress with visible chest/arms and a skirt in the expanded customization
preview; session tiles keep a bust view. All five outfits share fixed anchors.
The headscarf intentionally retains neck coverage, with fabric edge/fold strokes.
Material-aware boundaries distinguish close hair/skin colors. Overall bib fabric
switches between dark and light denim so navy and other shirt colors stay distinct.

Body now contains separate English, Spanish and Korean voice selectors populated
from real ElevenLabs public metadata. All default to off, remain disconnected
from synthesis, and do not load audio previews. Existing appearances survive
migration from the old generic voice placeholders. See
`2026-10-17-elevenlabs-avatar-catalog.md` for the canonical catalog, discovery
limitations, default fake-TTS dev behavior and future integration instructions.

Validation for this pass: 62 desktop unit tests, nine Node script tests, two
mocked metadata exporter tests, `pnpm check`, desktop build, and four Electron
avatar tests passed. The Electron test cycles all 35 hair/outfit combinations,
checks dress rendering and offline voice persistence, and preserves the closing
animation regression. Dress, headscarf, near-matching skin/hair and navy-overall
screenshots were reviewed. E2E still uses port 8863 and team2 database/storage.

## Bust-only dress correction

At the owner's request, the dress now uses the same fixed 200x220 bust view as
every other outfit. Removed the expanded preview, skirt and arm geometry;
replaced them with a simple dress neckline within the shared shoulder silhouette.
Removed the newly added face, hair and scarf outlines. Other outfits, contrasting
overall colors, voices, persistence and animations are unchanged.

Validation: the new dress framing assertion failed against the expanded version
and passes with this correction. Nine avatar unit tests, TypeScript, focused
Biome checks, build, and two Electron outfit/offline-voice specs passed. Reviewed
the corrected dress screenshot. Checks used the existing fake-only team2 setup.

## Hats, sample playback and sideways-eye alignment

Hats now have separate style/color rows: none, cap, beanie and headscarf. Hair
retains six hairstyles independently. Legacy `hair=headscarf` saves migrate to
`hat=headscarf`, preserving their scarf color and name while choosing a hidden
ponytail as the underlying hair. Headscarves hide hair and cover the neck;
covered clips/star pins/earrings are suppressed without deleting preferences.
Cap and beanie layers leave the underlying hairstyle intact. All artwork remains
bust-only, without the removed external outlines.

The sideways eye pair is recentered on x=102 and y=98.5, leaving its mouth and
other faces alone. The new preview player uses only existing public audio GETs,
never synthesis. It loads only on Play, permits one clip at a time, stops at eight
seconds, cancels on selection/tab/save/reset/close/unmount, and rejects stale
loading completions. Missing/expired samples show an unavailable message with
no paid fallback. CSP permits media only from self and the two stored public
preview hosts. Live TTS defaults and voice settings remain unchanged/off.

Validation: 68 desktop unit tests and repository checks passed; final TypeScript
and build passed. All five Electron avatar scenarios passed across focused runs,
including actual playback of mocked silent WAV media under the app's CSP,
eight-second stopping, no requests before Play, hat persistence, and exact eye
bounding-box alignment. Tests never contacted a provider. Hat and sideways-face
screenshots were reviewed. The existing team2 port/database and fake capture
were used. See the ElevenLabs catalog handoff for the updated preview contract.
