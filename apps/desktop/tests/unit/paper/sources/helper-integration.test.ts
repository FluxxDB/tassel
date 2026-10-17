// The renderer's helper source against the real Swift helper, through Task 9's supervisor: a
// real spawn, a real ws://127.0.0.1 socket, protocol v1 end to end. The helper always plays a
// test clip (TASSEL_HELPER_CLIP, with requireFake), so it never touches a camera (ruling P3-R24).
// macOS only, and only once `node scripts/native.mjs build` has built the helper.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHelperSupervisor,
  type HelperSupervisor,
  helperToken,
} from '../../../../src/main/paper/helper-supervisor';
import { createPaperSource } from '../../../../src/renderer/src/paper/select-source';
import { PaperSourceError } from '../../../../src/renderer/src/paper/types';
import type { PaperBridge, PaperConfig } from '../../../../src/shared/paper-bridge';

const HELPER = fileURLToPath(
  new URL(
    '../../../../../../native/deskview-helper/.build/release/deskview-helper',
    import.meta.url,
  ),
);
const RUNS = process.platform === 'darwin' && existsSync(HELPER);
const CONFIG: PaperConfig = {
  source: 'deskview-helper',
  debug: false,
  helperClip: true,
  fakeClip: false,
  params: {},
};

/** A 16×12 grey JPEG (ImageIO, with EXIF and APP13 segments): a synthetic frame, not a camera's. */
const FRAME = Buffer.from(
  [
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBARXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAAB',
    'AAAAEKADAAQAAAABAAAADAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZ',
    'jwCyBOmACZjs+EJ+/8AACwgADAAQAQERAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIB',
    'AwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2',
    'Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1',
    'tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoOEg4O',
    'Dg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/dAAQAAv/aAAgBAQAAPwAor//Q',
    'KK//2Q==',
  ].join(''),
  'base64',
);

/** Node's WebSocket sends no Origin; the app's renderer, on app://tassel, sends this one. */
class AppSocket extends WebSocket {
  constructor(url: string | URL) {
    super(url, { headers: { Origin: 'app://tassel' } } as unknown as string[]);
  }
}

let dir = '';
let supervisor: HelperSupervisor;
let logs: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tassel-helper-it-'));
  const clip = join(dir, 'clip.mjpeg');
  writeFileSync(clip, Buffer.concat([FRAME, FRAME, FRAME]));
  logs = [];
  supervisor = createHelperSupervisor({
    path: HELPER,
    platform: 'darwin',
    clip,
    tag: 'tassel-helper-integration',
    requireFake: true,
    spawn,
    randomToken: helperToken,
    log: (line) => logs.push(line),
  });
});

afterEach(async () => {
  await supervisor.stop();
  rmSync(dir, { recursive: true, force: true });
});

function bridge(start: PaperBridge['startHelper'] = () => supervisor.start()): PaperBridge {
  return {
    getConfig: async () => CONFIG,
    startHelper: start,
    stopHelper: () => supervisor.stop(),
    cameraAccess: async () => 'granted',
    requestCameraAccess: async () => {
      throw new Error('a clip never needs camera access');
    },
    openCameraSettings: async () => {},
  };
}

function source(paper: PaperBridge, decoded: Buffer[]) {
  return createPaperSource('deskview-helper', {
    bridge: paper,
    config: CONFIG,
    mediaDevices: {} as MediaDevices,
    WebSocketCtor: AppSocket as unknown as typeof WebSocket,
    decodeImage: async (jpeg) => {
      decoded.push(Buffer.from(jpeg));
      return { width: 16, height: 12, close() {} } as unknown as ImageBitmap;
    },
    createFeed: () => ({ stream: {} as MediaStream, draw() {}, stop() {} }),
  });
}

describe.skipIf(!RUNS)('the helper source against the real helper, on a clip', () => {
  it('streams the clip’s frames, then stop ends the helper', async () => {
    const decoded: Buffer[] = [];
    const feed = await source(bridge(), decoded).start({ signal: new AbortController().signal });
    expect(feed.devices).toEqual([{ id: 'clip', name: 'Test clip', builtIn: true }]);
    // Each frame is the clip's JPEG, byte for byte, after the 24-byte header.
    expect(decoded[0]?.equals(FRAME)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(decoded.length).toBeGreaterThanOrEqual(4);

    feed.stop();
    await supervisor.stop();
    expect(logs).toContain('[deskview-helper] exiting: SIGTERM');
  }, 15_000);

  it('a wrong token is refused before any frame', async () => {
    const wrong = bridge(async () => {
      const started = await supervisor.start();
      return started.ok ? { ...started, token: helperToken() } : started;
    });
    const decoded: Buffer[] = [];
    const error = await source(wrong, decoded)
      .start({ signal: new AbortController().signal })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PaperSourceError);
    expect((error as PaperSourceError).code).toBe('error');
    expect(decoded).toHaveLength(0);
    expect(logs).toContain('[deskview-helper] closed a client that failed the handshake');
  }, 15_000);
});
