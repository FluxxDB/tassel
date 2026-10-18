import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import type { Sensitivity } from '@tassel/shared/voice';
import { type ReactNode, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Close } from '../../components/icons';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useAudioPrefs } from './audio-prefs';
import { resolveDevice, useAudioDevices } from './devices';

export function AudioSettings({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  trigger: ReactNode;
}) {
  const { t } = useTranslation();
  const title = useId();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild aria-label={t('voice.settings.open')}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-labelledby={title}
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={16}
          className="z-40 max-h-[var(--radix-popover-content-available-height)] w-[360px] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-card border border-hairline bg-paper p-5 text-ink"
        >
          <header className="mb-5 flex items-center justify-between gap-3">
            <h2 id={title} className="text-base font-medium">
              {t('voice.settings.title')}
            </h2>
            <Popover.Close
              aria-label={t('voice.settings.close')}
              className="grid size-8 shrink-0 place-items-center rounded-pill hover:bg-bone [&>svg]:size-4"
            >
              <Close />
            </Popover.Close>
          </header>
          <AudioSettingsPanel />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AudioSettingsPanel() {
  const { t } = useTranslation();
  const prefs = useAudioPrefs();
  const { inputs, outputs, ready, error, refresh } = useAudioDevices();
  const sensitivityHint = useId();
  const input = resolveDevice(prefs.inputId, inputs, 'audioinput');
  const output = resolveDevice(prefs.outputId, outputs, 'audiooutput');
  const presenter = resolveDevice(prefs.presenterOutputId, outputs, 'audiooutput');
  // Chromium exposes a "default" alias as well as its concrete device. One default option suffices.
  const concrete = (devices: MediaDeviceInfo[]) =>
    devices.filter((d) => d.deviceId && d.deviceId !== 'default');
  const choices = (devices: MediaDeviceInfo[], kind: 'input' | 'output') =>
    concrete(devices).map((device, index) => ({
      value: device.deviceId,
      label: device.label || t(`voice.device.${kind}`, { n: index + 1 }),
    }));
  const defaultChoice = { value: SYSTEM_DEFAULT, label: t('voice.settings.systemDefault') };
  const primaryDevice = outputs.find((d) => d.deviceId === (output.id ?? 'default'));
  const roomOutputs = concrete(outputs).filter(
    (d) =>
      d.deviceId !== primaryDevice?.deviceId &&
      !(primaryDevice?.groupId && d.groupId === primaryDevice.groupId),
  );
  const roomChoices = choices(roomOutputs, 'output');
  const roomId = roomOutputs.some((d) => d.deviceId === presenter.id) ? presenter.id : null;
  const conflict = presenter.id !== null && roomId === null;
  useEffect(() => {
    // A default-device change can make a remembered room speaker the primary too.
    // Null means presenter playback is off until a distinct output is chosen (Task 12).
    if (ready && !error && prefs.presenter && conflict) prefs.set({ presenterOutputId: null });
  }, [ready, error, prefs.presenter, prefs.set, conflict]);
  const lost = ready && !error;
  return (
    <div className="flex flex-col gap-5">
      <DeviceSelect
        label={t('voice.settings.input')}
        value={input.lost ? '' : (input.id ?? SYSTEM_DEFAULT)}
        placeholder={t('voice.settings.systemDefault')}
        options={[defaultChoice, ...choices(inputs, 'input')]}
        disabled={!ready || error}
        onChange={(id) => prefs.set({ inputId: id === SYSTEM_DEFAULT ? null : id })}
      />
      {lost && input.lost && (
        <DeviceNotice>{t('voice.device.lost', { device: t('voice.settings.input') })}</DeviceNotice>
      )}
      <DeviceSelect
        label={t('voice.settings.output')}
        value={output.lost ? '' : (output.id ?? SYSTEM_DEFAULT)}
        placeholder={t('voice.settings.systemDefault')}
        options={[defaultChoice, ...choices(outputs, 'output')]}
        disabled={!ready || error}
        onChange={(id) =>
          prefs.set({
            outputId: id === SYSTEM_DEFAULT ? null : id,
            ...(id === prefs.presenterOutputId ? { presenterOutputId: null } : {}),
          })
        }
      />
      {lost && output.lost && (
        <DeviceNotice>
          {t('voice.device.lost', { device: t('voice.settings.output') })}
        </DeviceNotice>
      )}
      {error && (
        <div role="status" className="rounded-card-sm bg-bone p-3 text-sm text-smoke-text">
          <p>{t('voice.device.unavailable')}</p>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            className="mt-2 rounded-pill border border-hairline px-3 py-1 text-ink"
          >
            {t('common.retry')}
          </button>
        </div>
      )}
      <div className="border-t border-hairline pt-5">
        <SettingSwitch
          label={t('voice.settings.presenter')}
          hint={t('voice.settings.presenterHint')}
          checked={prefs.presenter}
          onChange={(on) => prefs.setPresenter(on)}
        />
        {prefs.presenter && (
          <div className="mt-4 flex flex-col gap-2">
            <DeviceSelect
              label={t('voice.settings.presenterOutput')}
              value={roomId ?? ''}
              placeholder={t('voice.settings.chooseOutput')}
              options={roomChoices}
              disabled={!ready || error || roomChoices.length === 0}
              onChange={(id) => prefs.set({ presenterOutputId: id })}
            />
            {lost && presenter.lost && (
              <DeviceNotice>{t('voice.device.presenterLost')}</DeviceNotice>
            )}
            {ready && !error && roomChoices.length === 0 && (
              <p className="text-xs leading-relaxed text-smoke-text">
                {t('voice.settings.noRoomOutput')}
              </p>
            )}
          </div>
        )}
      </div>
      <SettingSwitch
        label={t('voice.settings.pushToTalk')}
        hint={t('voice.settings.pushToTalkHint')}
        checked={prefs.pushToTalk}
        onChange={(pushToTalk) => prefs.set({ pushToTalk })}
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('voice.settings.sensitivityLabel')}</span>
        <SegmentedControl<Sensitivity>
          label={t('voice.settings.sensitivityLabel')}
          describedBy={sensitivityHint}
          value={prefs.sensitivity}
          options={(['low', 'normal', 'high'] as const).map((value) => ({
            value,
            label: t(`voice.settings.sensitivity.${value}`),
          }))}
          onChange={(sensitivity) => prefs.set({ sensitivity })}
          className="w-full justify-between"
        />
        <p id={sensitivityHint} className="text-xs leading-relaxed text-smoke-text">
          {t('voice.settings.sensitivityHint')}
        </p>
      </div>
    </div>
  );
}
const SYSTEM_DEFAULT = 'tassel-system-default';
function DeviceSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  onChange(id: string): void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger
          id={id}
          className="flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-pill border border-hairline bg-bone px-3.5 text-left text-sm disabled:opacity-50 [&>span:first-child]:truncate"
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon aria-hidden="true">⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-32px)] overflow-hidden rounded-card-sm border border-hairline bg-paper text-ink"
          >
            <Select.Viewport className="p-1">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="flex min-h-9 cursor-default items-center rounded-card-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-bone data-[state=checked]:bg-ink data-[state=checked]:text-paper"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
function SettingSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <Switch.Root
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={hintId}
          className="h-6 w-10 shrink-0 rounded-pill border border-hairline bg-bone p-0.5 data-[state=checked]:border-ink data-[state=checked]:bg-ink"
        >
          <Switch.Thumb className="block size-[18px] rounded-pill bg-smoke transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-paper motion-reduce:transition-none" />
        </Switch.Root>
      </div>
      <p id={hintId} className="text-xs leading-relaxed text-smoke-text">
        {hint}
      </p>
    </div>
  );
}
function DeviceNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="-mt-3 text-xs leading-relaxed text-smoke-text">
      {children}
    </p>
  );
}
