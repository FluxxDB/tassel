# Windows local test setup

Prepared 2026-10-17 in `C:\Users\perry\Desktop\tassel`.

## Open the app

1. Open File Explorer and go to `C:\Users\perry\Desktop\tassel`.
2. Double-click `Start-Tassel.cmd`.
3. Leave the terminal window open while using Tassel. It starts the database,
   storage, server and desktop app. This launcher explicitly selects the scripted
   tutor and synthetic paper/microphone devices.
4. Press Ctrl+C in that terminal when finished.

The runnable checkout is `.local\live-test`, cloned from `claude/live` at
`7e0ceb9`. This is separate from the original checkout and other developers'
branches. Portable Node 22.23.3, pnpm 12.6.0 and uv 0.13.1 live under
`.local\tools`; the launcher sets PATH for its own process. Existing global
Node and system PATH were left alone. Python 3.12 was already installed.

## Real microphone conversation

Copy `.local\live-test\services\server\.env.example` to `.env` in the same
directory, and fill in Deepgram, ElevenLabs and OpenRouter keys. OpenAI can
serve as the alternative LLM provider. Keep keys in that file.

Double-click `Start-Tassel-Live-Voice.cmd`, then choose **Talk** when creating a
session. This mode selects live providers and the actual microphone. Windows
has no macOS Desk View. The synthetic paper mode also substitutes a fake
microphone, so do not use it to assess real spoken tutoring.

## Windows webcam and paper

Stop the previous app/server with Ctrl+C, then double-click
`Start-Tassel-Webcam.cmd`. Create a session, select **Paper · Camera**, and use
the **Paper camera** selector in the paper panel to choose your webcam or phone
camera. A phone must already appear as a Windows camera. Hold the whole page
steady and wait for the debug pill's **sent** count to increment before asking
Ada what she sees. This mode uses your real camera and microphone.

The extra first-page upload has been reverted. Webcam mode uses the original
change detector, which establishes a reference and uploads when changes trigger it.
Existing perspective correction and contrast/sharpness enhancement are applied
to the model's image; the live preview remains the original camera feed.

## Docker startup recovery performed

Docker Desktop 4.89.0 initially failed on inaccessible stale AF_UNIX socket
files. Docker was stopped with its supported CLI, then runtime directories
were preserved under timestamped backup names and recreated:

- `%LOCALAPPDATA%\Docker\run`
- `%LOCALAPPDATA%\docker-secrets-engine`

Docker subsequently started and the app's Postgres and S3 containers became
healthy. Images, container data and volumes were not reset. Backup directories
were retained. Matching report:
https://github.com/docker/desktop-feedback/issues/554

If Docker is unavailable later, open Docker Desktop and wait for its engine
to become ready before opening the launcher. A factory reset is not part of
this setup.

## Verification

- Windows desktop build: passed.
- Desktop TypeScript checks: passed.
- Shared package tests: 258 passed.
- Electron shell smoke checks: 3 passed; the Korean design check failed on
  Windows display rounding (`51.9978px` versus an exact `52px` assertion).
- Creating a session, ending it, and returning to its library card: passed.
- Real-provider voice was not exercised; credentials still need to be added.
