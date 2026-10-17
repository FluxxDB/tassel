import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaperSource } from '../../../../src/renderer/src/paper/select-source';
import { openDeskViewSetup } from '../../../../src/renderer/src/paper/sources/helper-protocol';
import { type PaperFeed, PaperSourceError } from '../../../../src/renderer/src/paper/types';
import type { HelperStart, PaperBridge, PaperConfig } from '../../../../src/shared/paper-bridge';

const TOKEN = 'ab'.repeat(32);
const URL = 'ws://127.0.0.1:54321';
const CONFIG: PaperConfig = {
  source: 'auto',
  debug: false,
  helperClip: false,
  fakeClip: false,
  params: {},
};
const DEVICES = [
  { id: 'mac-desk', name: 'MacBook Pro Desk View Camera', builtIn: true },
  { id: 'phone-desk', name: 'iPhone Desk View Camera', builtIn: false },
];

/** A WebSocket the test drives: the helper's side of the conversation. */
class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = 'blob';
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  // The helper's side:
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  text(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  welcome(camera = 'authorized'): void {
    this.text({ type: 'welcome', protocol: 1, helperVersion: '0.1.0', camera });
  }
  error(code: string): void {
    this.text({ type: 'error', code, message: `${code} happened` });
  }
  frame(seq = 0, jpeg = [0xff, 0xd8, seq & 0xff, 0xff, 0xd9]): void {
    const bytes = new Uint8Array(24 + jpeg.length);
    const view = new DataView(bytes.buffer);
    bytes.set([0x54, 0x53, 0x4c, 0x46]);
    view.setUint16(4, 1);
    view.setUint16(6, 1);
    view.setUint32(8, seq);
    view.setBigUint64(12, BigInt(seq * 66_666));
    view.setUint16(20, 1920);
    view.setUint16(22, 1440);
    bytes.set(jpeg, 24);
    this.onmessage?.({ data: bytes.buffer });
  }
  serverClose(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  /** Everything up to the first frame: open, welcome, the devices, running, a frame. */
  goLive(): void {
    this.open();
    this.welcome();
    this.text({ type: 'devices', devices: DEVICES });
    this.text({ type: 'status', state: 'starting', width: 0, height: 0, fps: 15 });
    this.text({ type: 'status', state: 'running', width: 1920, height: 1440, fps: 15 });
    this.frame(0);
  }
}

const STREAM = { id: 'canvas-stream' } as unknown as MediaStream;

function setup(start: HelperStart = { ok: true, url: URL, token: TOKEN }) {
  const bridge = {
    getConfig: vi.fn(async () => CONFIG),
    startHelper: vi.fn(async () => start),
    stopHelper: vi.fn(async () => {}),
    cameraAccess: vi.fn(async () => 'granted' as const),
    requestCameraAccess: vi.fn(async () => true),
    openCameraSettings: vi.fn(async () => {}),
  } satisfies PaperBridge;
  const feed = { stream: STREAM, draw: vi.fn(), stop: vi.fn() };
  const decodeImage = vi.fn(async (jpeg: Uint8Array) => {
    return { width: 1920, height: 1440, close: vi.fn(), jpeg: [...jpeg] } as unknown as ImageBitmap;
  });
  const createFeed = vi.fn(() => feed);
  const source = createPaperSource('deskview-helper', {
    bridge,
    config: CONFIG,
    mediaDevices: {} as MediaDevices,
    WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
    decodeImage,
    createFeed,
  });
  const controller = new AbortController();
  return { bridge, feed, decodeImage, createFeed, source, controller };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function begin(env = setup(), deviceId: string | null = 'mac-desk') {
  const started = env.source.start({ deviceId, signal: env.controller.signal });
  // Rejections are asserted later; keep them from being reported as unhandled meanwhile.
  started.catch(() => {});
  await flush();
  const socket = FakeSocket.all.at(-1);
  return { ...env, started, socket };
}

/** The PaperSourceError code a start rejected with. */
async function failure(started: Promise<PaperFeed>): Promise<string> {
  try {
    await started;
  } catch (error) {
    if (error instanceof PaperSourceError) return error.code;
    throw error;
  }
  throw new Error('the start resolved');
}

beforeEach(() => {
  FakeSocket.all = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Desk View helper source', () => {
  it('sends hello with the token first, then list and start with fps 15', async () => {
    const { socket, bridge } = await begin();
    expect(bridge.startHelper).toHaveBeenCalledTimes(1);
    expect(socket?.url).toBe(URL);
    expect(socket?.binaryType).toBe('arraybuffer');
    socket?.open();
    expect(socket?.sent).toEqual([{ type: 'hello', token: TOKEN, protocol: 1 }]);
    socket?.welcome();
    expect(socket?.sent).toEqual([
      { type: 'hello', token: TOKEN, protocol: 1 },
      { type: 'list' },
      { type: 'start', deviceId: 'mac-desk', fps: 15, maxWidth: 1920, quality: 0.85 },
    ]);
  });

  it('resolves after the first binary frame with the helper’s devices', async () => {
    const { socket, started, decodeImage, feed } = await begin();
    let resolved = false;
    void started.then(() => {
      resolved = true;
    });
    socket?.open();
    socket?.welcome();
    socket?.text({ type: 'devices', devices: DEVICES });
    socket?.text({ type: 'status', state: 'running', width: 1920, height: 1440, fps: 15 });
    await flush();
    expect(resolved).toBe(false);
    socket?.frame(0);
    const live = await started;
    expect(live).toMatchObject({
      kind: 'deskview-helper',
      stream: STREAM,
      contentRect: null,
      devices: DEVICES,
    });
    // The JPEG after the 24-byte header goes to the decoder, and its bitmap into the feed.
    expect(decodeImage.mock.calls[0]?.[0]).toEqual(new Uint8Array([0xff, 0xd8, 0, 0xff, 0xd9]));
    expect(feed.draw).toHaveBeenCalledTimes(1);
  });

  it('starts on the default device when none is chosen', async () => {
    const { socket } = await begin(setup(), null);
    socket?.open();
    socket?.welcome();
    expect(socket?.sent.at(-1)).toEqual({
      type: 'start',
      deviceId: null,
      fps: 15,
      maxWidth: 1920,
      quality: 0.85,
    });
  });

  it('welcome notDetermined asks for access once, and a refusal gives denied', async () => {
    const refused = setup();
    refused.bridge.requestCameraAccess.mockResolvedValue(false);
    const run = await begin(refused);
    run.socket?.open();
    run.socket?.welcome('notDetermined');
    expect(await failure(run.started)).toBe('denied');
    expect(refused.bridge.requestCameraAccess).toHaveBeenCalledTimes(1);
    expect(run.socket?.sent.map((message) => message.type)).toEqual(['hello']);

    // Granted, it carries on to list and start.
    const granted = await begin();
    granted.socket?.open();
    granted.socket?.welcome('notDetermined');
    await flush();
    expect(granted.bridge.requestCameraAccess).toHaveBeenCalledTimes(1);
    expect(granted.socket?.sent.map((message) => message.type)).toEqual(['hello', 'list', 'start']);
  });

  it('welcome with the camera denied or restricted gives denied, without asking', async () => {
    for (const camera of ['denied', 'restricted']) {
      const run = await begin();
      run.socket?.open();
      run.socket?.welcome(camera);
      expect(await failure(run.started)).toBe('denied');
      expect(run.bridge.requestCameraAccess).not.toHaveBeenCalled();
    }
  });

  it('permission-denied → denied; no-device → unavailable; close before the first frame → error', async () => {
    const denied = await begin();
    denied.socket?.open();
    denied.socket?.welcome();
    denied.socket?.error('permission-denied');
    expect(await failure(denied.started)).toBe('denied');

    const noDevice = await begin();
    noDevice.socket?.open();
    noDevice.socket?.welcome();
    noDevice.socket?.error('no-device');
    expect(await failure(noDevice.started)).toBe('unavailable');

    const closed = await begin();
    closed.socket?.open();
    closed.socket?.welcome();
    closed.socket?.serverClose(1006);
    expect(await failure(closed.started)).toBe('error');

    // The handshake refused (a wrong token, say): closed before any frame.
    const refused = await begin();
    refused.socket?.open();
    refused.socket?.serverClose(4401);
    expect(await failure(refused.started)).toBe('error');
  });

  it('close after live ends the feed with lost', async () => {
    const { socket, started, bridge } = await begin();
    socket?.goLive();
    const feed = await started;
    const ended = vi.fn();
    feed.onEnd(ended);
    socket?.serverClose(1006);
    expect(ended).toHaveBeenCalledExactlyOnceWith('lost');
    // Everything is released, so Retry starts a fresh helper.
    expect(bridge.stopHelper).toHaveBeenCalledTimes(1);
  });

  it('error device-lost after live ends the feed with lost', async () => {
    const { socket, started, bridge } = await begin();
    socket?.goLive();
    const feed = await started;
    const ended = vi.fn();
    const unsubscribed = vi.fn();
    feed.onEnd(ended);
    feed.onEnd(unsubscribed)();
    socket?.error('device-lost');
    socket?.serverClose(1000);
    expect(ended).toHaveBeenCalledExactlyOnceWith('lost');
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(socket?.closed).toBe(true);
    expect(bridge.stopHelper).toHaveBeenCalledTimes(1);
  });

  it('every start failure closes the socket and stops the helper', async () => {
    const failures: Array<(socket: FakeSocket) => void> = [
      (socket) => {
        socket.open();
        socket.welcome('denied');
      },
      (socket) => {
        socket.open();
        socket.welcome();
        socket.error('no-device');
      },
      (socket) => {
        socket.open();
        socket.welcome();
        socket.error('internal');
      },
      (socket) => {
        socket.open();
        socket.serverClose(4401);
      },
    ];
    for (const fail of failures) {
      const run = await begin();
      if (!run.socket) throw new Error('no socket');
      fail(run.socket);
      await failure(run.started);
      expect(run.socket.closed).toBe(true);
      expect(run.bridge.stopHelper).toHaveBeenCalledTimes(1);
      expect(run.feed.stop).toHaveBeenCalled();
    }
  });

  it('an aborted start closes the socket, stops the helper and rejects with aborted', async () => {
    const run = await begin();
    run.socket?.open();
    run.socket?.welcome();
    run.controller.abort();
    expect(await failure(run.started)).toBe('aborted');
    expect(run.socket?.closed).toBe(true);
    expect(run.bridge.stopHelper).toHaveBeenCalledTimes(1);
    // A frame that arrives anyway is ignored.
    run.socket?.frame(0);
    expect(run.feed.draw).not.toHaveBeenCalled();
  });

  it('an abort while the helper starts stops it once it is up, and opens no socket', async () => {
    const env = setup();
    let release: (start: HelperStart) => void = () => {};
    env.bridge.startHelper.mockImplementation(
      () =>
        new Promise<HelperStart>((resolve) => {
          release = resolve;
        }),
    );
    const started = env.source.start({ deviceId: null, signal: env.controller.signal });
    started.catch(() => {});
    env.controller.abort();
    release({ ok: true, url: URL, token: TOKEN });
    expect(await failure(started)).toBe('aborted');
    expect(env.bridge.stopHelper).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('an aborted signal starts nothing', async () => {
    const env = setup();
    env.controller.abort();
    expect(await failure(env.source.start({ signal: env.controller.signal }))).toBe('aborted');
    expect(env.bridge.startHelper).not.toHaveBeenCalled();
  });

  it('stop sends stop, closes the socket and stops the helper', async () => {
    const { socket, started, bridge, feed: canvas } = await begin();
    socket?.goLive();
    const feed = await started;
    const ended = vi.fn();
    feed.onEnd(ended);
    feed.stop();
    expect(socket?.sent.at(-1)).toEqual({ type: 'stop' });
    expect(socket?.closed).toBe(true);
    expect(bridge.stopHelper).toHaveBeenCalledTimes(1);
    expect(canvas.stop).toHaveBeenCalled();
    // Our own close isn't a loss, and stop is idempotent.
    socket?.serverClose(1000);
    feed.stop();
    expect(ended).not.toHaveBeenCalled();
    expect(bridge.stopHelper).toHaveBeenCalledTimes(1);
  });

  it('startHelper not ok → unavailable', async () => {
    for (const reason of ['unsupported', 'missing-binary', 'spawn-failed', 'timeout'] as const) {
      const env = setup({ ok: false, reason });
      expect(await failure(env.source.start({ signal: env.controller.signal }))).toBe(
        'unavailable',
      );
      expect(FakeSocket.all).toHaveLength(0);
    }
  });

  it('no frame within 8 s is an error', async () => {
    vi.useFakeTimers();
    const run = setup();
    const started = run.source.start({ signal: run.controller.signal });
    started.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.all.at(-1);
    socket?.open();
    socket?.welcome();
    await vi.advanceTimersByTimeAsync(7_999);
    expect(socket?.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await failure(started)).toBe('error');
    expect(socket?.closed).toBe(true);
    expect(run.bridge.stopHelper).toHaveBeenCalledTimes(1);
  });

  it('the 8 s wait doesn’t count the time macOS takes to ask about the camera', async () => {
    vi.useFakeTimers();
    const run = setup();
    let answer: (granted: boolean) => void = () => {};
    run.bridge.requestCameraAccess.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const started = run.source.start({ signal: run.controller.signal });
    started.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.all.at(-1);
    socket?.open();
    socket?.welcome('notDetermined');
    // She takes 20 s to decide.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket?.closed).toBe(false);
    answer(true);
    await vi.advanceTimersByTimeAsync(0);
    socket?.frame(0);
    await vi.advanceTimersByTimeAsync(0);
    await expect(started).resolves.toMatchObject({ kind: 'deskview-helper' });
  });

  it('newer frames replace older ones while a decode is in flight', async () => {
    const run = setup();
    const pending: Array<(bitmap: ImageBitmap) => void> = [];
    run.decodeImage.mockImplementation(
      (jpeg: Uint8Array) =>
        new Promise<ImageBitmap>((resolve) => {
          pending.push(() =>
            resolve({ width: 1920, height: 1440, close: vi.fn(), seq: jpeg[2] } as never),
          );
        }),
    );
    const { socket, started } = await begin(run);
    socket?.open();
    socket?.welcome();
    socket?.frame(1);
    socket?.frame(2);
    socket?.frame(3);
    expect(run.decodeImage).toHaveBeenCalledTimes(1);
    pending[0]?.({} as ImageBitmap);
    await started;
    await flush();
    // Frame 2 was replaced by 3 while 1 decoded.
    expect(run.decodeImage).toHaveBeenCalledTimes(2);
    expect(run.decodeImage.mock.calls.map(([jpeg]) => jpeg[2])).toEqual([1, 3]);
    pending[1]?.({} as ImageBitmap);
    await flush();
    expect(run.feed.draw).toHaveBeenCalledTimes(2);
  });

  it('an early busy retries shortly, then connects', async () => {
    // A reconnect can meet the last client's slot before the helper has seen it close.
    const run = await begin();
    run.socket?.open();
    run.socket?.error('busy');
    run.socket?.serverClose(4409);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(FakeSocket.all).toHaveLength(2);
    const second = FakeSocket.all[1];
    second?.goLive();
    await expect(run.started).resolves.toMatchObject({ kind: 'deskview-helper' });
    expect(run.socket?.closed).toBe(true);
    expect(run.bridge.stopHelper).not.toHaveBeenCalled();
  });

  it('busy that persists is an error', async () => {
    vi.useFakeTimers();
    const run = setup();
    const started = run.source.start({ signal: run.controller.signal });
    started.catch(() => {});
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await vi.advanceTimersByTimeAsync(300);
      const socket = FakeSocket.all.at(-1);
      socket?.open();
      socket?.serverClose(4409);
    }
    expect(await failure(started)).toBe('error');
    expect(FakeSocket.all).toHaveLength(4);
    expect(run.bridge.stopHelper).toHaveBeenCalledTimes(1);
  });
});

describe('openDeskViewSetup', () => {
  function setupFor(answer: Record<string, unknown> | 'close') {
    const bridge = {
      getConfig: vi.fn(),
      startHelper: vi.fn(async (): Promise<HelperStart> => ({ ok: true, url: URL, token: TOKEN })),
      stopHelper: vi.fn(async () => {}),
      cameraAccess: vi.fn(),
      requestCameraAccess: vi.fn(),
      openCameraSettings: vi.fn(),
    };
    const result = openDeskViewSetup({
      bridge: bridge as unknown as PaperBridge,
      WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
    });
    return { bridge, result, answer };
  }

  async function run(answer: Record<string, unknown> | 'close') {
    const env = setupFor(answer);
    await flush();
    const socket = FakeSocket.all.at(-1);
    socket?.open();
    socket?.welcome();
    if (answer === 'close') socket?.serverClose(1006);
    else socket?.text(answer);
    return { ...env, socket, outcome: await env.result };
  }

  it('asks the helper to present Desk View, then stops it', async () => {
    const { socket, bridge, outcome } = await run({ type: 'setup', result: 'presented' });
    expect(outcome).toBe('presented');
    expect(socket?.sent).toEqual([
      { type: 'hello', token: TOKEN, protocol: 1 },
      { type: 'openSetup' },
    ]);
    expect(socket?.closed).toBe(true);
    expect(bridge.stopHelper).toHaveBeenCalledTimes(1);
  });

  it('is failed when the helper fails, closes or can’t start', async () => {
    expect((await run({ type: 'setup', result: 'failed', message: 'nope' })).outcome).toBe(
      'failed',
    );
    expect((await run('close')).outcome).toBe('failed');
    const bridge = {
      startHelper: vi.fn(async (): Promise<HelperStart> => ({ ok: false, reason: 'unsupported' })),
      stopHelper: vi.fn(async () => {}),
    };
    const outcome = await openDeskViewSetup({
      bridge: bridge as unknown as PaperBridge,
      WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
    });
    expect(outcome).toBe('failed');
  });
});
