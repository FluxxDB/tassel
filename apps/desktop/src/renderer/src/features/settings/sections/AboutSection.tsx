// Settings → About: what Tassel is, the languages it speaks, and the server it talks to.
import { useTranslation } from 'react-i18next';
import { Wordmark } from '../../../components/Wordmark';
import { SettingsGroup } from '../SettingsView';

export function AboutSection({ serverUrl }: { serverUrl?: string }) {
  const { t } = useTranslation();
  return (
    <SettingsGroup>
      <div className="flex flex-col gap-3">
        <Wordmark />
        <p className="max-w-[52ch] text-[14px] leading-[21px] text-ink text-pretty">
          {t('settings.about.tagline')}
        </p>
      </div>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-8 gap-y-3 border-t border-hairline pt-5 text-[13px]">
        <dt className="mono text-[11px] leading-5 text-smoke-text">
          {t('settings.about.languages')}
        </dt>
        <dd>
          {(['en', 'es', 'ko'] as const).map((lang, index) => (
            <span key={lang} lang={lang}>
              {index > 0 && ' · '}
              {t(`newSession.language.${lang}`)}
            </span>
          ))}
        </dd>
        {serverUrl && (
          <>
            <dt className="mono text-[11px] leading-5 text-smoke-text">
              {t('settings.about.server')}
            </dt>
            <dd className="mono truncate text-[12px] normal-case" translate="no">
              {serverUrl}
            </dd>
          </>
        )}
        <dt className="mono text-[11px] leading-5 text-smoke-text">
          {t('settings.about.hosting')}
        </dt>
        <dd>{t('settings.about.poweredBy')}</dd>
      </dl>
    </SettingsGroup>
  );
}
