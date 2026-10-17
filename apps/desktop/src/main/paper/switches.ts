// Chromium switches for the fake-clip paper source (dev and E2E only). They must be appended
// before the app is ready. The file switch is read only inside the fake-device branch, so it
// takes both: without the first, getUserMedia would reach a real camera.
import type { PaperSettings } from './config';
import { readPaperSettings } from './config';

export function applyPaperSwitches(
  commandLine: { appendSwitch(name: string, value?: string): void },
  settings: PaperSettings = readPaperSettings(),
): void {
  const { config, fakeClipPath } = settings;
  if (config.source !== 'fake-clip') return;
  if (!config.fakeClip || fakeClipPath === null) {
    // The renderer then shows paper as unavailable, without calling getUserMedia.
    console.error(
      fakeClipPath === null
        ? '[tassel] TASSEL_PAPER_SOURCE=fake-clip needs TASSEL_FAKE_CLIP, so there is no fake camera.'
        : `[tassel] TASSEL_FAKE_CLIP ${fakeClipPath} doesn't exist, so there is no fake camera.`,
    );
    return;
  }
  commandLine.appendSwitch('use-fake-device-for-media-stream');
  commandLine.appendSwitch('use-file-for-fake-video-capture', fakeClipPath);
}
