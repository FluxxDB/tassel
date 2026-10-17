import { describe, expect, it } from 'vitest';
import {
  choosePaperSource,
  createPaperSource,
  MACOS_DEFAULT,
  needsCameraAccess,
  shouldUpload,
} from '../../../../src/renderer/src/paper/select-source';
import type {
  PaperBridge,
  PaperConfig,
  PaperSourceKind,
} from '../../../../src/shared/paper-bridge';

const KINDS: PaperSourceKind[] = ['deskview-helper', 'window-capture', 'fake-clip', 'screen'];
const CONFIG: PaperConfig = {
  source: 'auto',
  debug: false,
  helperClip: false,
  fakeClip: false,
  params: {},
};

describe('choosing a paper source', () => {
  it('choosePaperSource: configured wins; auto picks MACOS_DEFAULT on darwin and null on win32 and linux', () => {
    for (const kind of KINDS) {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        expect(choosePaperSource(kind, platform)).toBe(kind);
      }
    }
    // Task 1's check H passed: the helper reads Desk View on Electron's camera grant.
    expect(MACOS_DEFAULT).toBe('deskview-helper');
    expect(choosePaperSource('auto', 'darwin')).toBe(MACOS_DEFAULT);
    expect(choosePaperSource('auto', 'win32')).toBeNull();
    expect(choosePaperSource('auto', 'linux')).toBeNull();
  });

  it('shouldUpload is false only for screen', () => {
    expect(KINDS.filter((kind) => !shouldUpload(kind))).toEqual(['screen']);
  });

  it('needs camera access only for the helper without a clip', () => {
    expect(needsCameraAccess('deskview-helper', CONFIG)).toBe(true);
    expect(needsCameraAccess('deskview-helper', { ...CONFIG, helperClip: true })).toBe(false);
    for (const kind of ['window-capture', 'fake-clip', 'screen'] as const) {
      expect(needsCameraAccess(kind, CONFIG)).toBe(false);
    }
  });

  it('creates a source of each kind', () => {
    const deps = {
      bridge: {} as PaperBridge,
      config: CONFIG,
      mediaDevices: {} as MediaDevices,
    };
    for (const kind of KINDS) expect(createPaperSource(kind, deps).kind).toBe(kind);
  });
});
