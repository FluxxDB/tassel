import { useCallback, useEffect, useRef, useState } from 'react';

export function resolveDevice(
  saved: string | null,
  devices: MediaDeviceInfo[],
  kind: 'audioinput' | 'audiooutput',
): { id: string | null; lost: boolean } {
  if (saved === null) return { id: null, lost: false };
  return devices.some((device) => device.kind === kind && device.deviceId === saved)
    ? { id: saved, lost: false }
    : { id: null, lost: true };
}
/** Enumerate only: selecting devices never requests microphone/camera permission. */
export function useAudioDevices(media: MediaDevices | undefined = navigator.mediaDevices) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      if (!media) throw new Error('MediaDevices unavailable');
      const next = await media.enumerateDevices();
      if (request !== revision.current) return;
      setDevices(next);
      setReady(true);
      setError(false);
    } catch {
      if (request === revision.current) setError(true);
    }
  }, [media]);
  useEffect(() => {
    void refresh();
    const changed = () => {
      void refresh();
    };
    media?.addEventListener('devicechange', changed);
    return () => {
      ++revision.current;
      media?.removeEventListener('devicechange', changed);
    };
  }, [media, refresh]);
  return {
    inputs: devices.filter((device) => device.kind === 'audioinput'),
    outputs: devices.filter((device) => device.kind === 'audiooutput'),
    refresh,
    // Additional state distinguishes initial/failed enumeration from an unplugged saved device.
    ready,
    error,
  };
}
