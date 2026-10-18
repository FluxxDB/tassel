import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyVoiceSwitches, voiceSwitches } from '../../../src/main/voice/switches';

vi.mock('electron', () => ({ app: { isPackaged: false } }));
afterEach(() => vi.restoreAllMocks());

it('fake mic switches only unpackaged, with an existing file', () => {
  expect(voiceSwitches({}, false, () => true)).toEqual([]);
  expect(voiceSwitches({ TASSEL_FAKE_MIC: 'clip.wav' }, false, () => true)).toEqual([
    ['use-fake-device-for-media-stream'],
    ['use-file-for-fake-audio-capture', `${resolve('clip.wav')}%noloop`],
  ]);
});
it('noloop unless TASSEL_FAKE_MIC_LOOP=1', () => {
  for (const loop of [undefined, '0', 'true', '1']) {
    expect(
      voiceSwitches(
        { TASSEL_FAKE_MIC: 'clip.wav', TASSEL_FAKE_MIC_LOOP: loop },
        false,
        () => true,
      )[1],
    ).toEqual([
      'use-file-for-fake-audio-capture',
      `${resolve('clip.wav')}${loop === '1' ? '' : '%noloop'}`,
    ]);
  }
});
it('nothing when packaged, without even checking a fixture', () => {
  const exists = vi.fn();
  expect(voiceSwitches({ TASSEL_FAKE_MIC: 'clip.wav' }, true, exists)).toEqual([]);
  expect(exists).not.toHaveBeenCalled();
});
it('a missing file appends nothing and logs once', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const appendSwitch = vi.fn();
  for (let attempt = 0; attempt < 2; attempt++) {
    applyVoiceSwitches({ appendSwitch }, { TASSEL_FAKE_MIC: 'missing-test-fixture.wav' }, false);
  }
  expect(appendSwitch).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
});
it('applies validated switches to Chromium', () => {
  const appendSwitch = vi.fn();
  applyVoiceSwitches(
    { appendSwitch },
    { TASSEL_FAKE_MIC: resolve('tests/unit/windows.test.ts') },
    false,
  );
  expect(appendSwitch.mock.calls).toEqual([
    ['use-fake-device-for-media-stream'],
    ['use-file-for-fake-audio-capture', `${resolve('tests/unit/windows.test.ts')}%noloop`],
  ]);
});
