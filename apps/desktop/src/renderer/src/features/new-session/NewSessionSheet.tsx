// The new session sheet: what kind of session, in which language, and how she'll work with Ada.
// Start creates the session and opens it.
import {
  ApiError,
  createSession,
  deleteSession,
  type SessionType,
  type Source,
  UnauthorizedError,
} from '@tassel/shared/api';
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Platform } from '../../../../shared/bridge';
import { useRoute } from '../../app/route-store';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Sheet } from '../../components/Sheet';
import { useApi } from '../../lib/api';
import { getPaperConfig } from '../../paper/paper-config';
import { defaultSource, paperUnavailable } from './defaults';

const TYPES: readonly SessionType[] = ['homework', 'studying', 'research', 'other'];
const SOURCES: readonly Source[] = ['paper', 'screen', 'talk'];

type ErrorKey = 'errors.network' | 'errors.server' | 'errors.unknown';

export interface NewSessionSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Defaults to the preload bridge's platform. */
  platform?: Platform;
  /** Whether this run plays the fake clip as her paper (R11); defaults to the paper config's. */
  paperFakeClip?: boolean;
  paperWebcam?: boolean;
}

export function NewSessionSheet({
  open,
  onOpenChange,
  platform = window.tassel.platform,
  paperFakeClip = getPaperConfig().fakeClip,
  paperWebcam = getPaperConfig().source === 'webcam',
}: NewSessionSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('newSession.title')}>
      {/* Mounted only while open, so every opening starts from the defaults. */}
      <NewSessionForm
        open={open}
        platform={platform}
        paperFakeClip={paperFakeClip}
        paperWebcam={paperWebcam}
        onCancel={() => onOpenChange(false)}
        onStarted={() => onOpenChange(false)}
      />
    </Sheet>
  );
}

function NewSessionForm({
  open,
  platform,
  paperFakeClip,
  paperWebcam,
  onCancel,
  onStarted,
}: {
  open: boolean;
  platform: Platform;
  paperFakeClip: boolean;
  paperWebcam: boolean;
  onCancel(): void;
  onStarted(): void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const openSession = useRoute((state) => state.openSession);
  const noticeId = useId();
  const [type, setType] = useState<SessionType>('homework');
  const [language, setLanguage] = useState<Lang>(i18n.language as Lang);
  const [source, setSource] = useState<Source>(() => defaultSource(platform));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const windows = platform === 'win32';
  // The ref, not the state, guards Start: a second click can land before React re-renders.
  const starting = useRef(false);
  // She can close the sheet while Start runs (a hung server mustn't trap her). The sheet stays
  // mounted while it animates out, so `open`, not unmounting, says she has moved on.
  const stillOpen = useRef(open);
  stillOpen.current = open;
  useEffect(
    () => () => {
      starting.current = false;
    },
    [],
  );

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(api, { type, language, source });
      if (!stillOpen.current) {
        // Closed meanwhile: she changed her mind, so the session doesn't open, and doesn't stay
        // behind unseen in her library either.
        deleteSession(api, session.id).catch(() => {});
        return;
      }
      onStarted();
      openSession(session.id);
    } catch (failure) {
      if (!stillOpen.current) return;
      setBusy(false);
      setError(errorKey(failure));
    } finally {
      starting.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <Choice legend={t('newSession.groups.type')}>
          <SegmentedControl<SessionType>
            label={t('newSession.groups.type')}
            options={TYPES.map((value) => ({ value, label: t(`newSession.type.${value}`) }))}
            value={type}
            onChange={setType}
          />
        </Choice>
        <Choice legend={t('newSession.groups.language')}>
          <SegmentedControl<Lang>
            label={t('newSession.groups.language')}
            // Each language is named in itself, so each label carries its own lang.
            options={SUPPORTED_LANGS.map((value) => ({
              value,
              label: t(`newSession.language.${value}`),
              lang: value,
            }))}
            value={language}
            onChange={setLanguage}
          />
        </Choice>
        <Choice legend={t('newSession.groups.source')}>
          <SegmentedControl<Source>
            label={t('newSession.groups.source')}
            options={SOURCES.map((value) => ({
              value,
              label:
                value === 'paper' && paperWebcam
                  ? t('paper.webcam.choice')
                  : t(`newSession.source.${value}`),
              disabled: value === 'paper' && paperUnavailable(platform, paperFakeClip, paperWebcam),
            }))}
            value={source}
            onChange={setSource}
            describedBy={windows ? noticeId : undefined}
          />
          {windows && (
            <p id={noticeId} className="mt-2 text-[13px] text-smoke-text text-pretty">
              {t(paperWebcam ? 'paper.webcam.hint' : 'platform.windowsNoDeskView')}
            </p>
          )}
        </Choice>
      </div>
      <div className="flex items-center gap-3">
        {/* Next to Start, in ink: the sheet stays open so she can try again. */}
        <div className="min-w-0 flex-1">
          {error && (
            <p role="alert" className="text-[13px] leading-snug text-ink text-pretty">
              {t(error)}
            </p>
          )}
        </div>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="lg" busy={busy} busyLabel={t('newSession.starting')} onClick={start}>
          {t('newSession.start')}
        </Button>
      </div>
    </div>
  );
}

/** One labeled choice: a fieldset whose legend names the control under it. */
function Choice({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2.5 text-[14px] leading-5 font-w520 text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** Which catalog line explains a failed Start. */
function errorKey(error: unknown): ErrorKey {
  if (error instanceof ApiError) return error.status >= 500 ? 'errors.server' : 'errors.unknown';
  if (error instanceof UnauthorizedError) return 'errors.unknown';
  // A fetch that never reached the server, or a device that couldn't register with it.
  return 'errors.network';
}
