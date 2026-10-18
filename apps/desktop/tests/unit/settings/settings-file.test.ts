import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../../src/main/config';
import { readPaperSettings } from '../../../src/main/paper/config';
import { readSavedSettings, writeSavedSettings } from '../../../src/main/settings';

vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['en-US'], isPackaged: false },
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tassel-settings-'));
});

describe('saved settings', () => {
  it('reads nothing from a missing or broken file', () => {
    expect(readSavedSettings(dir)).toEqual({});
    writeFileSync(join(dir, 'settings.json'), '{not json');
    expect(readSavedSettings(dir)).toEqual({});
  });

  it('merges and writes only known, valid values; null clears one', () => {
    expect(writeSavedSettings(dir, { uiLanguage: 'ko', token: 'x' })).toEqual({ uiLanguage: 'ko' });
    expect(writeSavedSettings(dir, { paperSource: 'webcam' })).toEqual({
      uiLanguage: 'ko',
      paperSource: 'webcam',
    });
    expect(writeSavedSettings(dir, { paperSource: 'fake-clip', uiLanguage: 'fr' })).toEqual({});
    writeSavedSettings(dir, { uiLanguage: 'es' });
    expect(writeSavedSettings(dir, { uiLanguage: null })).toEqual({});
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({});
  });

  it('gives the saved UI language unless TASSEL_UI_LANG names one', () => {
    expect(readConfig({}, { uiLanguage: 'ko' }).uiLanguage).toBe('ko');
    expect(readConfig({ TASSEL_UI_LANG: 'es' }, { uiLanguage: 'ko' }).uiLanguage).toBe('es');
    expect(readConfig({}, {}).uiLanguage).toBe('en');
  });

  it('gives the saved paper source only without TASSEL_PAPER_SOURCE or required fake capture', () => {
    const exists = () => false;
    const saved = { paperSource: 'webcam' as const };
    expect(readPaperSettings({}, false, exists, saved).config.source).toBe('webcam');
    expect(readPaperSettings({}, true, exists, saved).config.source).toBe('webcam');
    expect(
      readPaperSettings({ TASSEL_PAPER_SOURCE: 'fake-clip' }, false, exists, saved).config.source,
    ).toBe('fake-clip');
    expect(
      readPaperSettings({ TASSEL_REQUIRE_FAKE_CAPTURE: '1' }, false, exists, saved).config.source,
    ).toBe('auto');
  });
});
