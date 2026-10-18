// The student's board camera: zoom out, zoom in and Fit, then Download board (the whole board as
// a PNG, download.ts), in the board panel's top line right after its tag (Stage.tsx), so they
// never sit under the captions or a floating tile. They show once the board's engine offers a
// camera; the board panel hands it over (useBoardCamera).
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { Download } from '../components/icons';
import { cn } from '../lib/cn';
import { useBoardStore } from './board-store';
import { downloadBoardPng } from './download';
import type { BoardEngine } from './engine';
import { useSessionLang } from './use-session-lang';

export const useBoardCamera: UseBoundStore<StoreApi<{ camera: BoardEngine['camera'] }>> = create<{
  camera: BoardEngine['camera'];
}>()(() => ({ camera: undefined }));

// 24px tall: WCAG 2.2's minimum target, inside the 26px pill.
const PILL_BUTTON =
  'h-6 min-w-6 rounded-pill px-2.5 text-[13px] leading-6 font-w520 whitespace-nowrap transition-[background-color,color] duration-[120ms] hover:bg-bone';

export function BoardCameraControls(): JSX.Element | null {
  const { t } = useTranslation();
  const lang = useSessionLang();
  const camera = useBoardCamera((state) => state.camera);
  // Ada's items: with none, there's no board to save yet, and the button says so.
  const drawn = useBoardStore((state) => state.scene.items.length > 0);
  if (!camera) return null;
  const downloadTitle = t(drawn ? 'board.camera.download' : 'board.camera.downloadEmpty', {
    lng: lang,
  });
  return (
    <fieldset
      aria-label={t('board.camera.label', { lng: lang })}
      className="pointer-events-auto m-0 flex h-[26px] min-w-0 items-center gap-px rounded-pill border-0 bg-paper p-px text-ink shadow-[0_0_0_1px_var(--color-hairline)]"
    >
      {(['out', 'in', 'fit'] as const).map((action) => (
        <button
          key={action}
          type="button"
          aria-label={t(`board.camera.${action}`, { lng: lang })}
          title={t(`board.camera.${action}`, { lng: lang })}
          className={PILL_BUTTON}
          onClick={() => (action === 'fit' ? camera.fit() : camera.zoom(action))}
        >
          {action === 'in' ? '+' : action === 'out' ? '−' : t('board.camera.fit', { lng: lang })}
        </button>
      ))}
      {/* A hairline between the camera and the download: a different kind of action. */}
      <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-hairline" />
      <button
        type="button"
        aria-label={t('board.camera.download', { lng: lang })}
        title={downloadTitle}
        disabled={!drawn}
        className={cn(
          PILL_BUTTON,
          'grid place-items-center px-1.5 disabled:text-smoke disabled:hover:bg-transparent',
        )}
        onClick={() => void downloadBoardPng()}
      >
        <Download className="size-3.5" />
      </button>
    </fieldset>
  );
}
