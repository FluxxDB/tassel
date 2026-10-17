import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readPaperSettings } from '../../../../src/main/paper/config';
import { helperPath } from '../../../../src/main/paper/helper-path';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const REPO = join('/', 'Users', 'dang', 'tassel');
const OUT_MAIN = join(REPO, 'apps', 'desktop', 'out', 'main');
const PACKAGE = join(REPO, 'native', 'deskview-helper', 'Package.swift');
const BUILT = join(REPO, 'native', 'deskview-helper', '.build', 'release', 'deskview-helper');

const settings = (override?: string) =>
  readPaperSettings(override ? { TASSEL_DESKVIEW_HELPER: override } : {}, false);

function at(overrides: Partial<Parameters<typeof helperPath>[1]> = {}) {
  return {
    packaged: false,
    resourcesPath: join('/', 'Applications', 'Tassel.app', 'Contents', 'Resources'),
    startDir: OUT_MAIN,
    platform: 'darwin' as NodeJS.Platform,
    exists: (path: string) => path === PACKAGE,
    ...overrides,
  };
}

describe('helperPath', () => {
  it('the env override wins', () => {
    expect(helperPath(settings('/opt/deskview-helper'), at())).toBe('/opt/deskview-helper');
    expect(helperPath(settings('/opt/deskview-helper'), at({ packaged: true }))).toBe(
      '/opt/deskview-helper',
    );
  });

  it('finds the repo from out/main', () => {
    expect(helperPath(settings(), at())).toBe(BUILT);
    // pnpm dev, Playwright and LaunchServices all run from out/main, at any depth up to six.
    const deeper = join(REPO, 'a', 'b', 'c', 'd', 'e');
    expect(helperPath(settings(), at({ startDir: deeper }))).toBe(BUILT);
  });

  it('gives up beyond six levels', () => {
    const tooDeep = join(REPO, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    expect(helperPath(settings(), at({ startDir: tooDeep }))).toBeNull();
    expect(helperPath(settings(), at({ exists: () => false }))).toBeNull();
  });

  it('packaged uses resourcesPath', () => {
    expect(helperPath(settings(), at({ packaged: true }))).toBe(
      join('/', 'Applications', 'Tassel.app', 'Contents', 'Resources', 'deskview-helper'),
    );
  });

  it('null off darwin', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(helperPath(settings(), at({ platform }))).toBeNull();
      expect(helperPath(settings('/opt/deskview-helper'), at({ platform }))).toBeNull();
    }
  });
});
