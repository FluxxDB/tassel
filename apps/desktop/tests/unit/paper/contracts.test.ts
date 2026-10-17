// Pins P3's cross-track contracts (Task 1). Tracks A, B and C build on these names and values, so
// a change here is a change to every track. The type checks run under `pnpm typecheck`.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CellMask,
  PaperSourceKind as ContractSourceKind,
  DetectorTrigger,
  NormRect,
  Pt,
  Quad,
  UploadStats,
} from '../../../src/renderer/src/paper/contracts';
import { DETECTOR_VERSION } from '../../../src/renderer/src/paper/contracts';
import type {
  CameraAccess,
  HelperStart,
  PaperBridge,
  PaperSourceKind,
} from '../../../src/shared/paper-bridge';
import { PAPER_IPC } from '../../../src/shared/paper-bridge';

describe('paper contracts', () => {
  it('sends detector version p3.1 with every upload', () => {
    expect(DETECTOR_VERSION).toBe('p3.1');
  });

  it('names the six paper IPC channels', () => {
    expect(PAPER_IPC).toEqual({
      getConfig: 'paper:getConfig',
      startHelper: 'paper:startHelper',
      stopHelper: 'paper:stopHelper',
      cameraAccess: 'paper:cameraAccess',
      requestCameraAccess: 'paper:requestCameraAccess',
      openCameraSettings: 'paper:openCameraSettings',
    });
  });

  it('keeps the shapes later tasks consume', () => {
    expectTypeOf<PaperSourceKind>().toEqualTypeOf<
      'deskview-helper' | 'window-capture' | 'fake-clip' | 'screen'
    >();
    expectTypeOf<ContractSourceKind>().toEqualTypeOf<PaperSourceKind>();
    expectTypeOf<CameraAccess>().toEqualTypeOf<
      'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
    >();
    expectTypeOf<HelperStart>().toEqualTypeOf<
      | { ok: true; url: string; token: string }
      | { ok: false; reason: 'unsupported' | 'missing-binary' | 'spawn-failed' | 'timeout' }
    >();
    expectTypeOf<keyof PaperBridge>().toEqualTypeOf<keyof typeof PAPER_IPC>();
    expectTypeOf<Quad>().toEqualTypeOf<[Pt, Pt, Pt, Pt]>();
    expectTypeOf<NormRect>().toEqualTypeOf<{ x: number; y: number; w: number; h: number }>();
    expectTypeOf<CellMask['cells']>().toEqualTypeOf<Array<[number, number]>>();
    expectTypeOf<DetectorTrigger['reason']>().toEqualTypeOf<'ink' | 'page'>();
    expectTypeOf<UploadStats['lastError']>().toEqualTypeOf<
      'offline' | 'server' | 'rejected' | 'gone' | 'auth' | null
    >();
  });
});
