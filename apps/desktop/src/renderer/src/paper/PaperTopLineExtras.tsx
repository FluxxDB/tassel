// What paper adds to P1's TopLine, after the pin indicator (Task 13 passes it as `trailing`):
// Switch camera when the helper sees more than one Desk View camera, and a notice while frames
// aren't reaching Ada. The TopLine ignores the pointer, so each of these takes it back.
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { usePaperStore } from './paper-store';
import type { HelperDevice } from './types';

const PILL =
  'pointer-events-auto inline-flex h-[26px] items-center rounded-pill bg-paper px-3 text-[13px] leading-[18px] whitespace-nowrap text-ink shadow-[0_0_0_1px_var(--color-hairline)]';

/** The camera after the one in use: the chosen one, else the helper's pick (built-in first). */
function nextDevice(devices: HelperDevice[], chosen: string | null): HelperDevice | undefined {
  const inUse =
    devices.find((device) => device.id === chosen) ??
    devices.find((device) => device.builtIn) ??
    devices[0];
  const index = inUse ? devices.indexOf(inUse) : -1;
  return devices[(index + 1) % devices.length];
}

export function PaperTopLineExtras(): JSX.Element | null {
  const { t } = useTranslation();
  const devices = usePaperStore((state) => state.devices);
  const deviceId = usePaperStore((state) => state.deviceId);
  const chooseDevice = usePaperStore((state) => state.useDevice);
  const lastError = usePaperStore((state) => state.uploads.lastError);
  // Frames that keep failing for reasons that pass (no network, the server, the token): she
  // should know Ada isn't seeing her latest work. A refused frame or a deleted session isn't that.
  const failing = lastError === 'offline' || lastError === 'server' || lastError === 'auth';
  const kind = usePaperStore((state) => state.kind);
  const canSwitch = devices.length > 1;
  if (!canSwitch && !failing && !(kind === 'webcam' && devices.length > 0)) return null;
  return (
    <>
      {kind === 'webcam' && devices.length > 0 && (
        <select
          aria-label={t('paper.webcam.camera')}
          className={`${PILL} max-w-[240px] truncate`}
          value={deviceId ?? devices[0]?.id}
          onChange={(event) => chooseDevice(event.target.value)}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      )}
      {canSwitch && kind !== 'webcam' && (
        <button
          type="button"
          onClick={() => {
            const next = nextDevice(devices, deviceId);
            if (next) chooseDevice(next.id);
          }}
          className={`${PILL} font-w520 transition-[background-color] duration-[120ms] hover:bg-bone`}
        >
          {t('paper.devices.switch')}
        </button>
      )}
      {failing && (
        <span role="status" className={PILL}>
          {t('paper.upload.failing')}
        </span>
      )}
    </>
  );
}
