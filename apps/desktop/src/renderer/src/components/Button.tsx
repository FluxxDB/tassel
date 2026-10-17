// Tassel's buttons: the ink pill for the one high-emphasis action, and the ghost text button
// for everything beside it (DESIGN.md: Filled Pill Button, Ghost Text Button).
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { firstClickOnly } from '../lib/first-click';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: 'primary' | 'ghost';
  /** Height: sm 36px (title strips), md 40px, lg 48px (sheets, the dock and state CTAs). */
  size?: 'sm' | 'md' | 'lg';
  /**
   * While a request runs: the button shows `busyLabel` and ignores clicks. It stays focusable
   * (aria-disabled, not disabled), and both labels share one grid cell, so its width doesn't
   * change.
   */
  busy?: boolean;
  busyLabel?: ReactNode;
}

const SIZES = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-[22px] text-sm',
} as const;

const VARIANTS = {
  primary: 'bg-ink text-paper hover:bg-ink/85 active:bg-ink/75',
  ghost: 'bg-transparent text-ink hover:bg-ink/[0.06] active:bg-ink/10',
} as const;

const LABEL = 'col-start-1 row-start-1 inline-flex items-center gap-2';

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  busy = false,
  busyLabel,
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-disabled={busy || props['aria-disabled'] || undefined}
      // A double click acts once: its second click lands wherever the first one led.
      onClick={busy ? undefined : firstClickOnly(onClick)}
      className={cn(
        // Colors only: a transition on outline-color would fade the focus ring in.
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill font-w520 transition-[color,background-color] duration-150 disabled:pointer-events-none disabled:opacity-40',
        SIZES[size],
        VARIANTS[variant],
        busy && 'cursor-progress',
        className,
      )}
    >
      {busyLabel === undefined ? (
        children
      ) : (
        <span className="grid justify-items-center">
          <span aria-hidden={busy || undefined} className={cn(LABEL, busy && 'invisible')}>
            {children}
          </span>
          <span aria-hidden={!busy || undefined} className={cn(LABEL, !busy && 'invisible')}>
            {busyLabel}
          </span>
        </span>
      )}
    </button>
  );
}
