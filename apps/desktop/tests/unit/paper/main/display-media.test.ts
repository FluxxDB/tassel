import type { DesktopCapturerSource, Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerDisplayMedia } from '../../../../src/main/paper/display-media';

vi.mock('electron', () => ({}));

type Callback = (streams: unknown) => void;
type Handler = (request: unknown, callback: Callback) => unknown;

/** The requesting frame, a WebFrameMain in Electron. */
const FRAME = { url: 'app://tassel/index.html' };
const SCREEN_1 = { id: 'screen:1:0', name: 'Screen 1' } as DesktopCapturerSource;
const SCREEN_2 = { id: 'screen:2:0', name: 'Screen 2' } as DesktopCapturerSource;

interface Options {
  platform?: NodeJS.Platform;
  macosMajor?: number | null;
  fakeDisplay?: 'self' | null;
  requireFake?: boolean;
  sources?: DesktopCapturerSource[] | Error;
  trusted?: boolean;
}

/** Registers the handler on a fake session; returns it, its options and the capturer. */
function register(options: Options = {}) {
  let handler: Handler | null = null;
  let handlerOptions: unknown;
  const session = {
    setDisplayMediaRequestHandler: vi.fn((h: Handler, opts?: unknown) => {
      handler = h;
      handlerOptions = opts;
    }),
  };
  const sources = options.sources ?? [SCREEN_1, SCREEN_2];
  const getSources = vi.fn(async () => {
    if (sources instanceof Error) throw sources;
    return sources;
  });
  registerDisplayMedia(session as unknown as Session, {
    platform: options.platform ?? 'darwin',
    macosMajor: options.macosMajor === undefined ? 26 : options.macosMajor,
    fakeDisplay: options.fakeDisplay ?? null,
    requireFake: options.requireFake ?? false,
    getSources,
    isTrusted: (url) => (options.trusted ?? true) && url.startsWith('app://tassel'),
  });
  if (!handler) throw new Error('no handler registered');
  return { handler: handler as Handler, handlerOptions, getSources };
}

/** What the handler answers for a request from `origin` with `frame`. */
function answer(handler: Handler, request: { frame?: unknown; securityOrigin?: string } = {}) {
  return new Promise<unknown>((resolve) => {
    void handler(
      {
        frame: 'frame' in request ? request.frame : FRAME,
        securityOrigin: request.securityOrigin ?? 'app://tassel',
        videoRequested: true,
        audioRequested: false,
        userGesture: true,
      },
      resolve,
    );
  });
}

describe('registerDisplayMedia', () => {
  it('the self fake answers with request.frame', async () => {
    const { handler, handlerOptions } = register({ fakeDisplay: 'self' });
    expect(await answer(handler)).toEqual({ video: FRAME });
    // No system picker, which would show instead of the fake.
    expect(handlerOptions).toBeUndefined();
  });

  it('a null frame denies with callback(null)', async () => {
    const { handler } = register({ fakeDisplay: 'self' });
    expect(await answer(handler, { frame: null })).toBeNull();
  });

  it('an untrusted securityOrigin is denied', async () => {
    for (const options of [
      { fakeDisplay: 'self' as const },
      { platform: 'win32' as const, macosMajor: null },
      { macosMajor: 26 },
    ]) {
      const { handler, getSources } = register(options);
      expect(await answer(handler, { securityOrigin: 'https://example.com' })).toBeNull();
      expect(getSources).not.toHaveBeenCalled();
    }
  });

  it('requireFake without self denies', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { handler, handlerOptions, getSources } = register({ platform, requireFake: true });
      expect(await answer(handler)).toBeNull();
      expect(getSources).not.toHaveBeenCalled();
      // Not even the system picker: it could capture a real screen.
      expect(handlerOptions).toBeUndefined();
    }
  });

  it('darwin 15 sets useSystemPicker true', async () => {
    const { handler, handlerOptions, getSources } = register({ macosMajor: 15 });
    expect(handlerOptions).toEqual({ useSystemPicker: true });
    // The picker answers instead; should the handler run anyway, it denies.
    expect(await answer(handler)).toBeNull();
    expect(getSources).not.toHaveBeenCalled();
    expect(register({ macosMajor: 26 }).handlerOptions).toEqual({ useSystemPicker: true });
  });

  it('darwin 14 denies', async () => {
    const { handler, handlerOptions, getSources } = register({ macosMajor: 14 });
    expect(handlerOptions).toBeUndefined();
    expect(await answer(handler)).toBeNull();
    expect(getSources).not.toHaveBeenCalled();
  });

  it('win32 grants the first screen', async () => {
    const { handler, handlerOptions, getSources } = register({
      platform: 'win32',
      macosMajor: null,
    });
    expect(handlerOptions).toBeUndefined();
    expect(await answer(handler)).toEqual({ video: SCREEN_1 });
    expect(getSources).toHaveBeenCalledWith({ types: ['screen'] });
  });

  it('a callback that throws (its frame is gone) is logged, not left unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = register({ fakeDisplay: 'self' });
    let calls = 0;
    void handler(
      {
        frame: FRAME,
        securityOrigin: 'app://tassel',
        videoRequested: true,
        audioRequested: false,
        userGesture: true,
      },
      () => {
        calls += 1;
        throw new Error('Render frame was disposed');
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('no sources denies with callback(null)', async () => {
    const empty = register({ platform: 'win32', macosMajor: null, sources: [] });
    expect(await answer(empty.handler)).toBeNull();
    const failing = register({ platform: 'win32', macosMajor: null, sources: new Error('busy') });
    expect(await answer(failing.handler)).toBeNull();
  });
});
