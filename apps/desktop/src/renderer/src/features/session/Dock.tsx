// The dock: a white pill at the bottom center holding the session's controls. Mic (with its
// level meter), Camera, Share, the Board control, Captions, and End session, its primary action.
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
} from '../../components/icons';
import { SHORTCUT_KEYS } from './shortcuts';
import { cycleBoardView, useStageStore } from './stage-store';

export function Dock({ onEnd }: { onEnd(): void }) {
  const { t } = useTranslation();
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
      className="absolute bottom-[22px] left-1/2 z-20 m-0 flex min-w-0 -translate-x-1/2 items-center gap-1.5 rounded-pill border-0 bg-paper p-2 shadow-[0_0_0_1px_var(--color-hairline)]"
    >
      <IconButton
        label={t('session.dock.mic')}
        pressed={micOn}
        onClick={toggleMic}
        title={withKey(t('session.dock.mic'), SHORTCUT_KEYS.mic)}
        aria-keyshortcuts={SHORTCUT_KEYS.mic}
      >
        {micOn ? <Mic /> : <MicOff />}
      </IconButton>
      <LevelMeter on={micOn} />
      <IconButton label={t('session.dock.camera')} pressed={cameraOn} onClick={toggleCamera}>
        <Camera />
      </IconButton>
      {/* Visible but unavailable until screen sharing lands (R18). */}
      <IconButton
        label={t('session.dock.share')}
        aria-disabled
        title={t('session.dock.shareLater')}
      >
        <Screen />
      </IconButton>
      <IconButton
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

/**
 * The mic's level: five bars. P1 hears nothing, so they lie flat at their floor rather than fake
 * a signal, and hide while the mic is off.
 */
function LevelMeter({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mr-1.5 ml-0.5 flex h-[18px] items-end gap-0.5 ${on ? 'visible' : 'invisible'}`}
    >
      {[1, 2, 3, 4, 5].map((bar) => (
        <span key={bar} className="h-1.5 w-[3px] rounded-[2px] bg-ink" />
      ))}
    </span>
  );
}
