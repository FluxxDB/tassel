// A regular Windows/USB/virtual phone camera, using the same paper detector and uploader.
import type { SourceDeps } from '../select-source';
import { type PaperSource, PaperSourceError } from '../types';
import { describe, requestStream, stopTracks, trackFeed } from './track-feed';

export function createWebcamSource(deps: Pick<SourceDeps, 'mediaDevices'>): PaperSource {
  return {
    kind: 'webcam',
    async start({ signal, deviceId }) {
      if (!deps.mediaDevices?.getUserMedia) throw new PaperSourceError('unavailable');
      const stream = await requestStream(
        signal,
        () =>
          deps.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1440 },
              ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            },
            audio: false,
          }),
        (error) => {
          const name = error instanceof DOMException ? error.name : '';
          const code =
            name === 'NotAllowedError' || name === 'SecurityError'
              ? 'denied'
              : ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(name)
                ? 'unavailable'
                : 'error';
          return new PaperSourceError(code, describe(error));
        },
      );
      // Device labels are available after permission. Enumeration failing must not lose video.
      const devices = await deps.mediaDevices.enumerateDevices().catch(() => []);
      if (signal.aborted) {
        stopTracks(stream);
        throw new PaperSourceError('aborted');
      }
      const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
      const feed = trackFeed('webcam', stream, null, 'lost');
      feed.devices = devices
        .filter((device) => device.kind === 'videoinput' && device.deviceId)
        .map((device) => ({
          id: device.deviceId,
          name: device.label || device.deviceId,
          builtIn: false,
        }))
        .sort((a, b) => Number(b.id === active) - Number(a.id === active));
      return feed;
    },
  };
}
