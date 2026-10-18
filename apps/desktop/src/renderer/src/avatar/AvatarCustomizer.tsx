import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { Avatar } from './Avatar';
import {
  ACCESSORIES,
  type AvatarProfile,
  COLORS,
  cycle,
  DEFAULT_AVATAR,
  FACES,
  HAIR,
  HAIR_COLORS,
  OUTFIT_COLORS,
  OUTFITS,
  SKINS,
  VOICES,
} from './catalog';
import { useAvatar } from './store';
import './avatar.css';

export function AvatarCustomizer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('avatar.title')}
      description={t('avatar.description')}
      className="avatar-customizer isolate max-w-[860px]"
    >
      {/* Sheet owns unmounting after its exit animation; keep the editor intact until then. */}
      <Editor onClose={() => onOpenChange(false)} />
    </Sheet>
  );
}
const SPARKS = Array.from({ length: 24 }, (_, i) => i * 15);

function Editor({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => ({ ...useAvatar.getState().profile }));
  const [tab, setTab] = useState<'style' | 'body'>('style');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const update = (key: keyof AvatarProfile, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = () => {
    if (saving.current) return;
    saving.current = true;
    try {
      useAvatar.getState().save(draft);
      setError(false);
      setSaved(true);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      timer.current = setTimeout(onClose, reduced ? 450 : 1200);
    } catch {
      saving.current = false;
      setError(true);
    }
  };
  const row = <K extends keyof AvatarProfile>(key: K, options: readonly AvatarProfile[K][]) => (
    <div
      key={key}
      className="flex items-center justify-between gap-3 border-b border-hairline py-3"
    >
      <span className="text-sm font-w520">{t(`avatar.fields.${key}`)}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="avatar-arrow"
          aria-label={t('avatar.previous', { part: t(`avatar.fields.${key}`) })}
          onClick={() => update(key, cycle(options, draft[key], -1))}
        >
          ‹
        </button>
        <span className="min-w-[100px] text-center text-[13px]" aria-live="polite">
          {t(`avatar.options.${draft[key]}`)}
        </span>
        <button
          type="button"
          className="avatar-arrow"
          aria-label={t('avatar.next', { part: t(`avatar.fields.${key}`) })}
          onClick={() => update(key, cycle(options, draft[key], 1))}
        >
          ›
        </button>
      </div>
    </div>
  );
  return (
    <>
      {saved && <div className="avatar-rainbow" aria-hidden="true" />}
      <fieldset
        disabled={saved}
        className="relative z-10 grid min-w-0 gap-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
      >
        <div className="flex min-w-0 flex-col items-center gap-3">
          <div
            className="avatar-preview relative flex w-full items-center justify-center overflow-hidden rounded-hero bg-blush"
            data-celebrating={saved}
            data-testid={saved ? 'avatar-celebration' : 'avatar-preview'}
          >
            <div className="avatar-halo" />
            <Avatar
              profile={draft}
              celebrating={saved}
              className="relative z-10 w-full max-w-[300px]"
            />
            {saved && (
              <div className="avatar-sparkles" aria-hidden="true">
                {SPARKS.map((angle) => (
                  <span
                    key={angle}
                    style={
                      {
                        '--i': angle / 15,
                        '--angle': `${angle}deg`,
                        '--spark-color': `hsl(${angle + 15} 90% 60%)`,
                      } as React.CSSProperties
                    }
                  >
                    ✦
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-lg font-w520 truncate max-w-full">{draft.name.trim() || 'Ada'}</p>
          <p className="text-center text-[13px] text-smoke-text">{t('avatar.previewHint')}</p>
        </div>
        <div className="min-w-0">
          <label className="block text-sm font-w520">
            {t('avatar.name')}
            <input
              value={draft.name}
              maxLength={30}
              onChange={(event) => update('name', event.target.value)}
              className="mt-2 mb-4 w-full rounded-input border border-hairline bg-paper px-3 py-2 font-normal"
            />
          </label>
          <div
            role="tablist"
            aria-label={t('avatar.tabs')}
            className="flex gap-2 border-b border-hairline pb-2"
          >
            {(['style', 'body'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                aria-controls={`avatar-panel-${value}`}
                id={`avatar-tab-${value}`}
                onClick={() => setTab(value)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'style'
                      : event.key === 'End'
                        ? 'body'
                        : value === 'style'
                          ? 'body'
                          : 'style';
                  setTab(next);
                  document.getElementById(`avatar-tab-${next}`)?.focus();
                }}
                className={`rounded-pill px-4 py-2 text-sm ${tab === value ? 'bg-ink text-paper' : 'bg-transparent text-ink'}`}
              >
                {t(`avatar.${value}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`avatar-panel-${tab}`} aria-labelledby={`avatar-tab-${tab}`}>
            {tab === 'style' ? (
              <>
                {row('hair', HAIR)}
                {row('hairColor', HAIR_COLORS)}
                {row('outfit', OUTFITS)}
                {row('outfitColor', OUTFIT_COLORS)}
                {row('accessory', ACCESSORIES)}
              </>
            ) : (
              <>
                <fieldset className="py-5">
                  <legend className="pt-4 text-sm font-w520">{t('avatar.skin')}</legend>
                  <div className="grid grid-cols-4 gap-3">
                    {SKINS.map((skin, index) => (
                      <button
                        key={skin}
                        type="button"
                        aria-label={t('avatar.skinTone', { number: index + 1 })}
                        aria-pressed={draft.skin === skin}
                        onClick={() => update('skin', skin)}
                        className="avatar-swatch"
                        style={{ backgroundColor: COLORS.skin[skin] }}
                      >
                        {draft.skin === skin && (
                          <span
                            aria-hidden="true"
                            className="rounded-full bg-paper text-ink px-1 text-sm"
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {row('face', FACES)}
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-smoke-text">
            <label htmlFor="avatar-voice">{t('avatar.voice')}</label>
            <select
              id="avatar-voice"
              value={draft.voice}
              onChange={(event) => update('voice', event.target.value)}
              className="rounded-input border border-hairline bg-paper p-2 text-ink"
            >
              {VOICES.map((voice) => (
                <option key={voice} value={voice}>
                  {t(`avatar.options.${voice}`)}
                </option>
              ))}
            </select>
            <span>{t('avatar.voicePlaceholder')}</span>
          </div>
        </div>
      </fieldset>
      <div className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-hairline bg-paper py-4">
        <Button variant="ghost" disabled={saved} onClick={() => setDraft({ ...DEFAULT_AVATAR })}>
          {t('avatar.reset')}
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" disabled={saved} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button disabled={saved} onClick={save}>
          {saved ? t('avatar.saved') : t('avatar.save')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {t('avatar.saveError')}
        </p>
      )}
      <p role="status" className="sr-only">
        {saved ? t('avatar.saved') : ''}
      </p>
    </>
  );
}
