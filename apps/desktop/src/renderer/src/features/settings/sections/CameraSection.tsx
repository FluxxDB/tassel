// Settings → Camera & paper: where Ada sees her paper from. The choice is saved for the main
// process, which reads it at launch, so a change applies the next time she opens Tassel (a
// TASSEL_PAPER_SOURCE in dev and E2E still wins). Nothing here opens the camera.
import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Platform, SavedPaperSource } from '../../../../../shared/bridge';
import { Button } from '../../../components/Button';
import { OptionCards } from '../../../components/OptionCards';
import { SettingsGroup } from '../SettingsView';
import { useAppSettings } from '../settings';

export function CameraSection({ platform }: { platform: Platform }) {
  const { t } = useTranslation();
  const note = useId();
  const saved = useAppSettings((state) => state.saved.paperSource ?? 'auto');
  const atLaunch = useAppSettings((state) => state.launchPaperSource);
  const setPaperSource = useAppSettings((state) => state.setPaperSource);
  useEffect(() => {
    void useAppSettings.getState().load();
  }, []);
  const mac = platform === 'darwin';
  // Desk View is macOS only, and its window capture with it.
  const sources: readonly SavedPaperSource[] = mac
    ? ['auto', 'deskview-helper', 'webcam', 'window-capture']
    : ['auto', 'webcam'];
  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-2.5">
          <span className="text-sm font-w520">{t('settings.camera.label')}</span>
          <OptionCards<SavedPaperSource>
            label={t('settings.camera.label')}
            describedBy={note}
            value={sources.includes(saved) ? saved : 'auto'}
            onChange={(source) => void setPaperSource(source)}
            options={sources.map((value) => ({
              value,
              label: t(`settings.camera.sources.${value}`),
              description: t(`settings.camera.hints.${value}`),
            }))}
          />
          <p
            id={note}
            role="status"
            className="text-xs leading-relaxed text-smoke-text empty:sr-only"
          >
            {atLaunch !== null && saved !== atLaunch ? t('settings.camera.restart') : ''}
          </p>
        </div>
      </SettingsGroup>
      <SettingsGroup>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 max-w-[48ch] flex-col gap-1.5">
            <span className="text-sm font-w520">{t('settings.camera.access')}</span>
            <p className="text-xs leading-relaxed text-smoke-text text-pretty">
              {t('settings.camera.accessHint')}
            </p>
          </div>
          <Button
            variant="ghost"
            className="shadow-[0_0_0_1px_var(--color-hairline)]"
            onClick={() => void window.tassel?.paper?.openCameraSettings()}
          >
            {t('settings.camera.openSystem')}
          </Button>
        </div>
      </SettingsGroup>
    </>
  );
}
