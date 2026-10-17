// The change-detector worker: reads the camera's VideoFrames from the stream the window hands
// over, and runs the frame loop with OffscreenCanvas, OpenCV.js and postMessage. Type-checked by
// tsconfig.worker.json (the WebWorker lib), never by the window's program.

import type { NormRect, Quad } from '../contracts';
import { createDetector } from './detector';
import { createFrameLoop } from './frame-loop';
import type { FromWorker, ToWorker } from './messages';
import { type Cv, findPageQuad, loadOpenCv, warpGray, warpRgba } from './opencv-page';
import { DEFAULT_PARAMS, parseParams } from './params';

declare const self: DedicatedWorkerGlobalScope;

const FULL: NormRect = { x: 0, y: 0, w: 1, h: 1 };
const JPEG_QUALITY = 0.9;

let cv: Cv = null;
// Loading starts at once: the 13 MB module and its WebAssembly take a moment, and the frame loop
// posts motion-only stats meanwhile.
const opencv: Promise<boolean> = loadOpenCv().then(
  (loaded) => {
    cv = loaded;
    return true;
  },
  (error: unknown) => {
    console.error('[paper-detector] OpenCV failed to load', error);
    return false;
  },
);

const post = (message: FromWorker) => self.postMessage(message);

const canvases = new Map<string, OffscreenCanvas>();
function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const key = `${width}x${height}`;
  let canvas = canvases.get(key);
  if (!canvas) {
    canvas = new OffscreenCanvas(width, height);
    canvases.set(key, canvas);
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D context for an OffscreenCanvas');
  return ctx;
}

/** Draws the frame's `crop` (0–1 of the frame) into a width × height canvas. */
function draw(frame: VideoFrame, width: number, height: number, crop: NormRect | null) {
  const r = crop ?? FULL;
  const ctx = context(width, height);
  ctx.drawImage(
    frame,
    r.x * frame.displayWidth,
    r.y * frame.displayHeight,
    r.w * frame.displayWidth,
    r.h * frame.displayHeight,
    0,
    0,
    width,
    height,
  );
  return ctx;
}

function readRgba(frame: VideoFrame, width: number, height: number, crop: NormRect | null) {
  return draw(frame, width, height, crop).getImageData(0, 0, width, height).data;
}

async function jpeg(canvas: OffscreenCanvas): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  // An unsupported type falls back to PNG.
  if (blob.type !== 'image/jpeg')
    throw new Error(`convertToBlob gave ${blob.type || 'no type'}, not image/jpeg`);
  return blob;
}

/** The size of the feed inside its crop, in native pixels. */
const nativeSize = (frame: VideoFrame, crop: NormRect | null) => ({
  width: Math.max(1, Math.round(frame.displayWidth * (crop ?? FULL).w)),
  height: Math.max(1, Math.round(frame.displayHeight * (crop ?? FULL).h)),
});

async function encodeFull(frame: VideoFrame, crop: NormRect | null): Promise<Blob> {
  const { width, height } = nativeSize(frame, crop);
  return jpeg(draw(frame, width, height, crop).canvas);
}

function encodeCropFactory(contentRect: NormRect | null) {
  return async (frame: VideoFrame, quad: Quad, rect: NormRect, outW: number, outH: number) => {
    const { width, height } = nativeSize(frame, contentRect);
    const x0 = Math.max(0, Math.floor(rect.x * outW));
    const y0 = Math.max(0, Math.floor(rect.y * outH));
    const w = Math.max(1, Math.min(outW, Math.ceil((rect.x + rect.w) * outW)) - x0);
    const h = Math.max(1, Math.min(outH, Math.ceil((rect.y + rect.h) * outH)) - y0);
    const out = context(w, h);
    if (cv) {
      const page = warpRgba(
        cv,
        readRgba(frame, width, height, contentRect),
        width,
        height,
        quad,
        outW,
        outH,
      );
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const from = ((y0 + y) * outW + x0) * 4;
        pixels.set(page.subarray(from, from + w * 4), y * w * 4);
      }
      out.putImageData(new ImageData(pixels, w, h), 0, 0);
    } else {
      // Without OpenCV the "page" is the fallback crop: an axis-aligned rectangle of the frame.
      const [tl, , br] = quad;
      const r = contentRect ?? FULL;
      const px = (x: number) => r.x + (x / width) * r.w;
      const py = (y: number) => r.y + (y / height) * r.h;
      const left = px(tl.x);
      const top = py(tl.y);
      const across = px(br.x) - left;
      const down = py(br.y) - top;
      draw(frame, w, h, {
        x: left + rect.x * across,
        y: top + rect.y * down,
        w: rect.w * across,
        h: rect.h * down,
      });
    }
    return jpeg(out.canvas);
  };
}

let stopLoop: (() => void) | null = null;

async function start(message: Extract<ToWorker, { type: 'start' }>): Promise<void> {
  stopLoop?.();
  const params = { ...DEFAULT_PARAMS, ...parseParams(message.params) };
  const loop = createFrameLoop<VideoFrame>({
    detector: createDetector(params),
    params,
    contentRect: message.contentRect,
    opencv,
    readRgba,
    findQuad: (rgba, width, height) => (cv ? findPageQuad(cv, rgba, width, height) : null),
    warpGray: (rgba, width, height, quad, outW, outH) =>
      warpGray(cv, rgba, width, height, quad, outW, outH),
    encodeFull,
    encodeCrop: encodeCropFactory(message.contentRect),
    now: () => Date.now(),
    post,
  });
  const reader = message.readable.getReader();
  let running = true;
  stopLoop = () => {
    running = false;
    loop.stop();
    void reader.cancel().catch(() => {});
  };
  try {
    while (running) {
      const { value, done } = await reader.read();
      if (done) break;
      await loop.push(value);
    }
  } catch (error) {
    if (running)
      post({
        type: 'error',
        message: `The paper stream failed: ${error instanceof Error ? error.message : String(error)}`,
      });
  } finally {
    loop.stop();
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'start') void start(message);
  else if (message.type === 'stop') {
    stopLoop?.();
    stopLoop = null;
  }
};
