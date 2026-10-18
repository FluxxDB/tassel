// The frame the server asks for when a student turn begins (the voice server's paper-frame
// request): her paper as it is now, grabbed from the live paper track and uploaded as a page with
// trigger "turn", so Ada answers about the page in front of her, not an earlier one. The paper
// capture registers a sender while its feed is live; without one, a request does nothing.
import { DETECTOR_VERSION, type PaperSourceKind } from './contracts';
import type { FrameMetaJson } from './upload/frame-meta';
import type { FrameParts } from './upload/frames-api';

type Sender = () => Promise<void>;

let sender: Sender | null = null;

/** Makes `send` the one answer to turn requests. Returns its unregister. */
export function registerTurnFrameSender(send: Sender): () => void {
  sender = send;
  return () => {
    if (sender === send) sender = null;
  };
}

/** Sends her paper as it is now, if a paper feed is live. Never throws. */
export async function requestTurnFrame(): Promise<void> {
  try {
    await sender?.();
  } catch (error) {
    console.warn('[paper] The turn frame failed:', error);
  }
}

export function turnFrameMeta(source: PaperSourceKind, at: Date): FrameMetaJson {
  return {
    reason: 'page',
    source,
    captured_at: at.toISOString(),
    // The server finds the page itself, or uses the whole frame.
    page_found: false,
    page_quad: null,
    crop_rect: null,
    mask: null,
    detector: { changed_cells: 0, ink_pixels: 0, erase_pixels: 0, version: DETECTOR_VERSION },
    trigger: 'turn',
  };
}

export function createTurnFrameSender(opts: {
  kind: PaperSourceKind;
  grab(): Promise<Blob>;
  upload(parts: FrameParts): Promise<unknown>;
  now?(): Date;
}): Sender {
  return async () => {
    const at = opts.now?.() ?? new Date();
    const full = await opts.grab();
    await opts.upload({ full, crop: null, meta: turnFrameMeta(opts.kind, at) });
  };
}

interface FrameGrabber {
  grabFrame(): Promise<ImageBitmap>;
}

/** The track's current frame as a JPEG, through Chromium's ImageCapture. */
export async function grabJpeg(track: MediaStreamTrack, quality = 0.9): Promise<Blob> {
  const Capture = (globalThis as { ImageCapture?: new (t: MediaStreamTrack) => FrameGrabber })
    .ImageCapture;
  if (!Capture) throw new Error('ImageCapture is unavailable');
  const bitmap = await new Capture(track).grabFrame();
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context for the turn frame');
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } finally {
    bitmap.close();
  }
}
