// A single-choice segmented control on Radix ToggleGroup: a radio group of mono lab labels,
// with the selected one as an ink pill. Selection follows focus, as in any radio group, so
// the arrow keys (and Home and End) change the value; Tab enters and leaves the group.
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** The label's language when it isn't the UI's, such as "한국어" in an English UI. */
  lang?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** The group's accessible name. */
  label: string;
  /** The id of text that explains the group, such as why an option is disabled. */
  describedBy?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  describedBy,
  className,
}: SegmentedControlProps<T>) {
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
        'inline-flex max-w-full items-center gap-0.5 rounded-pill bg-paper p-1 shadow-[0_0_0_1px_var(--color-hairline)]',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          lang={option.lang}
          onFocus={() => select(option.value)}
          className={cn(
            // The global 2px ring offset leaves a gap, so the ring reads around the ink pill.
            'mono h-8 min-w-0 truncate rounded-pill px-3.5 text-xs transition-[color,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
            option.value === value
              ? 'bg-ink text-paper'
              : 'text-smoke-text hover:bg-ink/[0.06] hover:text-ink',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
