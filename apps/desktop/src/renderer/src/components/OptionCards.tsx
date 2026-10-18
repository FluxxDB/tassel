// Option cards: a single choice among a few ways of doing something ("How you'll work"), each a
// paper card with a name and one line on what it means. It is a radio group on Radix
// ToggleGroup, like Segmented: selection follows focus, the arrow keys move it, and Tab enters
// and leaves the group. The selected card takes an ink ring and a check.
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { type ReactNode, useId } from 'react';
import { cn } from '../lib/cn';
import { Check } from './icons';

export interface OptionCard<T extends string> {
  value: T;
  label: string;
  description: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface OptionCardsProps<T extends string> {
  options: readonly OptionCard<T>[];
  value: T;
  onChange(value: T): void;
  /** The group's accessible name. */
  label: string;
  describedBy?: string;
  className?: string;
}

export function OptionCards<T extends string>({
  options,
  value,
  onChange,
  label,
  describedBy,
  className,
}: OptionCardsProps<T>) {
  const id = useId();
  const select = (next: string) => {
    const option = options.find((o) => o.value === next);
    if (option && !option.disabled && next !== value) onChange(option.value);
  };
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={select}
      aria-label={label}
      aria-describedby={describedBy}
      className={cn('grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            onFocus={() => select(option.value)}
            aria-labelledby={`${id}-${option.value}`}
            aria-describedby={`${id}-${option.value}-about`}
            className={cn(
              'relative flex min-h-[76px] min-w-0 flex-col items-start gap-1.5 rounded-card-sm bg-paper p-3.5 text-left transition-[box-shadow,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'shadow-[0_0_0_1.5px_var(--color-ink)]'
                : 'shadow-[0_0_0_1px_var(--color-hairline)] hover:shadow-[0_0_0_1px_var(--color-smoke)]',
            )}
          >
            {option.icon && (
              <span aria-hidden="true" className="text-ink [&>svg]:size-5">
                {option.icon}
              </span>
            )}
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-3.5 right-3.5 grid size-[18px] place-items-center rounded-pill transition-opacity duration-150 [&>svg]:size-3',
                selected ? 'bg-ink text-paper opacity-100' : 'opacity-0',
              )}
            >
              <Check strokeWidth={2.4} />
            </span>
            <span
              id={`${id}-${option.value}`}
              className="text-[14px] leading-5 font-w520 text-ink ko:leading-[1.6]"
            >
              {option.label}
            </span>
            <span
              id={`${id}-${option.value}-about`}
              className="text-[12px] leading-[17px] text-smoke-text text-pretty ko:leading-[1.6]"
            >
              {option.description}
            </span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
