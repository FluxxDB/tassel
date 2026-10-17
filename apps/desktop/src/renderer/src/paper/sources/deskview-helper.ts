// The Desk View helper source: Electron starts the helper (window.tassel.paper), and this side
// talks protocol v1 over ws://127.0.0.1, turning its JPEG frames into a canvas stream.
import type { HelperStart } from '../../../../shared/paper-bridge';
import type { SourceDeps } from '../select-source';
import {
  type HelperDevice,
  type PaperFeed,
  type PaperSource,
  PaperSourceError,
  type PaperSourceErrorCode,
} from '../types';
import { createCanvasFeed } from './canvas-feed';
import {
  decodeFrame,
  type HelperCamera,
  type HelperErrorCode,
  type HelperFrame,
  helloMessage,
  parseServerMessage,
} from './helper-protocol';

/** The first frame must arrive within this, not counting a camera prompt. */
const FIRST_FRAME_MS = 8_000;
/**
 * A reconnect can meet the last client's slot before the helper has read its close (busy,
 * then close 4409): it tries again shortly, a few times.
 */
const BUSY_RETRY_MS = 250;
const BUSY_RETRIES = 3;
const BUSY_CLOSE = 4409;
const START = { fps: 15, maxWidth: 1920, quality: 0.85 } as const;
const OPEN = 1; // WebSocket.OPEN

type HelperDeps = Pick<
  SourceDeps,
  'bridge' | 'WebSocketCtor' | 'document' | 'decodeImage' | 'createFeed'
>;

export function createHelperSource(deps: HelperDeps): PaperSource {
  return {
    kind: 'deskview-helper',
    async start({ deviceId = null, signal }) {
      if (signal.aborted) throw new PaperSourceError('aborted');
      const started = await deps.bridge.startHelper();
      if (signal.aborted) {
        if (started.ok) void deps.bridge.stopHelper();
        throw new PaperSourceError('aborted');
      }
      if (!started.ok) {
        throw new PaperSourceError(
          'unavailable',
          `the Desk View helper didn't start: ${started.reason}`,
        );
      }
      return stream(deps, started, deviceId, signal);
    },
  };
}

function decodeJpeg(jpeg: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
}

/**
 * One helper connection: hello, then (camera access permitting) list and start, until the first
 * frame resolves the feed. Every failure, and an abort, releases everything: the socket, the
 * canvas, and the helper itself, so a later openDeskViewSetup never meets `busy`.
 */
function stream(
  deps: HelperDeps,
  started: Extract<HelperStart, { ok: true }>,
  deviceId: string | null,
  signal: AbortSignal,
): Promise<PaperFeed> {
  const WebSocketCtor = deps.WebSocketCtor ?? globalThis.WebSocket;
  const decodeImage = deps.decodeImage ?? decodeJpeg;
  const canvas = (deps.createFeed ?? createCanvasFeed)(deps.document);

  return new Promise<PaperFeed>((resolve, reject) => {
    let socket: WebSocket | null = null;
    let settled = false; // the start resolved or failed
    let released = false;
    let live = false;
    let welcomed = false;
    let devices: HelperDevice[] = [];
    let busyRetries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let decoding = false;
    let queued: HelperFrame | null = null;
    const listeners = new Set<(reason: 'lost' | 'ended') => void>();

    const send = (message: Record<string, unknown>) => {
      if (socket?.readyState === OPEN) socket.send(JSON.stringify(message));
    };
    const detach = (closing: WebSocket) => {
      closing.onopen = closing.onmessage = closing.onclose = closing.onerror = null;
      closing.close();
    };
    const release = () => {
      if (released) return;
      released = true;
      clearDeadline();
      if (retryTimer) clearTimeout(retryTimer);
      signal.removeEventListener('abort', onAbort);
      if (socket) detach(socket);
      canvas.stop();
      void deps.bridge.stopHelper();
    };
    const fail = (code: PaperSourceErrorCode, message?: string) => {
      if (settled) return;
      settled = true;
      release();
      reject(new PaperSourceError(code, message));
    };
    /** After it went live: the camera went away, or the helper did. */
    const lose = () => {
      if (released) return;
      release();
      for (const listener of [...listeners]) listener('lost');
    };
    const onAbort = () => fail('aborted');
    const armDeadline = () => {
      clearDeadline();
      deadline = setTimeout(
        () => fail('error', 'no frame from the Desk View helper in 8 s'),
        FIRST_FRAME_MS,
      );
    };
    function clearDeadline() {
      if (deadline) clearTimeout(deadline);
      deadline = null;
    }

    const feed: PaperFeed = {
      kind: 'deskview-helper',
      stream: canvas.stream,
      contentRect: null,
      devices,
      onEnd(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      stop() {
        if (released) return;
        send({ type: 'stop' });
        release();
      },
    };

    const onWelcome = async (camera: HelperCamera) => {
      welcomed = true;
      if (camera === 'denied' || camera === 'restricted') {
        return fail('denied', `camera access is ${camera}`);
      }
      if (camera === 'notDetermined') {
        // macOS asks her now: however long she takes isn't the helper's delay.
        clearDeadline();
        const granted = await deps.bridge.requestCameraAccess();
        if (settled) return;
        if (!granted) return fail('denied', 'camera access was refused');
        armDeadline();
      }
      send({ type: 'list' });
      send({ type: 'start', deviceId, ...START });
    };

    const onError = (code: HelperErrorCode, message: string) => {
      if (live) {
        if (code === 'device-lost') lose();
        return;
      }
      if (code === 'permission-denied') return fail('denied', message);
      if (code === 'no-device') return fail('unavailable', message);
      if (code === 'busy' && !welcomed) return retryBusy();
      fail('error', `${code}: ${message}`);
    };

    const onText = async (text: string) => {
      const message = parseServerMessage(text);
      if (message?.type === 'welcome') await onWelcome(message.camera);
      else if (message?.type === 'devices') devices = message.devices;
      else if (message?.type === 'error') onError(message.code, message.message);
    };

    const onClose = (code: number) => {
      if (live) return lose();
      if (code === BUSY_CLOSE && !welcomed) return retryBusy();
      fail('error', `the Desk View helper closed the connection (${code})`);
    };

    const retryBusy = () => {
      if (settled || retryTimer) return;
      if (socket) detach(socket);
      socket = null;
      if (busyRetries >= BUSY_RETRIES) return fail('error', 'the Desk View helper is busy');
      busyRetries += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!settled) connect();
      }, BUSY_RETRY_MS);
    };

    /** The newest frame wins: one decodes at a time, and later ones replace the queued one. */
    const onFrame = (buffer: ArrayBuffer) => {
      let frame: HelperFrame;
      try {
        frame = decodeFrame(buffer);
      } catch {
        return; // not a frame: skip it
      }
      if (decoding) {
        queued = frame;
        return;
      }
      void draw(frame);
    };

    const draw = async (frame: HelperFrame) => {
      decoding = true;
      try {
        const bitmap = await decodeImage(frame.jpeg);
        if (released) {
          bitmap.close();
          return;
        }
        canvas.draw(bitmap);
        if (!settled) {
          settled = true;
          live = true;
          clearDeadline();
          signal.removeEventListener('abort', onAbort);
          resolve({ ...feed, devices });
        }
      } catch {
        // A JPEG that won't decode: skip it; the next comes in 1/15 s.
      } finally {
        decoding = false;
        const next = queued;
        queued = null;
        if (next && !released) void draw(next);
      }
    };

    const connect = () => {
      const current = new WebSocketCtor(started.url);
      socket = current;
      current.binaryType = 'arraybuffer';
      current.onopen = () => current.send(helloMessage(started.token));
      current.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          onText(event.data).catch((error: unknown) => fail('error', String(error)));
        } else if (event.data instanceof ArrayBuffer) {
          onFrame(event.data);
        }
      };
      current.onclose = (event: CloseEvent) => onClose(event.code);
      current.onerror = () => {}; // a close follows
    };

    signal.addEventListener('abort', onAbort, { once: true });
    armDeadline();
    connect();
  });
}
