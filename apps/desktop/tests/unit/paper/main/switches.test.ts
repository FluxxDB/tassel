import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPaperSettings } from '../../../../src/main/paper/config';
import { applyPaperSwitches } from '../../../../src/main/paper/switches';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const CLIP = resolve('/clips/dfa-short.mjpeg');

function commandLine() {
  return { appendSwitch: vi.fn<(name: string, value?: string) => void>() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyPaperSwitches', () => {
  it('appends both switches with the absolute clip path', () => {
    const relative = 'clips/dfa-short.mjpeg';
    const settings = readPaperSettings(
      { TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_FAKE_CLIP: relative },
      false,
      (path) => path === resolve(relative),
    );
    const line = commandLine();
    applyPaperSwitches(line, settings);
    expect(line.appendSwitch.mock.calls).toEqual([
      ['use-fake-device-for-media-stream'],
      ['use-file-for-fake-video-capture', resolve(relative)],
    ]);
  });

  it('nothing when packaged', () => {
    const settings = readPaperSettings(
      { TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_FAKE_CLIP: CLIP },
      true,
      () => true,
    );
    const line = commandLine();
    applyPaperSwitches(line, settings);
    expect(line.appendSwitch).not.toHaveBeenCalled();
  });

  it('nothing and one error line when the clip is missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = readPaperSettings(
      { TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_FAKE_CLIP: CLIP },
      false,
      () => false,
    );
    const line = commandLine();
    applyPaperSwitches(line, settings);
    expect(line.appendSwitch).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(CLIP);

    // No TASSEL_FAKE_CLIP at all: still nothing, and one line.
    error.mockClear();
    applyPaperSwitches(line, readPaperSettings({ TASSEL_PAPER_SOURCE: 'fake-clip' }, false));
    expect(line.appendSwitch).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it.each(['fake-clip', 'auto', 'deskview-helper', 'window-capture', 'screen'])(
    'requireFake gives every source fake camera and microphone devices (%s; review C1)',
    (source) => {
      // The clip itself is missing, so even fake-clip has no file: fail closed, still fake.
      const settings = readPaperSettings(
        { TASSEL_PAPER_SOURCE: source, TASSEL_REQUIRE_FAKE_CAPTURE: '1' },
        false,
        () => false,
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const line = commandLine();
      applyPaperSwitches(line, settings);
      expect(line.appendSwitch.mock.calls).toEqual([['use-fake-device-for-media-stream']]);
    },
  );

  it('requireFake with an existing clip plays it as the fake camera', () => {
    const settings = readPaperSettings(
      {
        TASSEL_PAPER_SOURCE: 'fake-clip',
        TASSEL_FAKE_CLIP: CLIP,
        TASSEL_REQUIRE_FAKE_CAPTURE: '1',
      },
      false,
      () => true,
    );
    const line = commandLine();
    applyPaperSwitches(line, settings);
    expect(line.appendSwitch.mock.calls).toEqual([
      ['use-fake-device-for-media-stream'],
      ['use-file-for-fake-video-capture', CLIP],
    ]);
  });

  it.each(['auto', 'deskview-helper', 'window-capture', 'screen'])(
    'nothing for other sources (%s)',
    (source) => {
      const settings = readPaperSettings(
        { TASSEL_PAPER_SOURCE: source, TASSEL_FAKE_CLIP: CLIP },
        false,
        () => true,
      );
      const line = commandLine();
      applyPaperSwitches(line, settings);
      expect(line.appendSwitch).not.toHaveBeenCalled();
    },
  );
});
