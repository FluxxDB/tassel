import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { SegmentedControl } from '../components/SegmentedControl';
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
  HAT_COLORS,
  HATS,
  OUTFIT_COLORS,
  OUTFITS,
  SKINS,
  VOICE_FIELDS,
  VOICE_LANGUAGES,
  VOICES,
} from './catalog';
import { MemoryPanel } from './MemoryPanel';
import { PersonalityPanel } from './PersonalityPanel';
import { useAvatar } from './store';
import { type PreviewState, publicPreviewUrl, VoicePreviewPlayer } from './voice-preview';
import './avatar.css';

export function AvatarCustomizer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<'appearance' | 'memory'>('appearance');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('memory.settingsTitle')}
      description={t('memory.settingsDescription')}
      className="avatar-customizer isolate max-w-[860px]"
    >
      {/* Sheet owns unmounting after its exit animation; keep the editor intact until then. */}
      <SegmentedControl<'appearance' | 'memory'>
        label={t('memory.settingsTitle')}
        value={section}
        onChange={(next) => {
          if (open) setSection(next);
        }}
        options={[
          { value: 'appearance', label: t('memory.appearance') },
          { value: 'memory', label: t('memory.personalizationTitle') },
        ]}
      />
      {section === 'appearance' ? (
        <Editor open={open} onClose={() => onOpenChange(false)} />
      ) : (
        <div className="flex flex-col gap-6">
          <PersonalityPanel open={open} />
          <div className="border-t border-hairline pt-6">
            <MemoryPanel open={open} />
          </div>
        </div>
      )}
    </Sheet>
  );
}
const SPARKS = Array.from({ length: 24 }, (_, i) => i * 15);

function Editor({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => ({ ...useAvatar.getState().profile }));
  const [tab, setTab] = useState<'style' | 'body'>('style');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [player] = useState(() => new VoicePreviewPlayer(setPreview));
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => {
    if (!open) player.stop();
  }, [open, player]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const update = (key: keyof AvatarProfile, value: string) => {
    player.stop();
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const save = () => {
    player.stop();
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
                onClick={() => {
                  player.stop();
                  setTab(value);
                }}
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
                  player.stop();
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
                {row('hat', HATS)}
                <div
                  className="avatar-hat-colors"
                  data-expanded={draft.hat !== 'none'}
                  aria-hidden={draft.hat === 'none'}
                  inert={draft.hat === 'none'}
                >
                  <div className="min-h-0 overflow-hidden">
                    <fieldset className="ml-4 border-l border-hairline py-3 pl-4">
                      <legend className="text-xs text-smoke-text">
                        {t('avatar.fields.hatColor')}
                      </legend>
                      <div className="flex flex-wrap gap-2 pt-2">
                        {HAT_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className="avatar-hat-swatch"
                            aria-label={`${t('avatar.fields.hatColor')}: ${t(`avatar.options.${color}`)}`}
                            title={t(`avatar.options.${color}`)}
                            aria-pressed={draft.hatColor === color}
                            onClick={() => update('hatColor', color)}
                            style={{ backgroundColor: COLORS.hair[color] }}
                          >
                            {draft.hatColor === color && (
                              <span
                                aria-hidden="true"
                                className="rounded-full bg-paper px-1 text-xs text-ink"
                              >
                                ✓
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                </div>
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
                <fieldset className="mt-4 flex min-w-0 flex-col gap-3">
                  <legend className="mb-2 text-sm font-w520">{t('avatar.voice')}</legend>
                  {VOICE_LANGUAGES.map((lang) => {
                    const voice = VOICES.find(
                      (item) => item.id === draft[VOICE_FIELDS[lang]] && item.language === lang,
                    );
                    const active =
                      !!voice &&
                      preview?.id === `${lang}:${voice.id}` &&
                      preview.status !== 'error';
                    return (
                      <div key={lang} className="flex min-w-0 flex-col gap-1 text-[13px]">
                        <label htmlFor={`avatar-voice-${lang}`}>
                          {t(`avatar.voiceLanguages.${lang}`)}
                        </label>
                        <div className="flex min-w-0 gap-2">
                          <select
                            id={`avatar-voice-${lang}`}
                            value={draft[VOICE_FIELDS[lang]]}
                            onChange={(event) => update(VOICE_FIELDS[lang], event.target.value)}
                            className="w-full min-w-0 rounded-input border border-hairline bg-paper p-2 text-ink"
                          >
                            <option value="off">{t('avatar.voiceOff')}</option>
                            {VOICES.filter((item) => item.language === lang).map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} · {item.accent}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            disabled={!voice || !publicPreviewUrl(voice.previewUrl)}
                            aria-label={t(active ? 'avatar.stopPreview' : 'avatar.playPreview', {
                              language: t(`avatar.voiceLanguages.${lang}`),
                            })}
                            onClick={() => {
                              if (active) player.stop();
                              else if (voice)
                                void player.play(`${lang}:${voice.id}`, voice.previewUrl);
                            }}
                          >
                            {t(active ? 'avatar.stop' : 'avatar.play')}
                          </Button>
                        </div>
                        {voice &&
                          (!publicPreviewUrl(voice.previewUrl) ||
                            (preview?.id === `${lang}:${voice.id}` &&
                              preview.status === 'error')) && (
                            <p role="status">{t('avatar.previewUnavailable')}</p>
                          )}
                      </div>
                    );
                  })}
                  <p className="text-[13px] text-smoke-text">{t('avatar.voiceDisabled')}</p>
                  <p className="text-[12px] text-smoke-text">{t('avatar.voiceLibraryNote')}</p>
                </fieldset>
              </>
            )}
          </div>
        </div>
      </fieldset>
      <div className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-hairline bg-paper py-4">
        <Button
          variant="ghost"
          disabled={saved}
          onClick={() => {
            player.stop();
            setDraft({ ...DEFAULT_AVATAR });
          }}
        >
          {t('avatar.reset')}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          disabled={saved}
          onClick={() => {
            player.stop();
            onClose();
          }}
        >
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
