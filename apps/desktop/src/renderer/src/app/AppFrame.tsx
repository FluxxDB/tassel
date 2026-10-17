// The window's 52px title strip. It drags the window (controls inside stay clickable) and
// leaves room for the window controls: the traffic lights on macOS, the overlay elsewhere.
// On macOS the lights end at x 80, so the first item starts 18px past them, at 98, as in the
// chosen mock; the 84px inset stays the brief's value.
import type { ReactNode } from 'react';
import type { Platform } from '../../../shared/bridge';
import { cn } from '../lib/cn';

export interface AppFrameProps {
  platform?: Platform;
  className?: string;
  children: ReactNode;
}

export function AppFrame({
  platform = window.tassel.platform,
  className,
  children,
}: AppFrameProps) {
  return (
    <header
      className={cn(
        'app-drag flex h-[52px] shrink-0 items-center gap-[18px]',
        platform === 'darwin'
          ? 'pr-5 pl-[84px] [&>:first-child]:ml-3.5'
          : 'app-drag-overlay-inset pl-5',
        className,
      )}
    >
      {children}
    </header>
  );
}
