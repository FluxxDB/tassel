// Settings → Privacy: delete everything, after a confirmation. Every session goes (the server
// deletes its board, chat and frames with it), and so do the preferences Ada remembers. Her
// tutor, her tutor style and these settings stay.
import { deleteSession, listSessions } from '@tassel/shared/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoute } from '../../../app/route-store';
import { Button } from '../../../components/Button';
import { Sheet } from '../../../components/Sheet';
import { useApi } from '../../../lib/api';
import { invalidateSessions } from '../../library/useSessions';
import { SettingsGroup } from '../SettingsView';

type Outcome = { kind: 'done'; count: number } | { kind: 'failed' } | null;

export function PrivacySection() {
  const { t } = useTranslation();
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const deleteAll = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const sessions = await listSessions(api, 'recent');
      await Promise.all(sessions.map((session) => deleteSession(api, session.id)));
      const { response } = await api.DELETE('/v1/learner/preferences');
      if (!response.ok) throw new Error(`preferences: ${response.status}`);
      invalidateSessions();
      setOutcome({ kind: 'done', count: sessions.length });
      // The open session, if any, is gone: back to the (now empty) library.
      if (useRoute.getState().route.name === 'session') useRoute.getState().goLibrary();
    } catch {
      setOutcome({ kind: 'failed' });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 max-w-[48ch] flex-col gap-1.5">
          <span className="text-sm font-w520">{t('settings.privacy.deleteAll')}</span>
          <p className="text-xs leading-relaxed text-smoke-text text-pretty">
            {t('settings.privacy.deleteAllHint')}
          </p>
        </div>
        <Button
          variant="ghost"
          className="shadow-[0_0_0_1px_var(--color-hairline)]"
          onClick={() => setConfirming(true)}
        >
          {t('settings.privacy.deleteAll')}
        </Button>
      </div>
      <p role="status" className="text-sm text-smoke-text empty:sr-only">
        {outcome?.kind === 'done' && t('settings.privacy.done', { count: outcome.count })}
        {outcome?.kind === 'failed' && t('settings.privacy.failed')}
      </p>
      <Sheet
        open={confirming}
        onOpenChange={(open) => !busy && setConfirming(open)}
        title={t('settings.privacy.confirmTitle')}
        description={t('settings.privacy.confirmBody')}
      >
        {/* Keep everything comes first, so it has focus when the sheet opens. */}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="lg" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="lg"
            busy={busy}
            busyLabel={t('settings.privacy.deleting')}
            onClick={() => void deleteAll()}
          >
            {t('settings.privacy.confirm')}
          </Button>
        </div>
      </Sheet>
    </SettingsGroup>
  );
}
