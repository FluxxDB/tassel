// Menus on Radix DropdownMenu: a paper card with a hairline, its items 36px rows that tint bone
// when highlighted. Radix gives the menu roles, arrow keys and typeahead, Escape, and returns
// focus to the trigger. A radio group marks its choice with a check (the library's sort, the
// session's type).
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Check } from './icons';

export interface MenuProps {
  /** The trigger: one focusable element, which Radix wires as the menu's button. */
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  /** The menu's accessible name, when its trigger's name doesn't fit it. */
  label?: string;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  className?: string;
}

export function Menu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  label,
  open,
  onOpenChange,
  className,
}: MenuProps) {
  return (
    <Dropdown.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          aria-label={label}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={16}
          className={cn(
            'z-50 flex min-w-[200px] max-w-[calc(100vw-32px)] flex-col gap-0.5 rounded-card-sm border border-hairline bg-paper p-1 text-ink motion-safe:data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            className,
          )}
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

const ITEM =
  'flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-input px-3 text-[14px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-bone';

export function MenuItem({
  onSelect,
  children,
  disabled,
}: {
  onSelect(): void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item onSelect={onSelect} disabled={disabled} className={ITEM}>
      {children}
    </Dropdown.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <Dropdown.Label className="mono px-3 pt-2 pb-1 text-[11px] leading-[14px] text-smoke-text">
      {children}
    </Dropdown.Label>
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="mx-1 my-1 h-px bg-hairline" />;
}

export interface MenuRadioOption<T extends string> {
  value: T;
  label: string;
  lang?: string;
}

export function MenuRadioGroup<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange(value: T): void;
  options: readonly MenuRadioOption<T>[];
  /** The group's accessible name. */
  label?: string;
}) {
  return (
    <Dropdown.RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={label}
    >
      {options.map((option) => (
        <Dropdown.RadioItem
          key={option.value}
          value={option.value}
          lang={option.lang}
          className={cn(ITEM, 'justify-between data-[state=checked]:font-w520')}
        >
          {option.label}
          <Dropdown.ItemIndicator className="[&>svg]:size-4">
            <Check />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
      ))}
    </Dropdown.RadioGroup>
  );
}
