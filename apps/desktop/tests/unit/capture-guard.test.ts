// The E2E capture guard (Task 13, ruling P3-R24): launchApp refuses any launch whose paper source
// could reach a real camera or display.
import { describe, expect, it } from 'vitest';
import { assertFakeCapture, fakeCaptureEnv } from '../e2e/capture-guard';

const CLIP = '/clips/dfa-short-960x720.mjpeg';
const MISSING_HELPER = '/nowhere/deskview-helper';
/** Only CLIP exists. */
const exists = (path: string) => path === CLIP;
const guarded = (env: Record<string, string | undefined>) => () => assertFakeCapture(env, exists);

describe('assertFakeCapture', () => {
  it('allows webcam tests only with fake capture and an existing synthetic clip', () => {
    const base = { TASSEL_PAPER_SOURCE: 'webcam', TASSEL_REQUIRE_FAKE_CAPTURE: '1' };
    expect(guarded(base)).toThrow(/TASSEL_FAKE_CLIP/);
    expect(guarded({ ...base, TASSEL_FAKE_CLIP: CLIP })).not.toThrow();
    expect(guarded({ ...base, TASSEL_FAKE_CLIP: CLIP, TASSEL_REQUIRE_FAKE_CAPTURE: '0' })).toThrow(
      /TASSEL_REQUIRE_FAKE_CAPTURE/,
    );
  });
  it('refuses an unset or auto source', () => {
    expect(guarded({ TASSEL_REQUIRE_FAKE_CAPTURE: '1' })).toThrow(/TASSEL_PAPER_SOURCE/);
    expect(guarded({ TASSEL_REQUIRE_FAKE_CAPTURE: '1', TASSEL_PAPER_SOURCE: '' })).toThrow(
      /TASSEL_PAPER_SOURCE/,
    );
    expect(guarded({ TASSEL_REQUIRE_FAKE_CAPTURE: '1', TASSEL_PAPER_SOURCE: 'auto' })).toThrow(
      /TASSEL_PAPER_SOURCE/,
    );
    // The app reads an unknown source as auto, so the guard refuses that too.
    expect(guarded({ TASSEL_REQUIRE_FAKE_CAPTURE: '1', TASSEL_PAPER_SOURCE: 'camera' })).toThrow(
      /TASSEL_PAPER_SOURCE/,
    );
  });

  it('refuses fake-clip without an existing clip', () => {
    const base = { TASSEL_REQUIRE_FAKE_CAPTURE: '1', TASSEL_PAPER_SOURCE: 'fake-clip' };
    expect(guarded(base)).toThrow(/TASSEL_FAKE_CLIP/);
    expect(guarded({ ...base, TASSEL_FAKE_CLIP: '/clips/missing.mjpeg' })).toThrow(
      /TASSEL_FAKE_CLIP/,
    );
    expect(guarded({ ...base, TASSEL_FAKE_CLIP: CLIP })).not.toThrow();
  });

  it('refuses the helper with neither a clip, a missing binary nor denied access', () => {
    const base = { TASSEL_REQUIRE_FAKE_CAPTURE: '1', TASSEL_PAPER_SOURCE: 'deskview-helper' };
    expect(guarded(base)).toThrow(/deskview-helper/);
    expect(guarded({ ...base, TASSEL_HELPER_CLIP: '/clips/missing.mjpeg' })).toThrow(
      /deskview-helper/,
    );
    expect(guarded({ ...base, TASSEL_FAKE_CAMERA_ACCESS: 'granted' })).toThrow(/deskview-helper/);
    // Each one alone is enough: a clip, a helper that isn't there, or access the fake denies.
    expect(guarded({ ...base, TASSEL_HELPER_CLIP: CLIP })).not.toThrow();
    expect(guarded({ ...base, TASSEL_DESKVIEW_HELPER: MISSING_HELPER })).not.toThrow();
    expect(guarded({ ...base, TASSEL_FAKE_CAMERA_ACCESS: 'denied' })).not.toThrow();
  });

  it('refuses window and screen without TASSEL_FAKE_DISPLAY=self', () => {
    for (const source of ['window-capture', 'screen']) {
      const base = { TASSEL_REQUIRE_FAKE_CAPTURE: '1', TASSEL_PAPER_SOURCE: source };
      expect(guarded(base)).toThrow(/TASSEL_FAKE_DISPLAY/);
      expect(guarded({ ...base, TASSEL_FAKE_DISPLAY: 'screen' })).toThrow(/TASSEL_FAKE_DISPLAY/);
      expect(guarded({ ...base, TASSEL_FAKE_DISPLAY: 'self' })).not.toThrow();
    }
  });

  it('refuses a launch without TASSEL_REQUIRE_FAKE_CAPTURE=1', () => {
    const fake = { TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_FAKE_CLIP: CLIP };
    expect(guarded(fake)).toThrow(/TASSEL_REQUIRE_FAKE_CAPTURE/);
    expect(guarded({ ...fake, TASSEL_REQUIRE_FAKE_CAPTURE: '0' })).toThrow(
      /TASSEL_REQUIRE_FAKE_CAPTURE/,
    );
  });

  it("accepts launchApp's default", () => {
    expect(fakeCaptureEnv(CLIP)).toEqual({
      TASSEL_PAPER_SOURCE: 'fake-clip',
      TASSEL_FAKE_CLIP: CLIP,
      TASSEL_REQUIRE_FAKE_CAPTURE: '1',
    });
    expect(guarded(fakeCaptureEnv(CLIP))).not.toThrow();
    // Without the generated clip (no global setup), the default is refused, not launched.
    expect(guarded(fakeCaptureEnv(undefined))).toThrow(/TASSEL_FAKE_CLIP/);
  });
});
