// One on/off setting: its label and a Radix switch on one line, its hint under them. The hint
// is the switch's description.
import * as Switch from '@radix-ui/react-switch';
import { useId } from 'react';

export interface SettingSwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(on: boolean): void;
  disabled?: boolean;
}

export function SettingSwitch({ label, hint, checked, onChange, disabled }: SettingSwitchProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-sm font-w520">
          {label}
        </label>
        <Switch.Root
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-describedby={hint ? hintId : undefined}
          className="h-6 w-10 shrink-0 rounded-pill border border-hairline bg-bone p-0.5 disabled:opacity-40 data-[state=checked]:border-ink data-[state=checked]:bg-ink"
        >
          <Switch.Thumb className="block size-[18px] rounded-pill bg-smoke transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-paper motion-reduce:transition-none" />
        </Switch.Root>
      </div>
      {hint && (
        <p id={hintId} className="text-xs leading-relaxed text-smoke-text text-pretty">
          {hint}
        </p>
      )}
    </div>
  );
}
