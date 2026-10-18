// Settings → Language: the app's own language, which changes at once and is saved for every
// launch (the main process reads it). Each session keeps its own language for talking with Ada.
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../../../components/Segmented';
import { SettingsGroup } from '../SettingsView';
import { useAppSettings } from '../settings';

export function LanguageSection() {
  const { t, i18n } = useTranslation();
  const hint = useId();
  const setUiLanguage = useAppSettings((state) => state.setUiLanguage);
  return (
    <SettingsGroup>
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-w520">{t('settings.language.label')}</span>
        <Segmented<Lang>
          label={t('settings.language.label')}
          describedBy={hint}
          value={i18n.language as Lang}
          onChange={(lang) => void setUiLanguage(lang, i18n)}
          // Each language is named in itself.
          options={SUPPORTED_LANGS.map((value) => ({
            value,
            label: t(`newSession.language.${value}`),
            lang: value,
          }))}
        />
        <p id={hint} className="text-xs leading-relaxed text-smoke-text">
          {t('settings.language.hint')}
        </p>
      </div>
    </SettingsGroup>
  );
}
