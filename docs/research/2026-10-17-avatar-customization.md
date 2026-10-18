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
