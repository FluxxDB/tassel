// A 48px round icon control, as in the session dock. `pressed` makes it a toggle: ink fill
// with a white icon when on. The label is its accessible name, so the icon stays decorative.
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface IconButtonProps
  extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'aria-pressed' | 'children'> {
  label: string;
  /** Set for a toggle (aria-pressed); leave undefined for a plain action. */
  pressed?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  pressed,
  type = 'button',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'grid size-12 shrink-0 place-items-center rounded-pill transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
        pressed
          ? 'bg-ink text-paper hover:bg-ink/85'
          : 'bg-transparent text-ink hover:bg-ink/[0.06] active:bg-ink/10',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
