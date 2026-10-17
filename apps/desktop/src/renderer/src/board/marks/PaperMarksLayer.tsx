/// <reference types="vite/client" />
// Ada's marks over a frozen snapshot of the student's paper, in the paper panel above its body
// (P5-R8). While a snapshot is frozen, it covers her live paper: the frame contain-fit on paper,
// her marks over it in panel px, and a hidden list of them in words. A ResizeObserver refits
// the frame and the marks together on every size change, the stage's 240 ms reflow included,
// so the marks never leave her ink (Review Focus 3). The layer also bounds the snapshot's life:
// it starts and ends with the session screen (plan review M11).
import type { JSX, RefObject } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSessionLang } from '../use-session-lang';
import { FixturePaper } from './fixture-paper';
import { MarkShapes } from './MarkShapes';
import { MarksDescription } from './MarksDescription';
import { type Snapshot, useMarksStore } from './marks-store';
import './marks.css';
import { containFit, type Fit } from './project';
import type { SnapshotImage } from './snapshot-sources';

export function PaperMarksLayer(): JSX.Element | null {
  const status = useMarksStore((state) => state.status);
  const snapshot = useMarksStore((state) => state.snapshot);
  // Before the tutor connects, so nothing Ada sends is lost; the session's clock starts with it.
  useLayoutEffect(() => {
    useMarksStore.getState().reset(Date.now());
    return () => useMarksStore.getState().reset();
  }, []);
  if (status !== 'frozen' || !snapshot) return null;
  return <FrozenPaper snapshot={snapshot} />;
}

function FrozenPaper({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useTranslation();
  // Her marks speak the session's language; the image's alt text is chrome.
  const lang = useSessionLang();
  const marks = useMarksStore((state) => state.marks);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useSize(layer);
  const fit = containFit(snapshot.image, panel);
  return (
    <div
      ref={layer}
      data-testid="paper-snapshot"
      className="absolute inset-0 z-[5] overflow-hidden bg-paper"
    >
      <Frame image={snapshot.image} fit={fit} alt={t('marks.alt')} />
      <MarkShapes marks={marks} snapshot={snapshot} fit={fit} panel={panel} lang={lang} />
      <MarksDescription marks={marks} lang={lang} />
    </div>
  );
}

/** The frozen frame, scaled and placed by the same fit as the marks. */
function Frame({ image, fit, alt }: { image: SnapshotImage; fit: Fit; alt: string }) {
  const style = {
    left: fit.x,
    top: fit.y,
    width: image.w * fit.scale,
    height: image.h * fit.scale,
  };
  if (image.kind === 'url') {
    return (
      <img
        data-testid="snapshot-image"
        src={image.url}
        alt={alt}
        draggable={false}
        className="absolute max-w-none select-none"
        style={style}
      />
    );
  }
  return (
    <div
      data-testid="snapshot-image"
      role="img"
      aria-label={alt}
      className="absolute"
      style={style}
    >
      <FixturePaper />
    </div>
  );
}

/**
 * The element's size, kept current by a ResizeObserver. Each change renders at once, before the
 * frame is painted, so the frame and the marks never trail the panel.
 */
function useSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (w: number, h: number) =>
      setSize((current) => (current.w === w && current.h === h ? current : { w, h }));
    const rect = element.getBoundingClientRect();
    update(rect.width, rect.height);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) flushSync(() => update(box.width, box.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
