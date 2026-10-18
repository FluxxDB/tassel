'use client';
// The download call to action. On a Mac it links to the DMG; on anything else it's a disabled pill
// that says the app isn't available there. The static HTML has no user agent, so the first render
// is the neutral Mac state and the real check runs after mount: nothing flashes "not available"
// on a Mac.
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { detectBrowserPlatform, PLATFORM_NAMES, type Platform } from '../lib/platform';
import { DOWNLOAD_URL } from '../lib/site';
import { AppleIcon } from './AppleIcon';
import { BUTTON_BASE, BUTTON_SIZES, BUTTON_VARIANTS } from './Button';

export interface DownloadButtonProps {
  size?: keyof typeof BUTTON_SIZES;
  /** `paper` on ink surfaces. */
  variant?: 'primary' | 'paper';
  /** Show the availability line under the button. */
  note?: boolean;
  /** Short label for the navbar: "Download" instead of "Download for Mac". */
  compact?: boolean;
  className?: string;
}

export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectBrowserPlatform()), []);
  return platform;
}

export function DownloadButton({
  size = 'lg',
  variant = 'primary',
  note = false,
  compact = false,
  className,
}: DownloadButtonProps) {
  const platform = usePlatform();
  const available = platform === null || platform === 'mac';
  const onInk = variant === 'paper';
  const classes = cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant]);

  return (
    <div className={cn('flex flex-col items-center gap-2.5', className)}>
      {available ? (
        <a href={DOWNLOAD_URL} className={classes} data-platform={platform ?? 'pending'}>
          <AppleIcon className="-mt-0.5" />
          {compact ? 'Download' : 'Download for Mac'}
        </a>
      ) : (
        <button
          type="button"
          disabled
          data-platform={platform}
          className={cn(
            BUTTON_BASE,
            BUTTON_SIZES[size],
            onInk ? 'bg-paper text-ink' : 'bg-ink text-paper',
            'cursor-not-allowed select-none opacity-40',
          )}
        >
          {compact
            ? `Not on ${PLATFORM_NAMES[platform]}`
            : `Not available for ${PLATFORM_NAMES[platform]}`}
        </button>
      )}
      {note && (
        <p className={cn('mono text-[11px]', onInk ? 'text-caption-muted' : 'text-smoke-text')}>
          {available ? 'Available on Mac' : 'Tassel is available on Mac only'}
        </p>
      )}
    </div>
  );
}
