// Tabs for sections, on Radix Tabs: the tablist, tab and tabpanel roles, arrow keys (Home and
// End too) that move focus and the selection with it, and Tab into the panel.
// - `underline`: a row of quiet labels over one hairline; the selected one is ink, with a 2px ink
//   rule on the hairline (the tutor editor's Style and Body).
// - `rail`: a vertical list down the side of a view; the selected one sits on a paper pill
//   (the Settings sections).
import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Something shown after the label in the rail, such as a status. */
  icon?: ReactNode;
}

export interface TabsProps<T extends string> {
  value: T;
  onChange(value: T): void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
}

export function Tabs<T extends string>({
  value,
  onChange,
  orientation = 'horizontal',
  className,
  children,
}: TabsProps<T>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      orientation={orientation}
      className={className}
    >
      {children}
    </RadixTabs.Root>
  );
}

export interface TabListProps<T extends string> {
  /** The tablist's accessible name. */
  label: string;
  items: readonly TabItem<T>[];
  /** The selected value, for styling (Radix keeps the state). */
  value: T;
  onChange(value: T): void;
  variant?: 'underline' | 'rail';
  className?: string;
}

export function TabList<T extends string>({
  label,
  items,
  value,
  onChange,
  variant = 'underline',
  className,
}: TabListProps<T>) {
  const rail = variant === 'rail';
  return (
    <RadixTabs.List
      aria-label={label}
      className={cn(
        rail ? 'flex flex-col gap-0.5' : 'flex gap-6 shadow-[inset_0_-1px_0_var(--color-hairline)]',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            // Radix selects on mouse down; a click (from code or assistive tech) selects too.
            onClick={() => {
              if (!selected) onChange(item.value);
            }}
            className={cn(
              'text-left transition-[color,background-color,box-shadow] duration-150',
              rail
                ? cn(
                    'flex h-9 w-full items-center justify-between gap-2 rounded-pill px-3.5 text-[14px]',
                    selected
                      ? 'bg-paper font-w520 text-ink shadow-[0_0_0_1px_var(--color-hairline)]'
                      : 'text-smoke-text hover:bg-ink/[0.04] hover:text-ink',
                  )
                : cn(
                    'relative h-10 text-[14px]',
                    selected
                      ? 'font-w520 text-ink shadow-[inset_0_-2px_0_var(--color-ink)]'
                      : 'text-smoke-text hover:text-ink',
                  ),
            )}
          >
            <span className="truncate">{item.label}</span>
            {item.icon}
          </RadixTabs.Trigger>
        );
      })}
    </RadixTabs.List>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // Focusable (Radix's default), so Tab reaches a panel with no controls of its own.
    <RadixTabs.Content value={value} className={className}>
      {children}
    </RadixTabs.Content>
  );
}
