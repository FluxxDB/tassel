// The E2E capture guard (Task 13, ruling P3-R24). launchApp runs every spec on the fake clip,
// with the app's own real-capture refusal on, and calls assertFakeCapture before each launch: a
// launch whose paper source could reach a real camera or display never starts. Each spec's
// screenshots then show only the synthetic clip or our own window.
//
// No Playwright import, so Vitest can test it (tests/unit/capture-guard.test.ts).
import { existsSync } from 'node:fs';

/** launchApp's paper settings, under each spec's own env: the generated clip, played as a camera. */
export function fakeCaptureEnv(clip: string | undefined): Record<string, string | undefined> {
  return {
    TASSEL_PAPER_SOURCE: 'fake-clip',
    TASSEL_FAKE_CLIP: clip,
    TASSEL_REQUIRE_FAKE_CAPTURE: '1',
  };
}

/**
 * Throws, naming the rule, unless the launch is fake end to end:
 * - TASSEL_REQUIRE_FAKE_CAPTURE is 1, so the app itself refuses real capture (Task 9);
 * - TASSEL_PAPER_SOURCE is set and isn't auto, which picks the real Desk View camera on macOS;
 * - fake-clip or webcam has a TASSEL_FAKE_CLIP that exists (webcam is forced onto fake devices);
 * - deskview-helper has a TASSEL_HELPER_CLIP that exists, or a TASSEL_DESKVIEW_HELPER that
 *   doesn't, or TASSEL_FAKE_CAMERA_ACCESS=denied;
 * - window-capture and screen have TASSEL_FAKE_DISPLAY=self.
 */
export function assertFakeCapture(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean = existsSync,
): void {
  const refuse = (rule: string): never => {
    throw new Error(`capture guard: ${rule}. E2E never reaches a real camera or display.`);
  };
  const has = (name: string) => (env[name] ?? '') !== '';
  const existing = (name: string) => has(name) && exists(env[name] as string);

  if (env.TASSEL_REQUIRE_FAKE_CAPTURE !== '1') {
    refuse('TASSEL_REQUIRE_FAKE_CAPTURE must be 1');
  }
  const source = env.TASSEL_PAPER_SOURCE ?? '';
  switch (source) {
    case 'webcam':
    case 'fake-clip':
      if (!existing('TASSEL_FAKE_CLIP')) refuse(`${source} needs a TASSEL_FAKE_CLIP that exists`);
      return;
    case 'deskview-helper': {
      const clip = existing('TASSEL_HELPER_CLIP');
      const missingHelper = has('TASSEL_DESKVIEW_HELPER') && !existing('TASSEL_DESKVIEW_HELPER');
      const denied = env.TASSEL_FAKE_CAMERA_ACCESS === 'denied';
      if (!clip && !missingHelper && !denied) {
        refuse(
          'deskview-helper needs a TASSEL_HELPER_CLIP that exists, a TASSEL_DESKVIEW_HELPER ' +
            "that doesn't, or TASSEL_FAKE_CAMERA_ACCESS=denied",
        );
      }
      return;
    }
    case 'window-capture':
    case 'screen':
      if (env.TASSEL_FAKE_DISPLAY !== 'self') refuse(`${source} needs TASSEL_FAKE_DISPLAY=self`);
      return;
    default:
      // Unset, auto, or a value the app doesn't know (which it reads as auto).
      refuse(
        `TASSEL_PAPER_SOURCE must be fake-clip, deskview-helper, window-capture or screen, ` +
          `not ${JSON.stringify(source)}`,
      );
  }
}
