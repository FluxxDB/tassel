// Ada's marks, drawn: one SVG in panel px for her strokes and step dots, and HTML pills for her
// callouts so their text wraps at 320 px. Each pill is measured before it's placed, so it stays
// inside the panel (Review Focus 4). Iris-ink strokes 3 px wide with round caps and joins; a
// 20% iris wash; step dots r 13 with white Geist Mono 13; callouts ink with white Geist 17,
// their leaders 2.5 px with no head; an arrow's open head 10 px.
import type { PaperMark, PaperTarget, Pt } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import {
  type CSSProperties,
  type JSX,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { MOTION } from '../motion';
import {
  arrowFor,
  calloutFor,
  checkFor,
  circleFor,
  type Resolved,
  resolveTarget,
  stepDotFor,
  strikeFor,
  targetKey,
} from './geometry';
import type { Snapshot } from './marks-store';
import type { Fit } from './project';

/** A callout's pill wraps at this width. */
export const CALLOUT_MAX_WIDTH = 320;
const STEP_DOT_R = 13;

const DRAW: CSSProperties = {
  animationDuration: `${MOTION.drawMs}ms`,
  animationTimingFunction: MOTION.ease,
};
const FADE: CSSProperties = {
  animationDuration: `${MOTION.fadeMs}ms`,
  animationTimingFunction: MOTION.ease,
};

type Size = { w: number; h: number };

export interface MarkShapesProps {
  marks: PaperMark[];
  snapshot: Snapshot;
  fit: Fit;
  /** The layer's size in panel px. */
  panel: Size;
  /** The session's language: her callouts are in it. */
  lang: Lang;
}

export function MarkShapes({ marks, snapshot, fit, panel, lang }: MarkShapesProps): JSX.Element {
  // A Map, as any id is valid, "__proto__" included.
  const [pills, setPills] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const onPillSize = useCallback((id: string, size: Size) => {
    setPills((sizes) => {
      const known = sizes.get(id);
      return known && known.w === size.w && known.h === size.h
        ? sizes
        : new Map(sizes).set(id, size);
    });
  }, []);

  const resolve = (target: PaperTarget): Resolved | null =>
    resolveTarget(target, snapshot.elements, snapshot.project, fit);

  const shapes: JSX.Element[] = [];
  const leaders: JSX.Element[] = [];
  const dots: JSX.Element[] = [];
  const callouts: JSX.Element[] = [];
  /** How often each target has been numbered so far, for a repeat's offset. */
  const numbered = new Map<string, number>();

  for (const mark of marks) {
    const key = `${mark.type}-${mark.id}`;
    const testId = `mark-${mark.type}-${mark.id}`;
    if (mark.type === 'arrow') {
      const from = resolve(mark.from);
      const to = resolve(mark.to);
      const arrow = from && to ? arrowFor(from, to) : null;
      if (!arrow) continue;
      const [a, b] = arrow.line;
      shapes.push(
        <g key={key} data-testid={testId}>
          <Stroke d={`M${a.x} ${a.y}L${b.x} ${b.y}${polyline(arrow.head)}`} />
        </g>,
      );
      continue;
    }
    const target = resolve(mark.target);
    if (!target) continue;
    switch (mark.type) {
      case 'circle': {
        const d = ellipse(circleFor(target));
        shapes.push(
          <g key={key} data-testid={testId}>
            {mark.wash && (
              <path d={d} className="mark-fade fill-iris" fillOpacity={0.2} style={FADE} />
            )}
            <Stroke d={d} />
          </g>,
        );
        break;
      }
      case 'strike':
        shapes.push(
          <g key={key} data-testid={testId}>
            <Stroke d={polyline(strikeFor(target))} />
          </g>,
        );
        break;
      case 'check':
        shapes.push(
          <g key={key} data-testid={testId}>
            <Stroke d={polyline(checkFor(target))} />
          </g>,
        );
        break;
      case 'step': {
        const where = targetKey(mark.target);
        const repeat = numbered.get(where) ?? 0;
        numbered.set(where, repeat + 1);
        const at = stepDotFor(target, repeat);
        dots.push(
          <g key={key} data-testid={testId} className="mark-fade" style={FADE}>
            <circle cx={at.x} cy={at.y} r={STEP_DOT_R} fill="currentColor" />
            <text
              x={at.x}
              y={at.y}
              className="fill-paper font-mono"
              fontSize={13}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {mark.n}
            </text>
          </g>,
        );
        break;
      }
      case 'callout': {
        const placed = calloutFor(target, pills.get(mark.id) ?? { w: 0, h: 0 }, panel);
        const [start, control, end] = placed.leader;
        leaders.push(
          <Stroke
            key={key}
            testId={`${testId}-leader`}
            width={2.5}
            d={`M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}`}
          />,
        );
        callouts.push(
          <CalloutPill
            key={key}
            id={mark.id}
            testId={testId}
            text={mark.text}
            lang={lang}
            at={placed}
            onSize={onPillSize}
          />,
        );
        break;
      }
    }
  }

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible text-iris-ink"
        aria-hidden="true"
        focusable="false"
      >
        {shapes}
        {leaders}
        {/* Dots go over the rings and leaders they sit on. */}
        {dots}
      </svg>
      {callouts}
    </>
  );
}

/** One of Ada's strokes: drawn on along its length. */
function Stroke({ d, width = 3, testId }: { d: string; width?: number; testId?: string }) {
  return (
    <path
      d={d}
      data-testid={testId}
      pathLength={1}
      className="mark-draw"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={DRAW}
    />
  );
}

/**
 * A callout's pill: ink, radius 20, padding 10×16, white Geist 17/400, wrapping at 320 px with
 * Korean words kept whole. Its size goes up to MarkShapes, which places it.
 */
function CalloutPill({
  id,
  testId,
  text,
  lang,
  at,
  onSize,
}: {
  id: string;
  testId: string;
  text: string;
  lang: Lang;
  at: Pt;
  onSize(id: string, size: Size): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pill = ref.current;
    if (!pill) return;
    // Its border box: what calloutFor keeps inside the panel.
    const measure = () => onSize(id, { w: pill.offsetWidth, h: pill.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // A font that loads late, or new text, changes its size without a render.
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(pill);
    return () => observer.disconnect();
  }, [id, onSize]);
  return (
    <div
      ref={ref}
      data-testid={testId}
      lang={lang}
      className="mark-fade pointer-events-none absolute w-max rounded-[20px] bg-ink px-4 py-2.5 text-[17px] leading-[1.3] font-normal break-words text-paper ko:leading-[1.6] ko:[word-break:keep-all]"
      style={{ left: at.x, top: at.y, maxWidth: CALLOUT_MAX_WIDTH, ...FADE }}
    >
      {text}
    </div>
  );
}

/** An ellipse as a path, from its top, clockwise: a ring drawn on the way a hand would. */
function ellipse({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }): string {
  return `M${cx} ${cy - ry}a${rx} ${ry} 0 1 1 0 ${2 * ry}a${rx} ${ry} 0 1 1 0 ${-2 * ry}Z`;
}

function polyline(points: Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('');
}
