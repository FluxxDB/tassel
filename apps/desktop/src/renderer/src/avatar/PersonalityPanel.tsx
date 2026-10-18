import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { useApi } from '../lib/api';

type Personalization = { enabled: boolean; content: string; revision: number };

export function PersonalityPanel({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const [personalization, setPersonalization] = useState<Personalization | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState(0);
  const visible = useRef(open);
  useEffect(() => {
    visible.current = open;
    return () => {
      visible.current = false;
    };
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads server notes.
  useEffect(() => {
    // Keep the last rendered contents intact until Radix finishes the exit animation.
    if (!open) return;
    let active = true;
    setPersonalization(null);
    setStatus('');
    void api
      .GET('/v1/learner/personalization')
      .then(({ data }) => {
        if (!active) return;
        if (!data) throw new Error('unavailable');
        setPersonalization(data);
        setContent(data.content);
      })
      .catch(() => {
        if (active) setStatus(t('personalization.loadError'));
      });
    return () => {
      active = false;
    };
  }, [api, t, retry, open]);

  async function save(nextContent: string, enabled: boolean) {
    if (!personalization || busy || !visible.current) return;
    setBusy(true);
    setStatus('');
    try {
      const { data, response } = await api.PATCH('/v1/learner/personalization', {
        body: { content: nextContent, enabled, revision: personalization.revision },
      });
      if (!visible.current) return;
      if (!data) {
        setStatus(
          t(response.status === 409 ? 'personalization.conflict' : 'personalization.saveError'),
        );
        return;
      }
      setPersonalization(data);
      setContent(data.content);
      setStatus(t('personalization.saved'));
    } catch {
      if (visible.current) setStatus(t('personalization.saveError'));
    } finally {
      if (visible.current) setBusy(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-5"
      aria-label={t('personalization.title')}
      aria-busy={!personalization}
    >
      <h3 className="text-lg font-w520">{t('personalization.title')}</h3>
      <label className="flex items-center justify-between gap-4 text-sm font-w520">
        {t('personalization.enabled')}
        <input
          type="checkbox"
          role="switch"
          aria-checked={personalization?.enabled ?? true}
          checked={personalization?.enabled ?? true}
          disabled={busy || !personalization}
          onChange={(event) => void save(content, event.target.checked)}
        />
      </label>
      <p className="text-sm text-smoke-text">{t('personalization.description')}</p>
      <label className="flex flex-col gap-2 text-sm font-w520">
        {t('personalization.notes')}
        <textarea
          className="min-h-36 w-full resize-y rounded-xl border border-hairline bg-paper p-4 text-sm font-normal"
          value={content}
          maxLength={2000}
          disabled={busy || !personalization}
          placeholder={t(personalization ? 'personalization.empty' : 'personalization.loading')}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy || !personalization || content === personalization.content}
          onClick={() => personalization && void save(content, personalization.enabled)}
        >
          {t('personalization.save')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !personalization || (!personalization.content && !content)}
          onClick={() => personalization && void save('', personalization.enabled)}
        >
          {t('personalization.clear')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setRetry((n) => n + 1)}>
          {t('personalization.reload')}
        </Button>
      </div>
      <p role="status" className="text-sm text-smoke-text empty:sr-only">
        {status}
      </p>
    </section>
  );
}
