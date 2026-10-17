// The screen source: the whole screen, slowly. Its triggers never upload on their own (R7).
import type { SourceDeps } from '../select-source';
import type { PaperSource } from '../types';
import { displayMediaError, requestStream, trackFeed } from './track-feed';

export function createScreenSource(deps: Pick<SourceDeps, 'mediaDevices'>): PaperSource {
  return {
    kind: 'screen',
    async start({ signal }) {
      const stream = await requestStream(
        signal,
        () =>
          deps.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 5, max: 10 } },
            audio: false,
          }),
        displayMediaError,
      );
      return trackFeed('screen', stream, null, 'ended');
    },
  };
}
