// Settings → Session defaults: how a new session starts (its language, how she'll work, captions)
// and the chat sidebar's two remembered choices.
import type { Source } from '@tassel/shared/api';
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Platform } from '../../../../../shared/bridge';
import { Segmented } from '../../../components/Segmented';
import { SettingSwitch } from '../../../components/SettingSwitch';
import { getPaperConfig } from '../../../paper/paper-config';
import { defaultSource, paperUnavailable } from '../../new-session/defaults';
import { SourceCards } from '../../new-session/SourceCards';
import { SettingsGroup } from '../SettingsView';
import { useChatPrefs, useSessionDefaults } from '../settings';

export function DefaultsSection({ platform }: { platform: Platform }) {
  const { t } = useTranslation();
  const defaults = useSessionDefaults();
  const chatOpen = useChatPrefs((state) => state.open ?? state.defaultOpen);
  const voiceReplies = useChatPrefs((state) => state.voiceReplies);
  const languageId = useId();
  const chatId = useId();
  const chatHint = useId();
  const paper = getPaperConfig();
  const blocked = paperUnavailable(platform, paper.fakeClip, paper.source === 'webcam');
  const source: Source =
    defaults.source === 'paper' && blocked
      ? defaultSource(platform)
      : (defaults.source ?? defaultSource(platform));
  return (
    <>
      <SettingsGroup title={t('settings.defaults.newSession')}>
        <div className="flex flex-col gap-2.5">
          <span id={languageId} className="text-sm font-w520">
            {t('settings.defaults.language')}
          </span>
          <Segmented<Lang | 'app'>
            label={t('settings.defaults.language')}
            value={defaults.language ?? 'app'}
            onChange={(value) => defaults.set({ language: value === 'app' ? null : value })}
            options={[
              { value: 'app', label: t('settings.defaults.languageApp') },
              ...SUPPORTED_LANGS.map((value) => ({
                value,
                label: t(`newSession.language.${value}`),
                lang: value,
              })),
            ]}
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="text-sm font-w520">{t('newSession.groups.source')}</span>
          <SourceCards
            platform={platform}
            value={source}
            onChange={(value) => defaults.set({ source: value })}
          />
        </div>
        <SettingSwitch
          label={t('settings.defaults.captions')}
          hint={t('settings.defaults.captionsHint')}
          checked={defaults.captions}
          onChange={(captions) => defaults.set({ captions })}
        />
      </SettingsGroup>
      <SettingsGroup title={t('settings.defaults.chatGroup')}>
        <div className="flex flex-col gap-2.5">
          <span id={chatId} className="text-sm font-w520">
            {t('settings.defaults.chat')}
          </span>
          <Segmented<'open' | 'closed'>
            label={t('settings.defaults.chat')}
            describedBy={chatHint}
            value={chatOpen ? 'open' : 'closed'}
            onChange={(value) => useChatPrefs.getState().setOpen(value === 'open')}
            options={[
              { value: 'open', label: t('settings.defaults.chatOpen') },
              { value: 'closed', label: t('settings.defaults.chatClosed') },
            ]}
          />
          <p id={chatHint} className="text-xs leading-relaxed text-smoke-text">
            {t('settings.defaults.chatHint')}
          </p>
        </div>
        <SettingSwitch
          label={t('settings.defaults.voiceReplies')}
          hint={t('settings.defaults.voiceRepliesHint')}
          checked={voiceReplies}
          onChange={(on) => useChatPrefs.getState().setVoiceReplies(on)}
        />
      </SettingsGroup>
    </>
  );
}
