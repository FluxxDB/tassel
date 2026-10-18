import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { useApi } from '../lib/api';

type Memory = { enabled: boolean; content: string; revision: number };

export function MemoryPanel({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const [memory, setMemory] = useState<Memory | null>(null);
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
    setMemory(null);
    setStatus('');
    void api
      .GET('/v1/learner/memory')
      .then(({ data }) => {
        if (!active) return;
        if (!data) throw new Error('unavailable');
        setMemory(data);
        setContent(data.content);
      })
      .catch(() => {
        if (active) setStatus(t('memory.loadError'));
      });
    return () => {
      active = false;
    };
  }, [api, t, retry, open]);

  async function save(nextContent: string, enabled: boolean) {
    if (!memory || busy || !visible.current) return;
    setBusy(true);
    setStatus('');
    try {
      const { data, response } = await api.PATCH('/v1/learner/memory', {
        body: { content: nextContent, enabled, revision: memory.revision },
      });
      if (!visible.current) return;
      if (!data) {
        setStatus(t(response.status === 409 ? 'memory.conflict' : 'memory.saveError'));
        return;
      }
      setMemory(data);
      setContent(data.content);
      setStatus(t('memory.saved'));
    } catch {
      if (visible.current) setStatus(t('memory.saveError'));
    } finally {
      if (visible.current) setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-label={t('memory.title')} aria-busy={!memory}>
      <label className="flex items-center justify-between gap-4 text-sm font-w520">
        {t('memory.enabled')}
        <input
          type="checkbox"
          role="switch"
          aria-checked={memory?.enabled ?? true}
          checked={memory?.enabled ?? true}
          disabled={busy || !memory}
          onChange={(event) => void save(content, event.target.checked)}
        />
      </label>
      <p className="text-sm text-smoke-text">{t('memory.description')}</p>
      <label className="flex flex-col gap-2 text-sm font-w520">
        {t('memory.notes')}
        <textarea
          className="min-h-60 w-full resize-y rounded-xl border border-hairline bg-paper p-4 text-sm font-normal"
          value={content}
          maxLength={6000}
          disabled={busy || !memory}
          placeholder={t(memory ? 'memory.empty' : 'memory.loading')}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy || !memory || content === memory.content}
          onClick={() => memory && void save(content, memory.enabled)}
        >
          {t('memory.save')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !memory || (!memory.content && !content)}
          onClick={() => memory && void save('', memory.enabled)}
        >
          {t('memory.clear')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setRetry((n) => n + 1)}>
          {t('memory.reload')}
        </Button>
      </div>
      <p role="status" className="min-h-5 text-sm text-smoke-text">
        {status}
      </p>
    </section>
  );
}
