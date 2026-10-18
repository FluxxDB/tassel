/// <reference types="vite/client" />
// The student's image on the stage: it takes the paper panel's slot, over her live paper and
// any frozen snapshot, contain-fit on paper, with Ada's marks over it in panel px, scaled to the
// image's own pixels (its Set-of-Mark boxes for `el` targets, its width and height for `at`
// and `box`), and a hidden list of them in words. The panel's top line carries a pill with Back
// to paper, or a notice while the image loads or when it couldn't. The stage registers here as
// the chat's way to show an image, and the image goes when the stage does.
import type { JSX, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerImageStage } from '../../features/chat/image-stage';
import { useStageStore } from '../../features/session/stage-store';
import { MOTION } from '../motion';
import { useSessionLang } from '../use-session-lang';
import { type LoadedImage, useImageStore } from './image-store';
import { MarkShapes } from './MarkShapes';
import { MarksDescription } from './MarksDescription';
import { useSize } from './PaperMarksLayer';
import './marks.css';
import { containFit, rectProjector } from './project';

/** How long a failed load's notice stays. */
const FAILED_NOTICE_MS = 4_000;

const PILL =
  'mark-fade pointer-events-auto flex h-[26px] items-center rounded-pill bg-paper shadow-[0_0_0_1px_var(--color-hairline)]';
const FADE = { animationDuration: `${MOTION.fadeMs}ms`, animationTimingFunction: MOTION.ease };

/** True while an image has the paper panel: shown, not merely loading. */
export function useImageOnStage(): boolean {
  return useImageStore((state) => state.shown !== null && state.image !== null);
}

/** Shows the attachment the chat asks for, bringing the panel in beside the board if need be. */
function showFromChat(attachmentId: string): void {
  const { mode, pinned, pin, requestMode } = useStageStore.getState();
  if (mode === 'board') {
    // The student's own ask: with the board pinned alone, she pins both side by side.
    if (pinned) pin('split');
    else requestMode('split');
  }
  useImageStore.getState().show(attachmentId);
}

export function StageImage(): JSX.Element | null {
  const shown = useImageStore((state) => state.shown);
  const image = useImageStore((state) => state.image);
  // Registered before the tutor connects, so nothing Ada or the chat shows is lost; every image
  // goes with the stage.
  useLayoutEffect(() => {
    const unregister = registerImageStage(showFromChat);
    return () => {
      unregister();
      useImageStore.getState().reset();
    };
  }, []);
  if (shown === null || !image) return null;
  return <ImageOnStage attachmentId={shown} image={image} />;
}

function ImageOnStage({ attachmentId, image }: { attachmentId: string; image: LoadedImage }) {
  const { t } = useTranslation();
  // Her marks speak the session's language; the image's alt text is chrome.
  const lang = useSessionLang();
  const marks = useImageStore((state) => state.marks.get(attachmentId));
  const layer = useRef<HTMLDivElement>(null);
  const panel = useSize(layer);
  const fit = containFit(image, panel);
  const snapshot = {
    elements: { states: {}, edges: {}, ...(image.detected && { detected: image.detected }) },
    project: rectProjector(image.w, image.h),
  };
  return (
    <div
      ref={layer}
      data-testid="stage-image-layer"
      className="absolute inset-0 z-[6] overflow-hidden bg-paper"
    >
      <img
        data-testid="stage-image"
        src={image.url}
        alt={t('session.stage.image.alt')}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          left: fit.x,
          top: fit.y,
          width: image.w * fit.scale,
          height: image.h * fit.scale,
        }}
      />
      <MarkShapes marks={marks ?? []} snapshot={snapshot} fit={fit} panel={panel} lang={lang} />
      <MarksDescription
        marks={marks ?? []}
        lang={lang}
        label={t('session.stage.image.marksLabel', { lng: lang })}
      />
    </div>
  );
}

/**
 * The paper panel's top-line pill for the image: loading, it says so; a failed load shows for
 * 4 s; shown, Back to paper. Chrome, so in the UI's language.
 */
export function ImageTag(): JSX.Element | null {
  const { t } = useTranslation();
  const status = useImageStore((state) => state.status);
  const backToPaper = useImageStore((state) => state.backToPaper);
  const failedNotice = useFailedNotice();
  if (status === 'loading') return <Notice>{t('session.stage.image.loading')}</Notice>;
  if (status === 'failed' && failedNotice) {
    return <Notice>{t('session.stage.image.failed')}</Notice>;
  }
  if (status !== 'shown') return null;
  return (
    <div data-testid="image-tag" className={`${PILL} px-px`} style={FADE}>
      <button
        type="button"
        onClick={backToPaper}
        // 24px tall: WCAG 2.2's minimum target, inside the 26px pill.
        className="h-6 rounded-pill px-2.5 text-[13px] leading-6 font-w520 whitespace-nowrap text-ink transition-[background-color] duration-[120ms] hover:bg-bone"
      >
        {t('session.stage.image.backToPaper')}
      </button>
    </div>
  );
}

/** A loading or failure notice, announced politely. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="image-tag"
      role="status"
      className={`${PILL} px-3 text-[13px] leading-4 whitespace-nowrap text-ink`}
      style={FADE}
    >
      {children}
    </div>
  );
}

/** True for 4 s after each failed load. */
function useFailedNotice(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = useImageStore.subscribe((state, previous) => {
      if (state.status === previous.status) return;
      clearTimeout(timer);
      setShown(state.status === 'failed');
      if (state.status === 'failed') timer = setTimeout(() => setShown(false), FAILED_NOTICE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  return shown;
}
