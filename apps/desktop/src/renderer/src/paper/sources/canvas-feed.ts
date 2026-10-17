// A MediaStream fed from decoded helper frames: each bitmap is drawn into a canvas, whose
// capture track takes a frame on request. Not MediaStreamTrackGenerator (non-standard) nor
// VideoTrackGenerator (behind a test flag in Chromium 152).

export interface CanvasFeed {
  stream: MediaStream;
  /** Draws the bitmap (the canvas takes its size) and closes it. */
  draw(bitmap: ImageBitmap): void;
  stop(): void;
}

export function createCanvasFeed(doc: Document = document): CanvasFeed {
  const canvas = doc.createElement('canvas');
  const context = canvas.getContext('2d');
  // Frame rate 0: a frame only when requestFrame() asks, once per draw.
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks() as CanvasCaptureMediaStreamTrack[];
  let stopped = false;
  return {
    stream,
    draw(bitmap) {
      if (!stopped && context) {
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        context.drawImage(bitmap, 0, 0);
        track?.requestFrame();
      }
      bitmap.close();
    },
    stop() {
      stopped = true;
      for (const each of stream.getTracks()) each.stop();
    },
  };
}
