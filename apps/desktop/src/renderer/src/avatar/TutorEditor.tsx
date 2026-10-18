// Settings → Tutor: Ada's look, name and voice per language, on a draft with a live preview.
// Save stores it (and celebrates); Cancel goes back to what's saved.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { TabList, TabPanel, Tabs } from '../components/Tabs';
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
import { useAvatar } from './store';
import { type PreviewState, publicPreviewUrl, VoicePreviewPlayer } from './voice-preview';
import './avatar.css';

const SPARKS = Array.from({ length: 24 }, (_, i) => i * 15);

export interface TutorEditorProps {
  /** False once the view hides it: a playing preview stops. */
  open: boolean;
  /** After Cancel, or once a save's celebration ends. */
  onDone?(): void;
}

export function TutorEditor({ open, onDone }: TutorEditorProps) {
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
  const selectTab = (next: 'style' | 'body') => {
    player.stop();
    setTab(next);
  };
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
      timer.current = setTimeout(
        () => {
          saving.current = false;
          setSaved(false);
          onDone?.();
        },
        reduced ? 450 : 1200,
      );
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
          <ChevronLeft className="size-5" />
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
          <ChevronRight className="size-5" />
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
          <Tabs value={tab} onChange={selectTab}>
            <TabList<'style' | 'body'>
              label={t('avatar.tabs')}
              value={tab}
              onChange={selectTab}
              items={[
                { value: 'style', label: t('avatar.style') },
                { value: 'body', label: t('avatar.body') },
              ]}
            />
            <TabPanel value="style">
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
            </TabPanel>
            <TabPanel value="body">
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
                    !!voice && preview?.id === `${lang}:${voice.id}` && preview.status !== 'error';
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
                          className="h-10 w-full min-w-0 rounded-pill border border-hairline bg-bone px-3.5 text-sm text-ink"
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
            </TabPanel>
          </Tabs>
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
            setDraft({ ...useAvatar.getState().profile });
            onDone?.();
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
