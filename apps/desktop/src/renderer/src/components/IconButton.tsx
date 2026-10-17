// A 48px round icon control, as in the session dock, drawing its 24-unit icon at 22px as the
// mock does. `pressed` makes it a toggle: ink fill with a white icon when on. The label is its
// accessible name, so the icon stays decorative.
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface IconButtonProps
  extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'aria-pressed' | 'children'> {
  label: string;
  /** Set for a toggle (aria-pressed); leave undefined for a plain action. */
  pressed?: boolean;
  /**
   * The ink look of `pressed` without aria-pressed, for a control whose name already states
   * its state (the Board control's "Board: Split, pinned"): never both.
   */
  active?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  pressed,
  active = false,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}: IconButtonProps) {
  // aria-disabled keeps the control focusable, so its tooltip can say why it's unavailable.
  const unavailable = props['aria-disabled'] === true || props['aria-disabled'] === 'true';
  const ink = (pressed || active) && !unavailable;
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      onClick={unavailable ? undefined : onClick}
      className={cn(
        'grid size-12 shrink-0 place-items-center rounded-pill transition-[color,background-color] duration-150 disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-[22px]',
        // Only the icon dims, so the focus ring stays full ink.
        unavailable && 'cursor-default text-ink [&>svg]:opacity-40',
        !unavailable &&
          (ink
            ? 'bg-ink text-paper hover:bg-ink/85'
            : 'bg-transparent text-ink hover:bg-ink/[0.06] active:bg-ink/10'),
        className,
      )}
    >
      {children}
    </button>
  );
}
