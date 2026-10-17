# Permission and Desk View spikes (2026-10-17)

Throwaway probes run on the owner's MacBook Pro (M5 Pro, macOS 26) while planning. They are kept here as reference for P3 (Paper view); none of this is product code.

| File | What it checks | Result on this Mac |
|---|---|---|
| `deskview-list.swift` | Enumerates video devices with AVFoundation, including `.deskViewCamera`. Build: `swiftc deskview-list.swift -o list`. | Lists the built-in "MacBook Pro Desk View Camera" and an iPhone's Desk View camera. Chromium's `getUserMedia` does not list Desk View, hence the planned Swift helper. |
| `swift-perms/perms.swift` + `Info.plist` | Requests camera and microphone, checks Screen Recording, then grabs one Desk View frame to a JPEG path given as argv[1]. | When launched from an agent's shell, macOS attributes the request to the agent (the responsible process), which has no camera grant. Launch through LaunchServices instead (`open -W -n …`). |
| `electron-perms/` | Electron 44.9.0 asks for camera, microphone and screen access (`askForMediaAccess`, `desktopCapturer`). | `results.txt`: camera and microphone granted; screen denied. The owner later added `~/Applications/Electron.app` (a copy of 44.9.0) to Screen Recording. |
| `p3-tcc/` | P3 Task 1's gate. `probe.swift` (with `Info.plist`) reads camera status, counts Desk View frames, presents the Desk View app and writes a synthetic MJPEG. `main.cjs` is an Electron main with one mode per check. `node p3-tcc/run.mjs A F P T C E` runs the unattended checks; H, D and S need the owner at the Mac. | `p3-tcc/RESULTS.md`: verdicts, JSON lines and the decision table that later P3 tasks branch on. |

Rules that came out of these spikes:

- Electron stays pinned at exactly 44.9.0. The npm build is ad-hoc signed, so macOS ties camera, microphone and screen grants to that binary.
- Camera-dependent checks launch Electron through LaunchServices (`open -a` / `open -W -n`), or use the synthetic clip.
- Any frame captured from the real camera stays on this machine. It is never committed and never posted anywhere.
