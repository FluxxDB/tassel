// Settings: a full-window view over the library or the session, opened from the gear in either
// top bar. Its own 52px strip (which drags the window, like the app's) names it and closes it;
// below, the sections run down the left as a vertical tablist and the chosen one fills the
// right. It is a Radix dialog, so focus stays inside and Escape closes it, and the session's
// keyboard shortcuts rest while it shows. The session behind it keeps running.
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, Platform } from '../../../../shared/bridge';
import { IconButton } from '../../components/IconButton';
import { Close, Gear } from '../../components/icons';
import { TabList, TabPanel, Tabs } from '../../components/Tabs';
import { cn } from '../../lib/cn';
import { AboutSection } from './sections/AboutSection';
import { CameraSection } from './sections/CameraSection';
import { DefaultsSection } from './sections/DefaultsSection';
import { LanguageSection } from './sections/LanguageSection';
import { MemorySection } from './sections/MemorySection';
import { PersonalitySection } from './sections/PersonalitySection';
import { PrivacySection } from './sections/PrivacySection';
import { TutorSection } from './sections/TutorSection';
import { VoiceSection } from './sections/VoiceSection';
import { SETTINGS_SECTIONS, type SettingsSection, useSettingsView } from './settings';

export interface SettingsViewProps {
  config?: AppConfig;
  platform?: Platform;
}

export function SettingsView({ config, platform = window.tassel?.platform }: SettingsViewProps) {
  const { t } = useTranslation();
  const { open, section, setSection, close } = useSettingsView();
  const opener = useRef<HTMLElement | null>(null);
  const body = (value: SettingsSection): ReactNode => {
    switch (value) {
      case 'tutor':
        return <TutorSection open={open && section === 'tutor'} />;
      case 'personality':
        return <PersonalitySection open={open} />;
      case 'memory':
        return <MemorySection open={open} />;
      case 'voice':
        return <VoiceSection />;
      case 'defaults':
        return <DefaultsSection platform={platform ?? 'darwin'} />;
      case 'language':
        return <LanguageSection />;
      case 'camera':
        return <CameraSection platform={platform ?? 'darwin'} />;
      case 'privacy':
        return <PrivacySection />;
      case 'about':
        return <AboutSection serverUrl={config?.serverUrl} />;
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            // Focus starts on the open section's tab, so the arrow keys move through them.
            event.preventDefault();
            const tab = document.getElementById(`settings-tab-${useSettingsView.getState().section}`);
            tab?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = opener.current;
            opener.current = null;
            if (target?.isConnected) target.focus();
          }}
          data-testid="settings"
          className="fixed inset-0 z-50 flex flex-col bg-bone text-ink motion-safe:data-[state=open]:animate-[settings-in_200ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <SettingsStrip platform={platform}>
            <Dialog.Title className="text-[15px] leading-[22px] font-w520">
              {t('settings.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton
                label={t('settings.close')}
                title={t('settings.closeHint')}
                aria-keyshortcuts="Escape"
                className="ml-auto size-9 [&>svg]:size-5"
              >
                <Close />
              </IconButton>
            </Dialog.Close>
          </SettingsStrip>
          <Tabs
            value={section}
            onChange={setSection}
            orientation="vertical"
            className="flex min-h-0 flex-1 border-t border-hairline"
          >
            <nav className="w-[232px] shrink-0 overflow-y-auto overscroll-contain px-4 pt-5 pb-8 max-[1100px]:w-[200px]">
              <TabList<SettingsSection>
                label={t('settings.sections.label')}
                variant="rail"
                idPrefix="settings-tab"
                value={section}
                onChange={setSection}
                items={SETTINGS_SECTIONS.map((value) => ({
                  value,
                  label: t(`settings.sections.${value}`),
                }))}
              />
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain border-l border-hairline">
              {SETTINGS_SECTIONS.map((value) => (
                <TabPanel
                  key={value}
                  value={value}
                  className="mx-auto w-full max-w-[760px] px-10 pt-8 pb-16 max-[1100px]:px-7"
                >
                  <h2 className="text-[22px] leading-tight font-w520 text-balance ko:leading-[1.6]">
                    {t(`settings.sections.${value}`)}
                  </h2>
                  <p className="mt-1.5 max-w-[62ch] text-[14px] leading-[21px] text-smoke-text text-pretty">
                    {t(`settings.${value}.description`)}
                  </p>
                  <div className="mt-6 flex flex-col gap-4">{body(value)}</div>
                </TabPanel>
              ))}
            </div>
          </Tabs>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The view's strip: as tall as the app's, and it drags the window too. */
function SettingsStrip({ platform, children }: { platform?: Platform; children: ReactNode }) {
  return (
    <div
      className={cn(
        'app-drag flex h-[52px] shrink-0 items-center gap-3',
        platform === 'darwin' ? 'pr-5 pl-[98px]' : 'app-drag-overlay-inset pl-5',
      )}
    >
      {children}
    </div>
  );
}

/** A paper panel of settings, with hairlines between its rows. */
export function SettingsGroup({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-5 rounded-card bg-paper p-6 shadow-[0_0_0_1px_var(--color-hairline)]',
        className,
      )}
    >
      {title && <h3 className="mono text-[11px] leading-[14px] text-smoke-text">{title}</h3>}
      {children}
    </section>
  );
}

/** The gear in the library's and the session's top bars. */
export function SettingsButton() {
  const { t } = useTranslation();
  const openSettings = useSettingsView((state) => state.openSettings);
  return (
    <IconButton
      label={t('settings.open')}
      title={t('settings.open')}
      aria-haspopup="dialog"
      onClick={() => openSettings()}
      className="size-9 [&>svg]:size-5"
    >
      <Gear />
    </IconButton>
  );
}
