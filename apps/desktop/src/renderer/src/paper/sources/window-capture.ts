// The window-capture source: a window she shares (the Desk View app's, say) through the system
// picker. Its title bar is cut away: on the first frame, findContentTop finds it.
import type { SourceDeps } from '../select-source';
import type { NormRect, PaperSource } from '../types';
import { PaperSourceError } from '../types';
import { findContentTop } from './content-crop';
import { displayMediaError, requestStream, stopTracks, trackFeed } from './track-feed';

/** Frames are measured at most this wide, which is plenty for a title bar. */
const MEASURE_WIDTH = 640;
const FIRST_FRAME_MS = 3_000;

export function createWindowCaptureSource(
  deps: Pick<SourceDeps, 'mediaDevices' | 'document'>,
): PaperSource {
  return {
    kind: 'window-capture',
    async start({ signal }) {
      const stream = await requestStream(
        signal,
        () =>
          deps.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 15, max: 30 } },
            audio: false,
          }),
        displayMediaError,
      );
      const doc = deps.document ?? globalThis.document;
      let contentRect: NormRect | null = null;
      try {
        contentRect = doc ? await measureContent(stream, doc) : null;
      } catch {
        contentRect = null; // no crop beats no capture
      }
      if (signal.aborted) {
        stopTracks(stream);
        throw new PaperSourceError('aborted');
      }
      return trackFeed('window-capture', stream, contentRect, 'ended');
    },
  };
}

/**
 * The content below the title bar, from the stream's first frame: drawn small and grey, then
 * findContentTop. Sizes come from the frame (videoWidth), never from getSettings(), which can
 * disagree with the frames (spike note 3).
 */
async function measureContent(stream: MediaStream, doc: Document): Promise<NormRect | null> {
  const video = doc.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    await firstFrame(video);
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) return null;
    const scale = Math.min(1, MEASURE_WIDTH / videoWidth);
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let index = 0; index < gray.length; index += 1) {
      const pixel = index * 4;
      gray[index] = Math.round(
        0.299 * (data[pixel] ?? 0) +
          0.587 * (data[pixel + 1] ?? 0) +
          0.114 * (data[pixel + 2] ?? 0),
      );
    }
    const top = findContentTop(gray, width, height);
    return { x: 0, y: top / height, w: 1, h: 1 - top / height };
  } finally {
    video.srcObject = null;
  }
}

function firstFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no first frame')), FIRST_FRAME_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    if (typeof video.requestVideoFrameCallback === 'function')
      video.requestVideoFrameCallback(done);
    else video.addEventListener('loadeddata', done, { once: true });
  });
}
