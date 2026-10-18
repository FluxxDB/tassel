// Trace marks share the snapshot's projection: resize and reflow move ink and marks together.
import type { ElementRef, Pt } from '@tassel/shared/beats';
import { useLayoutEffect, useRef } from 'react';
import { MOTION, prefersReducedMotion } from '../motion';
import { resolveTarget, stepDotFor } from './geometry';
import type { PaperTrace, Snapshot } from './marks-store';
import type { Fit } from './project';
import { planPaperTrace } from './trace-marks';
import '../trace.css';

const FADE = { animationDuration: `${MOTION.fadeMs}ms`, animationTimingFunction: MOTION.ease };

export function TraceMarks({
  trace,
  snapshot,
  fit,
}: {
  trace: PaperTrace;
  snapshot: Snapshot;
  fit: Fit;
}) {
  const plan = planPaperTrace(trace.run, trace.shown);
  const resolve = (el: ElementRef) =>
    resolveTarget({ el }, snapshot.elements, snapshot.project, fit);
  const path = plan.glide ? resolve(plan.glide)?.path : null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible text-iris-ink"
      aria-hidden="true"
      focusable="false"
    >
      {plan.ring.map((id) => {
        const state = resolve(`state:${id}`);
        return (
          state && (
            <circle
              key={id}
              data-testid={`trace-ring-${id}`}
              className="trace-ring"
              cx={state.center.x}
              cy={state.center.y}
              r={state.radius * 1.25}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              style={{
                animationDuration: `${MOTION.pulseMs}ms`,
                animationTimingFunction: MOTION.ease,
              }}
            />
          )
        );
      })}
      {plan.dots.map((dot) => {
        const edge = resolve(dot.el);
        if (!edge) return null;
        const at = stepDotFor(edge, dot.repeat);
        return (
          <g
            key={`${dot.n}:${dot.el}`}
            data-testid={`trace-dot-${dot.n}`}
            data-edge={dot.el}
            className="trace-fade"
            style={FADE}
          >
            <circle cx={at.x} cy={at.y} r={13} fill="currentColor" />
            <text
              x={at.x}
              y={at.y}
              className="fill-paper font-mono"
              fontSize={13}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {dot.n}
            </text>
          </g>
        );
      })}
      {path && path.length > 0 && <Token path={path} trace={trace} />}
    </svg>
  );
}

function Token({ path, trace }: { path: Pt[]; trace: PaperTrace }) {
  const ref = useRef<SVGGElement>(null);
  const previous = useRef<PaperTrace | null>(null);
  const { run, shown } = trace;
  // A primitive dependency: new renders don't restart the glide. Geometry changes cancel it
  // and jump to the newly projected endpoint, rather than replaying a word already heard.
  const pathKey = JSON.stringify(path);
  useLayoutEffect(() => {
    const replay = previous.current?.run !== run || previous.current?.shown !== shown;
    previous.current = { run, shown };
    if (!replay || prefersReducedMotion() || !ref.current?.animate) return;
    const points = JSON.parse(pathKey) as Pt[];
    const distances = [0];
    for (let i = 1; i < points.length; i++)
      distances.push(
        distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
      );
    const total = distances.at(-1) ?? 0;
    if (total === 0) return;
    const animation = ref.current.animate(
      points.map((p, i) => ({ transform: translate(p), offset: distances[i] / total })),
      { duration: MOTION.glideMs, easing: MOTION.glideEase },
    );
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const stop = () => {
      if (media?.matches) animation.cancel();
    };
    media?.addEventListener?.('change', stop);
    return () => {
      animation.cancel();
      media?.removeEventListener?.('change', stop);
    };
  }, [pathKey, run, shown]);
  // The resting state exists before the animation, and survives cancellation or missing WAAPI.
  return (
    <g ref={ref} data-testid="trace-token" style={{ transform: translate(path[path.length - 1]) }}>
      <circle r={5} fill="currentColor" />
    </g>
  );
}
function translate(p: Pt): string {
  return `translate(${p.x}px, ${p.y}px)`;
}
