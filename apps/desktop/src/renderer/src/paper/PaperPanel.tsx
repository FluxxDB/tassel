// The paper panel's body, inside P1's Panel and under its TopLine (Task 13 mounts it): P1's
// waiting fallback until a paper source runs, her live paper on the desk while it does, and a
// state card for everything else. With TASSEL_PAPER_DEBUG=1, a pill at the bottom right shows
// the detector's numbers and toggles the heatmap.
import { type JSX, type ReactNode, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { cropTransform, type FeedTransform, type Size } from './crop-transform';
import { Heatmap } from './debug/Heatmap';
import { DEFAULT_PARAMS, parseParams } from './detector/params';
import { PaperStateCard } from './PaperStateCard';
import { PaperVideo } from './PaperVideo';
import { usePaperConfig } from './paper-config';
import { usePaperStore } from './paper-store';
import type { NormRect } from './types';

export function PaperPanel({ fallback }: { fallback: ReactNode }): JSX.Element {
  const status = usePaperStore((state) => state.status);
  const stream = usePaperStore((state) => state.stream);
  if (status === 'idle') return <>{fallback}</>;
  if (status === 'live' && stream) return <LiveFeed stream={stream} />;
  // A live status always comes with its stream; until it does, it's still starting.
  return <PaperStateCard status={status === 'live' ? 'starting' : status} />;
}

const NO_SIZE: Size = { w: 0, h: 0 };

/** The feed on the desk, contain-fit by cropTransform, with the debug layer over it. */
function LiveFeed({ stream }: { stream: MediaStream }) {
  const crop = usePaperStore((state) => state.contentRect);
  const { debug } = usePaperConfig();
  const [box, boxRef] = useBoxSize<HTMLDivElement>();
  const [video, setVideo] = useState<Size>(NO_SIZE);
  const [heatmap, setHeatmap] = useState(false);
  const transform = cropTransform(video, crop, box);
  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-desk">
      <PaperVideo
        stream={stream}
        crop={crop}
        video={video}
        transform={transform}
        onSize={(size) => setVideo((old) => (old.w === size.w && old.h === size.h ? old : size))}
      />
      {debug && heatmap && (
        <HeatmapLayer video={video} crop={crop} transform={transform} box={box} />
      )}
      {debug && <DebugPill heatmap={heatmap} onToggle={() => setHeatmap((on) => !on)} />}
    </div>
  );
}

/** The element's size in CSS pixels, kept current while P1's reflow resizes the panel. */
function useBoxSize<T extends HTMLElement>(): [Size, (element: T | null) => void] {
  const [size, setSize] = useState<Size>(NO_SIZE);
  const [element, setElement] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((old) => (old.w === width && old.h === height ? old : { w: width, h: height }));
    };
    measure();
    // jsdom has no ResizeObserver; the size stays what the first measure saw.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [size, setElement];
}

/** Its own component, so only the heatmap re-renders with each sample (5 a second). */
function HeatmapLayer(props: {
  video: Size;
  crop: NormRect | null;
  transform: FeedTransform;
  box: Size;
}) {
  const stats = usePaperStore((state) => state.stats);
  return stats ? <Heatmap stats={stats} {...props} /> : null;
}

/**
 * The debug pill, at the panel's bottom right. The captions (z-20) can cover that corner, so it
 * sits above them: it's a tuning tool, never seen in a student's build.
 */
function DebugPill({ heatmap, onToggle }: { heatmap: boolean; onToggle(): void }) {
  const { t } = useTranslation();
  const kind = usePaperStore((state) => state.kind);
  const stats = usePaperStore((state) => state.stats);
  const opencv = usePaperStore((state) => state.opencv);
  const sent = usePaperStore((state) => state.uploads.sent);
  const { params } = usePaperConfig();
  const stable = { ...DEFAULT_PARAMS, ...parseParams(params) }.stableSamples;
  return (
    <div className="pointer-events-auto absolute right-3.5 bottom-3.5 z-30 flex h-[26px] items-center gap-2 rounded-pill bg-paper pr-px pl-3 shadow-[0_0_0_1px_var(--color-hairline)]">
      <span className="mono text-[11px] leading-[14px] whitespace-nowrap text-ink">
        {t('paper.debug.stats', {
          kind: kind ?? '',
          changed: stats?.changed.length ?? 0,
          quiet: stats?.quiet ?? 0,
          stable,
          sent,
        })}
      </span>
      {opencv === false && (
        <span className="mono text-[11px] leading-[14px] whitespace-nowrap text-smoke-text">
          {t('paper.debug.noOpenCv')}
        </span>
      )}
      <button
        type="button"
        aria-pressed={heatmap}
        onClick={onToggle}
        className={cn(
          'h-6 rounded-pill px-2.5 text-[13px] leading-6 font-w520 whitespace-nowrap transition-[color,background-color] duration-[120ms]',
          heatmap ? 'bg-ink text-paper hover:bg-ink/85' : 'text-ink hover:bg-bone',
        )}
      >
        {t('paper.debug.toggle')}
      </button>
    </div>
  );
}
