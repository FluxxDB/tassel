// The desktop app's two buttons as links (apps/desktop/.../components/Button.tsx): the ink pill for
// the one high-emphasis action, and the ghost text button beside it. `paper` is the pill inverted,
// for use on an ink surface.
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const BUTTON_SIZES = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-[22px] text-[15px]',
} as const;

export const BUTTON_VARIANTS = {
  primary: 'bg-ink text-paper hover:bg-ink/85 active:bg-ink/75',
  paper: 'bg-paper text-ink hover:bg-paper/85 active:bg-paper/75',
  ghost: 'bg-transparent text-ink hover:bg-ink/[0.06] active:bg-ink/10',
} as const;

export const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill font-w520 transition-[color,background-color,opacity] duration-150';

export interface ButtonLinkProps extends ComponentPropsWithoutRef<'a'> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <a
      {...props}
      className={cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className)}
    />
  );
}
