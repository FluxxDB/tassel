// A lab-label chip: Geist Mono, uppercase, on a pill. Long values truncate with an ellipsis.
import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export interface ChipProps extends ComponentPropsWithRef<'span'> {
  /**
   * paper on bone surfaces; bone with a hairline ring on white cards, where bone alone vanishes;
   * ink for the one emphasized label.
   */
  tone?: 'paper' | 'bone' | 'ink';
}

const TONES = {
  paper: 'bg-paper text-smoke-text',
  bone: 'bg-bone text-smoke-text shadow-[inset_0_0_0_1px_var(--color-hairline)]',
  ink: 'bg-ink text-paper',
} as const;

export function Chip({ tone = 'paper', className, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'mono inline-block min-w-0 max-w-full truncate rounded-pill px-2.5 py-1 align-middle text-[11px] leading-[14px]',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
