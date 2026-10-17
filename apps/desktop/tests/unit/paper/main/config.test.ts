import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPaperSettings } from '../../../../src/main/paper/config';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

/** An `exists` that knows only these paths. */
const existing =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

const FAKE_CLIP = resolve('/clips/dfa-short.mjpeg');
const HELPER_CLIP = resolve('/clips/helper.mjpeg');

/** Every TASSEL_* variable P3 reads, set to a usable value. */
const EVERYTHING = {
  TASSEL_PAPER_SOURCE: 'fake-clip',
  TASSEL_PAPER_DEBUG: '1',
  TASSEL_FAKE_CLIP: FAKE_CLIP,
  TASSEL_HELPER_CLIP: HELPER_CLIP,
  TASSEL_DESKVIEW_HELPER: '/opt/deskview-helper',
  TASSEL_HELPER_TAG: 'spec-7',
  TASSEL_FAKE_DISPLAY: 'self',
  TASSEL_FAKE_CAMERA_ACCESS: 'denied',
  TASSEL_PAPER_PARAMS: '{"quietInkMs":1500,"busyFraction":0.01}',
  TASSEL_REQUIRE_FAKE_CAPTURE: '1',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPaperSettings', () => {
  it('defaults to auto with fakes off', () => {
    expect(readPaperSettings({}, false, () => false)).toEqual({
      config: { source: 'auto', debug: false, helperClip: false, fakeClip: false, params: {} },
      fakeClipPath: null,
      helperClipPath: null,
      helperPathOverride: null,
      helperTag: null,
      fakeDisplay: null,
      fakeCameraAccess: null,
      requireFake: false,
    });
  });

  it('reads every variable', () => {
    expect(readPaperSettings(EVERYTHING, false, existing(FAKE_CLIP, HELPER_CLIP))).toEqual({
      config: {
        source: 'fake-clip',
        debug: true,
        helperClip: true,
        fakeClip: true,
        params: { quietInkMs: 1500, busyFraction: 0.01 },
      },
      fakeClipPath: FAKE_CLIP,
      helperClipPath: HELPER_CLIP,
      helperPathOverride: '/opt/deskview-helper',
      helperTag: 'spec-7',
      fakeDisplay: 'self',
      fakeCameraAccess: 'denied',
      requireFake: true,
    });
  });

  it.each(['auto', 'deskview-helper', 'window-capture', 'fake-clip', 'screen'])(
    'takes the source %s',
    (source) => {
      expect(readPaperSettings({ TASSEL_PAPER_SOURCE: source }, false).config.source).toBe(source);
    },
  );

  it('treats an unknown source as auto', () => {
    expect(readPaperSettings({ TASSEL_PAPER_SOURCE: 'camera' }, false).config.source).toBe('auto');
  });

  it('has a fake clip only for the fake-clip source, when its file exists', () => {
    const exists = existing(FAKE_CLIP);
    const read = (source: string, clip = FAKE_CLIP) =>
      readPaperSettings({ TASSEL_PAPER_SOURCE: source, TASSEL_FAKE_CLIP: clip }, false, exists);
    expect(read('fake-clip').config.fakeClip).toBe(true);
    expect(read('auto').config.fakeClip).toBe(false);
    // A missing file: no fake camera, but the path stays, so the switches can name it.
    expect(read('fake-clip', '/clips/gone.mjpeg').config.fakeClip).toBe(false);
    expect(read('fake-clip', '/clips/gone.mjpeg').fakeClipPath).toBe(resolve('/clips/gone.mjpeg'));
  });

  it('keeps a helper clip that is missing, so the helper never falls back to the camera', () => {
    const settings = readPaperSettings(
      { TASSEL_HELPER_CLIP: '/clips/gone.mjpeg' },
      false,
      () => false,
    );
    expect(settings.config.helperClip).toBe(false);
    expect(settings.helperClipPath).toBe(resolve('/clips/gone.mjpeg'));
  });

  it('treats an empty clip variable as unset, so it never reaches the helper', () => {
    // The helper takes an empty TASSEL_HELPER_CLIP as clip mode; Electron doesn't pass one.
    // With TASSEL_REQUIRE_FAKE_CAPTURE, no clip means no helper at all.
    const settings = readPaperSettings(
      { TASSEL_HELPER_CLIP: '', TASSEL_FAKE_CLIP: '' },
      false,
      () => true,
    );
    expect(settings.helperClipPath).toBeNull();
    expect(settings.fakeClipPath).toBeNull();
    expect(settings.config.helperClip).toBe(false);
  });

  it('makes clip paths absolute', () => {
    const settings = readPaperSettings(
      {
        TASSEL_PAPER_SOURCE: 'fake-clip',
        TASSEL_FAKE_CLIP: 'clips/a.mjpeg',
        TASSEL_HELPER_CLIP: 'b.mjpeg',
      },
      false,
      () => true,
    );
    expect(settings.fakeClipPath).toBe(resolve('clips/a.mjpeg'));
    expect(settings.helperClipPath).toBe(resolve('b.mjpeg'));
  });

  it('ignores values it does not know', () => {
    const settings = readPaperSettings(
      {
        TASSEL_PAPER_DEBUG: 'true',
        TASSEL_FAKE_DISPLAY: 'screen',
        TASSEL_FAKE_CAMERA_ACCESS: 'maybe',
        TASSEL_REQUIRE_FAKE_CAPTURE: 'yes',
      },
      false,
    );
    expect(settings.config.debug).toBe(false);
    expect(settings.fakeDisplay).toBeNull();
    expect(settings.fakeCameraAccess).toBeNull();
    expect(settings.requireFake).toBe(false);
  });

  it.each(['granted', 'denied', 'not-determined'])('fakes camera access %s', (access) => {
    expect(readPaperSettings({ TASSEL_FAKE_CAMERA_ACCESS: access }, false).fakeCameraAccess).toBe(
      access,
    );
  });

  it('a packaged app ignores every fake and keeps only auto, deskview-helper and window-capture', () => {
    const packaged = (source: string) =>
      readPaperSettings(
        { ...EVERYTHING, TASSEL_PAPER_SOURCE: source },
        true,
        existing(FAKE_CLIP, HELPER_CLIP),
      );
    for (const source of ['auto', 'deskview-helper', 'window-capture']) {
      expect(packaged(source).config.source).toBe(source);
    }
    for (const source of ['fake-clip', 'screen', 'nonsense']) {
      expect(packaged(source).config.source).toBe('auto');
    }
    expect(packaged('deskview-helper')).toEqual({
      config: {
        source: 'deskview-helper',
        debug: false,
        helperClip: false,
        fakeClip: false,
        params: {},
      },
      fakeClipPath: null,
      helperClipPath: null,
      helperPathOverride: null,
      helperTag: null,
      fakeDisplay: null,
      fakeCameraAccess: null,
      requireFake: false,
    });
  });

  it('bad params JSON gives {}', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      readPaperSettings({ TASSEL_PAPER_PARAMS: '{"quietInkMs":' }, false).config.params,
    ).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    // Not an object, either.
    expect(readPaperSettings({ TASSEL_PAPER_PARAMS: '[1500]' }, false).config.params).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps only the finite numbers in params, and says which it dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const params = '{"quietInkMs":2000,"inkDelta":"0.1","cellSize":null,"motionDelta":1e999}';
    expect(readPaperSettings({ TASSEL_PAPER_PARAMS: params }, false).config.params).toEqual({
      quietInkMs: 2000,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('inkDelta');
  });
});
