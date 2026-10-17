// The detector worker's logic, with its browser parts injected so Node can test it: sampling
// frames by their timestamps, motion, the page finder, the detector's steps, and encoding what a
// trigger sends.

import type { DetectorTrigger, NormRect, Quad } from '../contracts';
import type { createDetector, DetectorTriggerCore, PageSample } from './detector';
import { blur3, movingFraction, toGray } from './gray';
import { compareSize } from './homography';
import type { FromWorker } from './messages';
import type { DetectorParams } from './params';

/** What the loop needs of a frame: VideoFrame's timestamp (µs), size and close(). */
export interface FrameLike {
  timestamp: number;
  displayWidth: number;
  displayHeight: number;
  close(): void;
}

export interface FrameLoopDeps<F extends FrameLike> {
  detector: ReturnType<typeof createDetector>;
  params: DetectorParams;
  contentRect: NormRect | null;
  /** Settles once loadOpenCv has run: true if OpenCV is ready, false if it failed. */
  opencv: Promise<boolean>;
  /** The frame inside `crop` (0–1 of the frame), drawn scaled to width × height, as RGBA. */
  readRgba(frame: F, width: number, height: number, crop: NormRect | null): Uint8ClampedArray;
  findQuad(rgba: Uint8ClampedArray, width: number, height: number): Quad | null;
  warpGray(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    quad: Quad,
    outW: number,
    outH: number,
  ): Uint8Array;
  /** A JPEG of the frame at native size inside `crop`. */
  encodeFull(frame: F, crop: NormRect | null): Promise<Blob>;
  /** A JPEG of the page (quad, in native pixels) warped to outW × outH and cut to `rect`. */
  encodeCrop(frame: F, quad: Quad, rect: NormRect, outW: number, outH: number): Promise<Blob>;
  /** Wall-clock time, in ms since the epoch. */
  now(): number;
  post(message: FromWorker): void;
}

/** The long side the page finder reads the frame at. */
const FIND_LONG_SIDE = 960;

const FULL: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The central `fraction` of a width × height feed, in whole native pixels, and as a crop of the
 * frame (0–1 of the frame, inside `content`).
 */
function central(width: number, height: number, fraction: number, content: NormRect | null) {
  const x0 = Math.round((width * (1 - fraction)) / 2);
  const y0 = Math.round((height * (1 - fraction)) / 2);
  const x1 = width - x0;
  const y1 = height - y0;
  const quad: Quad = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const r = content ?? FULL;
  const crop: NormRect = {
    x: r.x + (x0 / width) * r.w,
    y: r.y + (y0 / height) * r.h,
    w: ((x1 - x0) / width) * r.w,
    h: ((y1 - y0) / height) * r.h,
  };
  return { quad, crop };
}

const scaleQuad = (quad: Quad, sx: number, sy: number) =>
  quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;

export function createFrameLoop<F extends FrameLike>(
  deps: FrameLoopDeps<F>,
): { push(frame: F): Promise<void>; stop(): void } {
  const p = deps.params;
  const interval = p.sampleIntervalMs * 1000;
  let opencv: 'pending' | 'ready' | 'failed' = 'pending';
  let stopped = false;
  let kept: F | null = null;
  let nextAt: number | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  let previousMotion: Uint8Array | null = null;
  let size = '';
  /** The last page quad found, in native pixels. */
  let lastQuad: Quad | null = null;

  const settle = (ok: boolean) => {
    opencv = ok ? 'ready' : 'failed';
    if (stopped) return;
    deps.post({ type: 'ready', opencv: ok });
    if (!ok) {
      deps.post({
        type: 'error',
        message:
          'OpenCV failed to load: the page finder is off, and the central crop is compared instead',
      });
    }
  };
  void deps.opencv.then(settle, () => settle(false));

  async function sample(frame: F, sampledAt: number): Promise<void> {
    const crop = deps.contentRect;
    const nativeW = Math.max(1, Math.round(frame.displayWidth * (crop?.w ?? 1)));
    const nativeH = Math.max(1, Math.round(frame.displayHeight * (crop?.h ?? 1)));
    const frameSize = `${nativeW}x${nativeH}`;
    if (size && size !== frameSize) {
      // A feed can change size mid-stream (a captured tab does): quads and the reference no
      // longer fit, so start over.
      lastQuad = null;
      previousMotion = null;
      deps.detector.reset();
    }
    size = frameSize;
    const t = frame.timestamp / 1000;

    const small = deps.readRgba(frame, p.motionWidth, p.motionHeight, crop);
    const motion = {
      gray: blur3(toGray(small, p.motionWidth, p.motionHeight), p.motionWidth, p.motionHeight),
      width: p.motionWidth,
      height: p.motionHeight,
    };

    if (opencv === 'pending') {
      // Motion only: the first reference must come from the real page finder.
      const busy =
        previousMotion === null ||
        movingFraction(previousMotion, motion.gray, p.motionDelta) > p.busyFraction;
      previousMotion = motion.gray;
      deps.post({ type: 'stats', stats: { ...deps.detector.stats(), t, busy, opencv: false } });
      return;
    }

    // The page, read once per sample however often the detector asks.
    let looked = false;
    let big: { rgba: Uint8ClampedArray; width: number; height: number } | null = null;
    const frameDiagonal = Math.sqrt(nativeW * nativeW + nativeH * nativeH);
    const samplePage = (want: { width: number; height: number } | null): PageSample => {
      if (opencv === 'ready' && !looked) {
        looked = true;
        const scale = FIND_LONG_SIDE / Math.max(nativeW, nativeH);
        const width = Math.max(1, Math.round(nativeW * scale));
        const height = Math.max(1, Math.round(nativeH * scale));
        big = { rgba: deps.readRgba(frame, width, height, crop), width, height };
        const found = deps.findQuad(big.rgba, width, height);
        if (found) lastQuad = scaleQuad(found, nativeW / width, nativeH / height);
      }
      if (opencv === 'ready' && lastQuad && big) {
        const page = big;
        const out = want ?? compareSize(lastQuad, p.compareLongSide, p.cellSize);
        const quad = scaleQuad(lastQuad, page.width / nativeW, page.height / nativeH);
        return {
          raw: deps.warpGray(page.rgba, page.width, page.height, quad, out.width, out.height),
          width: out.width,
          height: out.height,
          quad: lastQuad,
          found: true,
          frameDiagonal,
        };
      }
      // No page found yet (or no OpenCV): the central part of the frame.
      const out = want ?? { width: 640, height: 480 };
      const fallback = central(nativeW, nativeH, p.fallbackCrop, crop);
      return {
        raw: toGray(
          deps.readRgba(frame, out.width, out.height, fallback.crop),
          out.width,
          out.height,
        ),
        width: out.width,
        height: out.height,
        quad: fallback.quad,
        found: false,
        frameDiagonal,
      };
    };

    const core = deps.detector.step(t, motion, samplePage);
    deps.post({ type: 'stats', stats: { ...deps.detector.stats(), opencv: opencv === 'ready' } });
    if (core) await send(frame, core, sampledAt, nativeW, nativeH);
  }

  async function send(
    frame: F,
    core: DetectorTriggerCore,
    sampledAt: number,
    width: number,
    height: number,
  ) {
    try {
      const full = await deps.encodeFull(frame, deps.contentRect);
      const crop =
        core.cropRect && core.mask
          ? await deps.encodeCrop(
              frame,
              core.quad,
              core.cropRect,
              2 * core.mask.cols * p.cellSize,
              2 * core.mask.rows * p.cellSize,
            )
          : null;
      const trigger: DetectorTrigger = {
        reason: core.reason,
        capturedAt: new Date(sampledAt).toISOString(),
        full,
        crop,
        width,
        height,
        pageFound: core.pageFound,
        pageQuad: core.quad,
        cropRect: core.cropRect,
        mask: core.mask,
        changedCells: core.changedCells,
        inkPixels: core.inkPixels,
        erasePixels: core.erasePixels,
      };
      if (!stopped) deps.post({ type: 'trigger', trigger });
    } catch (error) {
      if (!stopped) {
        deps.post({
          type: 'error',
          message: `A ${core.reason} trigger couldn't be encoded: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  return {
    async push(frame: F): Promise<void> {
      if (stopped) {
        frame.close();
        return;
      }
      const at = frame.timestamp;
      // A timestamp that goes back means a new stream: start the schedule again.
      if (at < lastAt) nextAt = null;
      if (nextAt !== null && at < nextAt) {
        frame.close();
        return;
      }
      nextAt = (nextAt ?? at) + interval;
      while (nextAt <= at) nextAt += interval;
      lastAt = at;
      // Keep this frame (a trigger may need it) and let the last one go.
      kept?.close();
      kept = frame;
      await sample(frame, deps.now());
    },
    stop(): void {
      stopped = true;
      kept?.close();
      kept = null;
    },
  };
}
