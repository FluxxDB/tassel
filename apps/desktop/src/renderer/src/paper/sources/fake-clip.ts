// The fake-clip source (dev and E2E only): Chromium's fake camera playing TASSEL_FAKE_CLIP,
// through the switches main appends. In file mode Chromium shows one device, plays at 30 fps
// and loops.
import type { SourceDeps } from '../select-source';
import { type PaperSource, PaperSourceError } from '../types';
import { describe, requestStream, trackFeed } from './track-feed';

export function createFakeClipSource(
  deps: Pick<SourceDeps, 'config' | 'mediaDevices'>,
): PaperSource {
  return {
    kind: 'fake-clip',
    async start({ signal }) {
      if (signal.aborted) throw new PaperSourceError('aborted');
      // Without the fake device (the clip is missing), getUserMedia would reach a real camera.
      if (!deps.config.fakeClip) {
        throw new PaperSourceError('unavailable', 'there is no fake clip (TASSEL_FAKE_CLIP)');
      }
      const stream = await requestStream(
        signal,
        () =>
          deps.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1440 } },
            audio: false,
          }),
        userMediaError,
      );
      return trackFeed('fake-clip', stream, null, 'lost');
    },
  };
}

function userMediaError(error: unknown): PaperSourceError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotFoundError' || name === 'NotReadableError') {
    return new PaperSourceError('unavailable', describe(error));
  }
  if (name === 'NotAllowedError') return new PaperSourceError('denied', describe(error));
  return new PaperSourceError('error', describe(error));
}
