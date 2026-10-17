// Shared by the sources whose video comes straight from Chromium (fake clip, window, screen):
// asking for the stream under an abort signal, and a feed around it.
import type { NormRect, PaperFeed, PaperSourceKind } from '../types';
import { PaperSourceError } from '../types';

/**
 * Asks for a stream unless the start was aborted, and releases it if the start was aborted
 * meanwhile (the picker can stay open for a while).
 */
export async function requestStream(
  signal: AbortSignal,
  request: () => Promise<MediaStream>,
  failure: (error: unknown) => PaperSourceError,
): Promise<MediaStream> {
  if (signal.aborted) throw new PaperSourceError('aborted');
  let stream: MediaStream;
  try {
    stream = await request();
  } catch (error) {
    throw signal.aborted ? new PaperSourceError('aborted') : failure(error);
  }
  if (signal.aborted) {
    stopTracks(stream);
    throw new PaperSourceError('aborted');
  }
  return stream;
}

export function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** getDisplayMedia's refusals: the picker cancelled (or Screen Recording refused), or denied. */
export function displayMediaError(error: unknown): PaperSourceError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError')
    return new PaperSourceError('cancelled', 'the share was cancelled');
  // The display-media handler said no: callback(null).
  if (name === 'AbortError')
    return new PaperSourceError('unavailable', 'sharing a window is unavailable');
  return new PaperSourceError('error', describe(error));
}

export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * A feed around a stream. Its video track ending (the clip gone, a shared window closed) calls
 * onEnd once with `ending`; stop() stops every track and is not an ending.
 */
export function trackFeed(
  kind: PaperSourceKind,
  stream: MediaStream,
  contentRect: NormRect | null,
  ending: 'lost' | 'ended',
): PaperFeed {
  const listeners = new Set<(reason: 'lost' | 'ended') => void>();
  const [track] = stream.getVideoTracks();
  let over = false;
  const onEnded = () => {
    if (over) return;
    over = true;
    for (const listener of [...listeners]) listener(ending);
  };
  track?.addEventListener('ended', onEnded);
  let stopped = false;
  return {
    kind,
    stream,
    contentRect,
    devices: [],
    onEnd(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      over = true;
      track?.removeEventListener('ended', onEnded);
      stopTracks(stream);
    },
  };
}
