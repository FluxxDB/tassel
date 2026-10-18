// Chromium switches for fake media devices (dev and E2E only). They must be appended before the
// app is ready. The file switch is read only inside the fake-device branch, so it takes both:
// without the first, getUserMedia would reach a real camera.
// - The fake-clip paper source plays TASSEL_FAKE_CLIP as its camera.
// - TASSEL_REQUIRE_FAKE_CAPTURE=1 (every E2E launch, ruling P3-R24) gives every paper source fake
//   camera and microphone devices, so nothing in such a run can reach a real one through
//   getUserMedia, whatever the source (the capture guard review's C1). Without a clip, the fake
//   camera is Chromium's generated pattern.
import type { PaperSettings } from './config';
import { readPaperSettings } from './config';

const FAKE_DEVICES = 'use-fake-device-for-media-stream';

export function applyPaperSwitches(
  commandLine: { appendSwitch(name: string, value?: string): void },
  settings: PaperSettings = readPaperSettings(),
): void {
  const { config, fakeClipPath, requireFake } = settings;
  const clip =
    (config.source === 'fake-clip' || (config.source === 'webcam' && requireFake)) &&
    config.fakeClip &&
    fakeClipPath !== null;
  if (config.source === 'fake-clip' && !clip) {
    // The renderer then shows paper as unavailable, without calling getUserMedia.
    console.error(
      fakeClipPath === null
        ? '[tassel] TASSEL_PAPER_SOURCE=fake-clip needs TASSEL_FAKE_CLIP, so there is no fake camera.'
        : `[tassel] TASSEL_FAKE_CLIP ${fakeClipPath} doesn't exist, so there is no fake camera.`,
    );
  }
  if (!clip && !requireFake) return;
  commandLine.appendSwitch(FAKE_DEVICES);
  if (clip) commandLine.appendSwitch('use-file-for-fake-video-capture', fakeClipPath);
}
