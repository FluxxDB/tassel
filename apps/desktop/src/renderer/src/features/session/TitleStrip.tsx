// The session's 52px strip. On the left, a small wordmark, then the title, which she renames in
// place (a click, a double click or Enter on it), its menu (Rename, and the session's type), and
// one subject chip. On the right, one status pill (the source, live or not, and the timer), the
// session's language, the chat sidebar's toggle and the gear. In a live voice session the
// language opens the language menu, and a title Ada gives the session types on (spec §5.1).
import { patchSession, type Session, type SessionType, type Source } from '@tassel/shared/api';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppFrame } from '../../app/AppFrame';
import { prefersReducedMotion } from '../../board/motion';
import { Chip } from '../../components/Chip';
import { IconButton } from '../../components/IconButton';
import { ChevronDown } from '../../components/icons';
import { Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuSeparator } from '../../components/Menu';
import { TitleField } from '../../components/TitleField';
import { Wordmark } from '../../components/Wordmark';
import { useApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { usePaperStore } from '../../paper/paper-store';
import { usePaperLive } from '../../paper/use-paper-capture';
import { ChatToggle } from '../chat/ChatToggle';
import { SettingsButton } from '../settings/SettingsView';
import { LanguageMenu } from '../voice/LanguageMenu';
import { useLiveVoice } from '../voice/live-voice';
import { useCurrentSession } from './current-session';
import { useElapsed } from './use-elapsed';

export interface TitleStripProps {
  /** Null while the session loads, or if it couldn't be loaded (`failed`). */
  session: Session | null;
  failed: boolean;
  /** When the session screen opened: the timer counts from here (R7). */
  startedAt: Date;
}

const TYPES: readonly SessionType[] = ['homework', 'studying', 'research', 'other'];

// A landing spot for focus: never a Tab stop, and no ring, since the heading isn't a control.
const HEADING = 'flex min-w-0 text-[15px] leading-[22px] font-w520 focus-visible:outline-none';

export function TitleStrip({ session, failed, startedAt }: TitleStripProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { patchLocal } = useCurrentSession();
  // The dot is live red only while her paper is really delivering frames (R29).
  const paperLive = usePaperLive();
  const heading = useRef<HTMLHeadingElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const landed = useRef(false);
  const live = useLiveVoice((state) => state.live);
  const [renaming, setRenaming] = useState(false);
  // The title the session opened with shows at once; one that comes later types on.
  const opening = useRef<string | null | undefined>(undefined);
  if (session && opening.current === undefined) opening.current = session.title;
  const shown = session !== null || failed;
  // She arrives from a card or the new session sheet, whose button is gone: focus lands on the
  // title once it shows, so it isn't left on the page body.
  useEffect(() => {
    if (!shown || landed.current) return;
    landed.current = true;
    if (document.activeElement === document.body) heading.current?.focus();
  }, [shown]);

  const rename = async (title: string) => {
    if (!session) return;
    // title_source becomes "student": Ada's titler never renames it again.
    await patchSession(api, session.id, { title });
    // What she typed is what she sees, typed on no more.
    opening.current = title;
    patchLocal({ title });
  };
  const setType = async (type: SessionType) => {
    if (!session || type === session.type) return;
    try {
      await patchSession(api, session.id, { type });
      patchLocal({ type });
    } catch {
      // Unsaved: the session keeps its type.
    }
  };
  const doneRenaming = () => {
    setRenaming(false);
    // Back on the title, once it's there again.
    requestAnimationFrame(() => titleButton.current?.focus());
  };
  const titleText = session?.title ?? t('session.untitled');

  return (
    <AppFrame>
      <Wordmark small />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {session && (
          <>
            <h1
              ref={heading}
              tabIndex={-1}
              lang={session.title === null ? undefined : session.language}
              aria-label={renaming ? undefined : titleText}
              className={cn(HEADING, renaming ? 'w-[min(420px,40vw)]' : 'max-w-[min(420px,40vw)]')}
            >
              {renaming ? (
                <TitleField
                  initial={session.title ?? ''}
                  lang={session.language}
                  label={t('session.title.input')}
                  onSave={rename}
                  onDone={doneRenaming}
                  className="h-8 px-2 text-[15px] font-w520"
                />
              ) : (
                <button
                  ref={titleButton}
                  type="button"
                  onClick={() => setRenaming(true)}
                  title={t('session.title.renameHint')}
                  className={cn(
                    '-mx-2 min-w-0 truncate rounded-input px-2 py-[5px] text-left transition-[background-color] duration-150 hover:bg-ink/[0.05]',
                    session.title === null ? 'text-smoke-text' : 'text-ink',
                  )}
                >
                  {session.title === null ? (
                    t('session.untitled')
                  ) : (
                    <TypedTitle title={session.title} opening={opening.current ?? null} />
                  )}
                </button>
              )}
            </h1>
            <Menu
              align="start"
              trigger={
                <IconButton
                  label={t('session.title.menu')}
                  title={t('session.title.menu')}
                  className="size-7 text-smoke-text hover:text-ink data-[state=open]:bg-ink/[0.06] data-[state=open]:text-ink [&>svg]:size-4"
                >
                  <ChevronDown />
                </IconButton>
              }
            >
              <MenuItem onSelect={() => setRenaming(true)}>{t('session.title.rename')}</MenuItem>
              <MenuSeparator />
              <MenuLabel>{t('newSession.groups.type')}</MenuLabel>
              <MenuRadioGroup<SessionType>
                label={t('newSession.groups.type')}
                value={session.type}
                onChange={(type) => void setType(type)}
                options={TYPES.map((value) => ({ value, label: t(`newSession.type.${value}`) }))}
              />
            </Menu>
            {session.subject !== null && (
              // The cap replaces the Chip's own max-w-full (cn settles the two).
              <Chip
                lang={session.language}
                title={session.subject}
                className="ml-1 max-w-[200px] shrink-0"
              >
                {session.subject}
              </Chip>
            )}
          </>
        )}
        {!session && failed && (
          <h1 ref={heading} tabIndex={-1} className={cn(HEADING, 'text-smoke-text')}>
            {t('session.loadError')}
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <StatusPill
          source={session?.source ?? null}
          live={session?.source === 'paper' && paperLive}
          start={startedAt}
        />
        {session && live && <LanguageMenu session={session} />}
        {session && !live && (
          <span className="mono flex h-7 items-center rounded-pill bg-paper px-3 text-[11px] leading-[14px] text-ink shadow-[0_0_0_1px_var(--color-hairline)]">
            <span aria-hidden="true">{session.language}</span>
            <span className="sr-only">{t(`newSession.language.${session.language}`)}</span>
          </span>
        )}
        <span className="flex items-center gap-0.5">
          {/* Above where the chat sidebar opens. */}
          <ChatToggle />
          <SettingsButton />
        </span>
      </div>
    </AppFrame>
  );
}

/**
 * The source and the timer in one pill: "Desk View · Live · 04:12". The dot turns live red only
 * while something is really captured (P3's paper feed); otherwise it stays neutral and the label
 * doesn't claim "Live".
 */
function StatusPill({
  source,
  live,
  start,
}: {
  source: Source | null;
  live: boolean;
  start: Date;
}) {
  return (
    <span className="mono flex h-7 items-center gap-2 rounded-pill bg-paper px-3 text-[11px] leading-[14px] text-ink shadow-[0_0_0_1px_var(--color-hairline)]">
      {source && (
        <>
          <SourceLabel source={source} live={live} />
          <span aria-hidden="true" className="text-smoke">
            ·
          </span>
        </>
      )}
      <Timer start={start} />
    </span>
  );
}

/** About 30 ms a character (spec §5.1). */
const TYPE_MS = 30;

/**
 * A title that arrives while the screen is open types on, a character every 30 ms, and shows at
 * once under reduced motion. The title it opened with shows at once. The rest of the title is
 * laid out but invisible, so the strip doesn't shift, and the heading's name is always the whole
 * title (its aria-label).
 */
function TypedTitle({ title, opening }: { title: string; opening: string | null }) {
  const chars = Array.from(title);
  const [shown, setShown] = useState(() =>
    title === opening || prefersReducedMotion() ? chars.length : 0,
  );
  const first = useRef<string | null>(opening);
  // Before paint, so a new title never flashes whole first.
  useLayoutEffect(() => {
    if (title === first.current) return;
    first.current = title;
    const total = Array.from(title).length;
    if (prefersReducedMotion()) {
      setShown(total);
      return;
    }
    setShown(0);
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= total) clearInterval(timer);
    }, TYPE_MS);
    return () => clearInterval(timer);
  }, [title]);
  return (
    <>
      <span data-testid="title-typed">{chars.slice(0, shown).join('')}</span>
      <span aria-hidden="true" className="invisible">
        {chars.slice(shown).join('')}
      </span>
    </>
  );
}

/**
 * What Ada works from, beside its dot. The dot turns live red only while something is really
 * captured (P3's paper feed); otherwise it stays neutral and the label doesn't claim "Live".
 */
function SourceLabel({ source, live = false }: { source: Source; live?: boolean }) {
  const webcam = usePaperStore((state) => state.kind === 'webcam');
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn('size-[7px] rounded-pill', live ? 'bg-live' : 'bg-smoke')}
      />
      {source === 'paper' && webcam
        ? t(live ? 'paper.webcam.live' : 'paper.webcam.source')
        : live
          ? t(`session.liveSource.${source}`)
          : t(`session.source.${source}`)}
    </span>
  );
}

/** Its own component, so only the timer re-renders each second. Not a live region. */
function Timer({ start }: { start: Date }) {
  const { t } = useTranslation();
  const elapsed = useElapsed(start);
  return (
    <span
      role="timer"
      aria-label={t('session.timer', { elapsed })}
      className="text-smoke-text tabular-nums"
    >
      {elapsed}
    </span>
  );
}
