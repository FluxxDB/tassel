// Settings → Memory: the preferences Ada keeps between sessions (/v1/learner/preferences), one
// per line: tone, pace, language, how she likes hints. Nothing from a session's content carries
// over. She can turn memory off, edit the lines (one per line in a text field), or delete them
// all after a confirmation. A save made from a stale copy is refused (409) and says to reload.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { SettingSwitch } from '../components/SettingSwitch';
import { Sheet } from '../components/Sheet';
import { useApi } from '../lib/api';

type Preferences = { enabled: boolean; lines: string[]; revision: number };

/** The text field's lines, trimmed, without blanks. */
function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function MemoryPanel({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads them.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPrefs(null);
    setEditing(false);
    setStatus('');
    void api
      .GET('/v1/learner/preferences')
      .then(({ data }) => {
        if (!active) return;
        if (!data) throw new Error('unavailable');
        setPrefs(data);
      })
      .catch(() => {
        if (active) setStatus(t('memory.loadError'));
      });
    return () => {
      active = false;
    };
  }, [api, t, retry, open]);

  async function save(lines: string[], enabled: boolean) {
    if (!prefs || busy || !visible.current) return;
    setBusy(true);
    setStatus('');
    try {
      const { data, response } = await api.PATCH('/v1/learner/preferences', {
        body: { lines, enabled, revision: prefs.revision },
      });
      if (!visible.current) return;
      if (!data) {
        setStatus(t(response.status === 409 ? 'memory.conflict' : 'memory.saveError'));
        return;
      }
      setPrefs(data);
      setEditing(false);
      setStatus(t('memory.saved'));
    } catch {
      if (visible.current) setStatus(t('memory.saveError'));
    } finally {
      if (visible.current) setBusy(false);
    }
  }

  async function deleteAll() {
    if (!prefs || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const { response } = await api.DELETE('/v1/learner/preferences');
      if (!visible.current) return;
      if (!response.ok) {
        setStatus(t('memory.saveError'));
        return;
      }
      setPrefs({ ...prefs, lines: [] });
      setEditing(false);
      setConfirming(false);
      setStatus(t('memory.deleted'));
      // The revision moved on the server: take its copy, so the next save isn't refused.
      const { data } = await api.GET('/v1/learner/preferences');
      if (data && visible.current) setPrefs(data);
    } catch {
      if (visible.current) setStatus(t('memory.saveError'));
    } finally {
      if (visible.current) setBusy(false);
    }
  }

  const lines = prefs?.lines ?? [];
  return (
    <section className="flex flex-col gap-5" aria-label={t('memory.title')} aria-busy={!prefs}>
      <SettingSwitch
        label={t('memory.enabled')}
        hint={t('memory.description')}
        checked={prefs?.enabled ?? true}
        disabled={busy || !prefs}
        onChange={(enabled) => void save(lines, enabled)}
      />
      <div className="flex flex-col gap-2.5 border-t border-hairline pt-5">
        <h3 className="text-sm font-w520">{t('memory.notes')}</h3>
        {editing ? (
          <label className="flex flex-col gap-2 text-xs text-smoke-text">
            {t('memory.editHint')}
            <textarea
              className="min-h-44 w-full resize-y rounded-card-sm border border-hairline bg-paper p-3.5 text-sm leading-[21px] text-ink"
              name="preferences"
              autoComplete="off"
              value={draft}
              maxLength={6000}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        ) : lines.length > 0 ? (
          <ul className="flex flex-col">
            {lines.map((line, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: lines can repeat; order is stable.
                key={index}
                className="border-b border-hairline py-2.5 text-sm leading-[21px] text-ink break-words last:border-b-0"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-card-sm bg-bone px-4 py-3.5 text-sm leading-[21px] text-smoke-text text-pretty">
            {prefs ? t('memory.empty') : t('memory.loading')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button
              disabled={busy}
              onClick={() => void save(linesOf(draft), prefs?.enabled ?? true)}
            >
              {t('memory.save')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="shadow-[0_0_0_1px_var(--color-hairline)]"
              disabled={busy || !prefs}
              onClick={() => {
                setDraft(lines.join('\n'));
                setEditing(true);
              }}
            >
              {t('memory.edit')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !prefs || lines.length === 0}
              onClick={() => setConfirming(true)}
            >
              {t('memory.clear')}
            </Button>
            {!prefs && (
              <Button variant="ghost" disabled={busy} onClick={() => setRetry((n) => n + 1)}>
                {t('memory.reload')}
              </Button>
            )}
          </>
        )}
      </div>
      <p role="status" className="text-sm text-smoke-text empty:sr-only">
        {status}
      </p>
      <Sheet
        open={confirming}
        onOpenChange={(next) => !busy && setConfirming(next)}
        title={t('memory.confirmTitle')}
        description={t('memory.confirmBody')}
      >
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="lg" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="lg"
            busy={busy}
            busyLabel={t('memory.deleting')}
            onClick={() => void deleteAll()}
          >
            {t('memory.clear')}
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
