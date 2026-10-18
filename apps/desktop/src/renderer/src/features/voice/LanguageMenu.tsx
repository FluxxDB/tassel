// The title strip's language pill, in a live voice session: it opens the session's languages
// (English · Español · 한국어). Choosing one saves it, changes the open session here, then
// reconnects Ada in that language, and says so until she's back.
import * as Popover from '@radix-ui/react-popover';
import { patchSession, type Session } from '@tassel/shared/api';
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useCurrentSession } from '../session/current-session';
import { useStageStore } from '../session/stage-store';
import { useLiveVoice } from './live-voice';

export function LanguageMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const api = useApi();
  const { patchLocal } = useCurrentSession();
  const client = useLiveVoice((state) => state.client);
  const connection = useStageStore((state) => state.connection);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<Lang | null>(null);
  // Switching ends when Ada is connected again, after the reconnect has begun.
  const left = useRef(false);
  useEffect(() => {
    if (switching === null) return;
    if (connection !== 'connected') left.current = true;
    if (connection === 'failed' || (left.current && connection === 'connected')) {
      setSwitching(null);
    }
  }, [connection, switching]);

  const choose = async (language: Lang) => {
    setOpen(false);
    if (language === session.language) return;
    try {
      await patchSession(api, session.id, { language });
    } catch {
      return; // Unsaved: the session keeps its language, and Ada hers.
    }
    patchLocal({ language });
    left.current = false;
    setSwitching(language);
    await client?.voice?.reconnect();
  };

  const name = (lang: Lang) => t(`newSession.language.${lang}`);
  return (
    <span className="flex items-center gap-2.5">
      {switching && (
        <span role="status" className="mono text-[11px] leading-[14px] text-smoke-text">
          {t('voice.language.switching', { language: name(switching) })}
        </span>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          aria-label={t('voice.language.current', { language: name(session.language) })}
          title={t('voice.language.menu')}
          className="mono flex h-7 items-center rounded-pill bg-paper px-3 text-[11px] leading-[14px] text-ink shadow-[0_0_0_1px_var(--color-hairline)] transition-[box-shadow] duration-150 hover:shadow-[0_0_0_1px_var(--color-smoke)]"
        >
          {session.language}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={t('voice.language.menu')}
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={16}
            className="z-40 flex w-[180px] flex-col gap-0.5 rounded-card border border-hairline bg-paper p-1.5 text-ink"
          >
            {SUPPORTED_LANGS.map((lang) => (
              <button
                key={lang}
                type="button"
                lang={lang}
                aria-pressed={lang === session.language}
                onClick={() => void choose(lang)}
                className={cn(
                  'h-9 rounded-input px-3 text-left text-sm transition-[background-color] duration-150 hover:bg-bone',
                  lang === session.language && 'font-w520',
                )}
              >
                {name(lang)}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
