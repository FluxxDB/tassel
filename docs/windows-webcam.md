# Windows webcam paper test

This opt-in path uses a regular webcam or a virtual phone camera as the paper
source. macOS auto/Desk View behavior is unchanged. Drawing work is outside this
change.

## Run

From a Windows terminal, with provider keys in `services/server/.env`:

```powershell
node scripts/team2.mjs webcam
```

Or double-click `Start-Tassel-Webcam.cmd` in the parent `tassel` folder.
The launcher uses Node and cross-spawn, port 8861, database
`tassel_t2_webcam`, and separate app data. It clears fake capture overrides.
Stop your previous webcam app with Ctrl+C before restarting. Existing sessions
in the previous database remain there; this isolated database starts separately.
The launcher creates its database and applies migrations without resetting Docker.

Create a session and choose **Paper · Camera**. After capture starts, use the
**Paper camera** selector at the top of the paper panel to choose a device.
A phone camera can be selected if its Windows software exposes it as a standard
camera; no phone-specific API is required by Tassel. Start that software before
starting the session. To refresh the device list after connecting another camera,
turn Camera off and on.

Hold the paper steady with all four edges visible, well lit, and filling much
of the image. Upload timing uses the original detector: it establishes a reference
without sending it, then uploads when its existing change rules trigger. The debug pill's **sent** count confirms
successful uploads. Once it increments, ask Ada to read the page. Images are
attached on student turns; capture alone does not trigger continuous commentary.
End session or turn Camera off to stop capture.

The preview is the original camera feed. The existing server pipeline detects
the page, corrects perspective, and enhances contrast/sharpness for the model's
image. This is not Apple's proprietary scanner, and image cleanup cannot recover
writing that the camera captured out of focus. The existing detector has known fallback-crop and motion problems; see the
[detection audit](research/2026-10-17-paper-detection-audit.md).

If access is blocked, enable desktop camera access in Windows Settings → Privacy
& security → Camera. If unavailable, close other apps using the camera, connect
the device/start the phone camera software, then Retry.

## Integration notes

- Branch: `team2/windows-webcam`, based on live `7e0ceb9`.
- Server/API metadata gains the `webcam` source. Migration revision
  `webcam_source_01` follows `0003`; reconcile Alembic heads if another track adds
  a sibling migration. Existing rows are preserved.
- Camera video requests `audio: false`; the voice client owns the microphone.
- The added initial-page upload was reverted at the owner's request. Webcam and
  other sources now use the original trigger behavior without a special first upload.
- E2E exercises this source with a synthetic video clip and fake microphone,
  enforced by the capture guard. It never opens a real camera or calls a provider.
- Real webcam focus, lighting, phone driver behavior and provider image-reading
  quality need an owner-run test.

## Validation on Windows

- Desktop build, TypeScript checks, and EN/ES/KO catalog checks passed.
- Paper/session regression suite: 305 passed, 2 macOS helper tests skipped.
- Earlier webcam tests passed before rollback; current rollback/audit validation
  is recorded in `research/2026-10-17-paper-detection-audit.md`.
- Backend frame suite against the migrated database: 99 passed, including a
  webcam frame stored and returned through the API.
- Electron webcam E2E passed with synthetic capture: enabled Paper on Windows,
  live video and device selector, uploaded frame with source
  `webcam`, return to the library, and video track ended after End session.
- Drawing and real-provider behavior were not modified or tested in this task.

## Team 2 checks

```powershell
node --test scripts/team2.test.mjs
node scripts/team2.mjs desktop-test
node scripts/team2.mjs server-test
node scripts/team2.mjs check
node scripts/team2.mjs e2e tests/e2e/webcam.spec.ts
```

Tests force fake providers and capture. Unit tests use `tassel_t2_webcam_test`;
E2E uses port 8862 and `tassel_t2_webcam_e2e`. Shared Docker services are
reused. Do not run `docker compose down` or reset another team's database.
Production detector, voice, beats and tutor code are unchanged. Coordinate the
new Alembic migration with the integration owner before merging.

## Team 2 alignment validation

On Windows, after moving this checkout to `team2/windows-webcam`:

- `node --test scripts/team2.test.mjs`: 4 passed.
- `node scripts/team2.mjs check`: all checks passed (Biome, TypeScript,
  three-language catalogs, generated API parity, frame guard and Ruff).
- Desktop paper, capture-guard and new-session regression tests: 328 passed,
  2 macOS-only tests skipped.
- Backend frame suite and vision audit: 107 passed on the team2 test database.
- Desktop build and synthetic webcam E2E: 1 passed on port 8862,
  database `tassel_t2_webcam_e2e`; synthetic screenshot reviewed.

The repository guidance and P1–P5 constraints were reviewed for this work.
The original detector directory matches the base commit; the extra first-page
upload remains reverted. No real devices or paid providers were used by these
checks. Local `.cmd` shortcuts invoke this Node entry point directly.
