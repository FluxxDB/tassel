// The soft segmented control, for scales and short value sets (session type, language,
// interruptions): a paper thumb on a lightly tinted track. It is a radio group on Radix
// ToggleGroup. Selection follows focus, as in any radio group, so the arrow keys (and Home and
// End) change the value; Tab enters and leaves the group.
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** The label's language when it isn't the UI's, such as "한국어" in an English UI. */
  lang?: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** The group's accessible name. */
  label: string;
  /** The id of text that explains the group, such as why an option is disabled. */
  describedBy?: string;
  /** Options share the width equally, as a scale does. */
  fill?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  describedBy,
  fill = false,
  className,
}: SegmentedProps<T>) {
  const select = (next: string) => {
    // Radix reports '' when the selected item is clicked again: a radio group stays selected.
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
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 rounded-pill bg-ink/[0.05] p-[3px]',
        fill && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            lang={option.lang}
            onFocus={() => select(option.value)}
            className={cn(
              'h-[30px] min-w-0 truncate rounded-pill px-3.5 text-[13px] leading-none transition-[color,background-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
              fill && 'flex-1',
              selected
                ? 'bg-paper font-w520 text-ink shadow-[0_0_0_1px_var(--color-hairline)]'
                : 'text-smoke-text hover:text-ink',
            )}
          >
            {option.label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
