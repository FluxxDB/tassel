// The TypeScript side of the Desk View helper's protocol v1 (native/deskview-helper,
// DeskViewCore). Text messages are JSON with a `type`; frames are binary: a 24-byte big-endian
// header, then one JPEG.
import type { PaperBridge } from '../../../../shared/paper-bridge';
import type { HelperDevice } from '../types';

export const HELPER_PROTOCOL = 1;
export const FRAME_HEADER_SIZE = 24;
const MAGIC = [0x54, 0x53, 0x4c, 0x46]; // TSLF

export interface HelperFrame {
  seq: number;
  ptsMicros: number;
  width: number;
  height: number;
  jpeg: Uint8Array<ArrayBuffer>;
}

/**
 * Reads a frame message: magic TSLF, version 1, flags, seq u32, ptsMicros u64, width and height
 * u16, then the JPEG (a view, not a copy). Throws on a short buffer, wrong magic or another
 * version; flags are left alone.
 */
export function decodeFrame(buffer: ArrayBuffer): HelperFrame {
  if (buffer.byteLength < FRAME_HEADER_SIZE)
    throw new Error('A helper frame is shorter than its header');
  const view = new DataView(buffer);
  if (MAGIC.some((byte, index) => view.getUint8(index) !== byte)) {
    throw new Error('A helper frame has the wrong magic');
  }
  if (view.getUint16(4) !== HELPER_PROTOCOL) throw new Error('A helper frame has another version');
  return {
    seq: view.getUint32(8),
    ptsMicros: Number(view.getBigUint64(12)),
    width: view.getUint16(20),
    height: view.getUint16(22),
    jpeg: new Uint8Array(buffer, FRAME_HEADER_SIZE),
  };
}

export type HelperCamera = 'authorized' | 'denied' | 'restricted' | 'notDetermined';
export type HelperErrorCode =
  | 'auth'
  | 'permission-denied'
  | 'no-device'
  | 'device-lost'
  | 'busy'
  | 'bad-request'
  | 'internal';

export type HelperServerMessage =
  | { type: 'welcome'; protocol: number; helperVersion: string; camera: HelperCamera }
  | { type: 'devices'; devices: HelperDevice[] }
  | {
      type: 'status';
      state: 'starting' | 'running' | 'stopped';
      width: number;
      height: number;
      fps: number;
    }
  | { type: 'error'; code: HelperErrorCode; message: string }
  | { type: 'setup'; result: 'presented' | 'failed'; message?: string };

const CAMERAS: readonly string[] = ['authorized', 'denied', 'restricted', 'notDetermined'];
const ERROR_CODES: readonly string[] = [
  'auth',
  'permission-denied',
  'no-device',
  'device-lost',
  'busy',
  'bad-request',
  'internal',
];
const STATES: readonly string[] = ['starting', 'running', 'stopped'];

/** One text message from the helper, checked; null when it isn't one the protocol has. */
export function parseServerMessage(text: string): HelperServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'welcome': {
      const { protocol, helperVersion, camera } = message;
      if (typeof protocol !== 'number' || typeof helperVersion !== 'string') return null;
      if (typeof camera !== 'string' || !CAMERAS.includes(camera)) return null;
      return { type: 'welcome', protocol, helperVersion, camera: camera as HelperCamera };
    }
    case 'devices': {
      const { devices } = message;
      if (!Array.isArray(devices) || !devices.every(isDevice)) return null;
      return {
        type: 'devices',
        devices: devices.map(({ id, name, builtIn }) => ({ id, name, builtIn })),
      };
    }
    case 'status': {
      const { state, width, height, fps } = message;
      if (typeof state !== 'string' || !STATES.includes(state)) return null;
      if (![width, height, fps].every((n) => typeof n === 'number')) return null;
      return {
        type: 'status',
        state: state as 'starting' | 'running' | 'stopped',
        width: width as number,
        height: height as number,
        fps: fps as number,
      };
    }
    case 'error': {
      const { code, message: text } = message;
      if (typeof code !== 'string' || !ERROR_CODES.includes(code) || typeof text !== 'string')
        return null;
      return { type: 'error', code: code as HelperErrorCode, message: text };
    }
    case 'setup': {
      const { result, message: text } = message;
      if (result !== 'presented' && result !== 'failed') return null;
      if (text !== undefined && typeof text !== 'string') return null;
      return text === undefined
        ? { type: 'setup', result }
        : { type: 'setup', result, message: text };
    }
    default:
      return null;
  }
}

function isDevice(value: unknown): value is HelperDevice {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, builtIn } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof name === 'string' && typeof builtIn === 'boolean';
}

/** The hello every client sends first, within 2 s, or the helper closes with 4401. */
export function helloMessage(token: string): string {
  return JSON.stringify({ type: 'hello', token, protocol: HELPER_PROTOCOL });
}

const SETUP_TIMEOUT_MS = 15_000;

/**
 * Asks the helper to present Desk View's own app (to turn Desk View on, or frame the desk), then
 * stops the helper. Call it while no paper source holds the helper, or it meets `busy`.
 */
export async function openDeskViewSetup(deps: {
  bridge: PaperBridge;
  WebSocketCtor: typeof WebSocket;
}): Promise<'presented' | 'failed'> {
  const started = await deps.bridge.startHelper();
  if (!started.ok) return 'failed';
  return new Promise((resolve) => {
    const socket = new deps.WebSocketCtor(started.url);
    let done = false;
    const finish = (result: 'presented' | 'failed') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      void deps.bridge.stopHelper();
      resolve(result);
    };
    const timer = setTimeout(() => finish('failed'), SETUP_TIMEOUT_MS);
    socket.onopen = () => socket.send(helloMessage(started.token));
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (message?.type === 'welcome') socket.send(JSON.stringify({ type: 'openSetup' }));
      else if (message?.type === 'setup') finish(message.result);
      else if (message?.type === 'error') finish('failed');
    };
    socket.onclose = () => finish('failed');
  });
}
