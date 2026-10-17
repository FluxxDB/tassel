// The window's 52px title strip. It drags the window (controls inside stay clickable) and
// leaves room for the window controls: the traffic lights on macOS, the overlay elsewhere.
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
        'app-drag flex h-[52px] shrink-0 items-center gap-4',
        platform === 'darwin' ? 'pr-5 pl-[84px]' : 'app-drag-overlay-inset pl-5',
        className,
      )}
    >
      {children}
    </header>
  );
}
