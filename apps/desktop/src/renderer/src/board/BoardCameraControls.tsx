// The student's board camera: zoom out, zoom in and Fit, in the board panel's top line right after
// its tag (Stage.tsx), so they never sit under the captions or a floating tile. They show once the
// board's engine offers a camera; the board panel hands it over (useBoardCamera).
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { BoardEngine } from './engine';
import { useSessionLang } from './use-session-lang';

export const useBoardCamera: UseBoundStore<StoreApi<{ camera: BoardEngine['camera'] }>> = create<{
  camera: BoardEngine['camera'];
}>()(() => ({ camera: undefined }));

export function BoardCameraControls(): JSX.Element | null {
  const { t } = useTranslation();
  const lang = useSessionLang();
  const camera = useBoardCamera((state) => state.camera);
  if (!camera) return null;
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
          // 24px tall: WCAG 2.2's minimum target, inside the 26px pill.
          className="h-6 min-w-6 rounded-pill px-2.5 text-[13px] leading-6 font-w520 whitespace-nowrap transition-[background-color] duration-[120ms] hover:bg-bone"
          onClick={() => (action === 'fit' ? camera.fit() : camera.zoom(action))}
        >
          {action === 'in' ? '+' : action === 'out' ? '−' : t('board.camera.fit', { lng: lang })}
        </button>
      ))}
    </fieldset>
  );
}
