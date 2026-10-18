// The dock: a white pill at the bottom center holding the session's controls. Mic (with its
// level meter), Audio settings in a live voice session, Camera, Share, the Board control,
// Captions, and End session, its primary action.
import { type Ref, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import {
  Board,
  Camera,
  Captions as CaptionsIcon,
  Mic,
  MicOff,
  Screen,
  Sliders,
} from '../../components/icons';
import { cn } from '../../lib/cn';
import { screenActions, useScreen } from '../../screen/store';
import { AudioSettings } from '../voice/AudioSettings';
import { useAudioPrefs } from '../voice/audio-prefs';
import { type LiveMic, useLiveVoice } from '../voice/live-voice';
import { SHORTCUT_KEYS } from './shortcuts';
import { cycleBoardView, useStageStore } from './stage-store';

export interface DockProps {
  onEnd(): void;
  /** The Board control, which Unpin hands focus to (see Stage). */
  boardRef?: Ref<HTMLButtonElement>;
}

export function Dock({ onEnd, boardRef }: DockProps) {
  const { t } = useTranslation();
  const sharing = useScreen((state) => state.selected !== null);
  const { micOn, cameraOn, captionsOn, pinned, toggleMic, toggleCamera, toggleCaptions } =
    useStageStore(
      useShallow((state) => ({
        micOn: state.micOn,
        cameraOn: state.cameraOn,
        captionsOn: state.captionsOn,
        pinned: state.pinned,
        toggleMic: state.toggleMic,
        toggleCamera: state.toggleCamera,
        toggleCaptions: state.toggleCaptions,
      })),
    );
  const live = useLiveVoice((state) => state.live);
  const held = useLiveVoice((state) => state.held);
  const pushToTalk = useAudioPrefs((state) => state.pushToTalk);
  const [audioOpen, setAudioOpen] = useState(false);
  // Under push-to-talk, the unmuted mic says how to talk and shows the hold; muted, it is P1's
  // microphone toggle, off.
  const holding = live && pushToTalk && micOn;
  const micLabel = holding ? t('voice.mic.holdSpace') : t('session.dock.mic');
  const withKey = (label: string, key: string) => t('session.dock.withShortcut', { label, key });
  // The Board control's name states where it is in its cycle (R17), so it has no aria-pressed;
  // it looks pressed while a view is pinned.
  const board = pinned
    ? t('session.dock.boardPinned', { view: t(`session.stage.${pinned}`) })
    : t('session.dock.boardFollow');

  return (
    // A fieldset: one named group of controls.
    <fieldset
      aria-label={t('session.dock.label')}
      data-testid="dock"
      className="absolute bottom-[22px] left-[calc((100%-var(--chat-cover,0px))/2)] z-20 m-0 flex min-w-0 -translate-x-1/2 items-center gap-1.5 rounded-pill border-0 bg-paper p-2 shadow-[0_0_0_1px_var(--color-hairline)]"
    >
      <IconButton
        label={micLabel}
        pressed={holding ? held : micOn}
        onClick={toggleMic}
        title={withKey(t('session.dock.mic'), SHORTCUT_KEYS.mic)}
        aria-keyshortcuts={SHORTCUT_KEYS.mic}
      >
        {micOn ? <Mic /> : <MicOff />}
      </IconButton>
      <LevelMeter on={micOn} />
      {live && (
        <AudioSettings
          open={audioOpen}
          onOpenChange={setAudioOpen}
          trigger={
            <IconButton label={t('voice.settings.open')} title={t('voice.settings.open')}>
              <Sliders />
            </IconButton>
          }
        />
      )}
      <IconButton
        label={t('session.dock.camera')}
        disabled={sharing}
        pressed={cameraOn}
        onClick={toggleCamera}
        title={t('session.dock.camera')}
      >
        <Camera />
      </IconButton>

      <IconButton
        label={t(sharing ? 'screen.stop' : 'session.dock.share')}
        pressed={sharing}
        onClick={() => void (sharing ? screenActions()?.stop() : screenActions()?.choose())}
        title={t(sharing ? 'screen.stop' : 'session.dock.share')}
      >
        <Screen />
      </IconButton>
      {sharing && (
        <IconButton
          label={t('screen.collapse')}
          title={t('screen.collapse')}
          onClick={() => void screenActions()?.collapse()}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M5 18h14" />
          </svg>
        </IconButton>
      )}
      <IconButton
        ref={boardRef}
        label={board}
        active={pinned !== null}
        onClick={cycleBoardView}
        title={withKey(board, SHORTCUT_KEYS.board)}
        aria-keyshortcuts={SHORTCUT_KEYS.board}
      >
        <Board />
      </IconButton>
      <IconButton
        label={t('session.dock.captions')}
        pressed={captionsOn}
        onClick={toggleCaptions}
        title={withKey(t('session.dock.captions'), SHORTCUT_KEYS.captions)}
        aria-keyshortcuts={SHORTCUT_KEYS.captions}
      >
        <CaptionsIcon />
      </IconButton>
      <span aria-hidden="true" className="mx-1 h-7 w-px bg-hairline" />
      <Button size="lg" onClick={onEnd}>
        {t('session.dock.end')}
      </Button>
    </fieldset>
  );
}

/** Each bar's share of the level: the middle one reaches full height first. */
const BARS = [0.55, 0.8, 1, 0.8, 0.55] as const;
/** Speech is quiet as RMS goes: about 0.25 RMS fills the meter. */
const GAIN = 4;
const FRAME_MS = 1000 / 30;

/**
 * The mic's level: five bars, from the live mic, at most 30 times a second. With no live mic
 * (the scripted tutor) they lie flat at their floor rather than fake a signal, and they hide
 * while the mic is off. Under reduced motion they still move, without easing.
 */
function LevelMeter({ on }: { on: boolean }) {
  const mic = useLiveVoice((state) => state.mic);
  const level = useMicLevel(on ? mic : null);
  return (
    <span
      aria-hidden="true"
      data-testid="mic-level"
      data-level={Math.round(level * 100)}
      className={`mr-1.5 ml-0.5 flex h-[18px] items-end gap-0.5 ${on ? 'visible' : 'invisible'}`}
    >
      {BARS.map((share, bar) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: five fixed bars
          key={bar}
          style={{ height: `${6 + 12 * Math.min(1, level * share * 1.25)}px` }}
          className={cn(
            'w-[3px] rounded-[2px] bg-ink',
            'motion-safe:transition-[height] motion-safe:duration-75 motion-safe:ease-out',
          )}
        />
      ))}
    </span>
  );
}

function useMicLevel(mic: LiveMic | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!mic) {
      setLevel(0);
      return;
    }
    let frame = 0;
    let last = Number.NEGATIVE_INFINITY;
    const tick = (now: number) => {
      if (now - last >= FRAME_MS - 1) {
        last = now;
        // Twentieths, so a steady level doesn't re-render.
        setLevel(Math.round(Math.min(1, mic.level() * GAIN) * 20) / 20);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mic]);
  return level;
}
