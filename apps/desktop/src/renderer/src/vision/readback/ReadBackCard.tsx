import type { Lang } from '@tassel/shared/i18n';
import type { DfaReading } from '@tassel/shared/vision';
import { type JSX, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';
import { layoutReading } from './layout';

export function ReadBackCard({
  reading,
  lang,
}: {
  reading: DfaReading | null;
  lang: Lang;
}): JSX.Element | null {
  return reading ? <ReadingCard reading={reading} lang={lang} /> : null;
}

function ReadingCard({ reading, lang }: { reading: DfaReading; lang: Lang }): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const bodyId = useId();
  const layout = useMemo(() => layoutReading(reading), [reading]);
  const title = t('vision.readback.title', { lng: lang });
  const action = t(expanded ? 'vision.readback.collapse' : 'vision.readback.expand', { lng: lang });
  const labels = new Map(reading.states.map((state) => [state.id, state.label]));
  // Keep functional text at its intended CSS pixel size while fitting the geometry to 328px.
  const textScale = layout.width / 328;
  return (
    <figure
      data-testid="readback-card"
      aria-label={title}
      lang={lang}
      className="m-0 w-[360px] shrink-0 overflow-hidden rounded-card bg-paper p-4 text-ink ring-1 ring-hairline motion-safe:animate-[caption-in_150ms_ease-out]"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        title={action}
        onClick={() => setExpanded((value) => !value)}
        className="mono flex min-h-6 w-full cursor-pointer items-center justify-between gap-2 rounded-pill text-left text-[11px] text-smoke-text hover:bg-bone hover:text-ink"
      >
        {title}
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d={expanded ? 'M3 7.5 6 4.5 9 7.5' : 'M3 4.5 6 7.5 9 4.5'} />
        </svg>
      </button>
      <div id={bodyId} hidden={!expanded}>
        <svg
          data-reading="true"
          aria-hidden="true"
          width="328"
          height={(layout.height * 328) / layout.width}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="mt-3 block overflow-visible font-sans"
        >
          {layout.start && (
            <g className="text-ink">
              <path
                d={layout.start.d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                points={layout.start.head.map((point) => point.join(',')).join(' ')}
                fill="currentColor"
              />
            </g>
          )}
          {layout.edges.map((edge) => (
            <g
              key={edge.id}
              data-testid={`readback-edge-${edge.id}`}
              className={cn('text-ink', edge.uncertain && 'text-iris-ink')}
            >
              <path
                d={edge.d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={edge.uncertain ? '4 3' : undefined}
              />
              <polygon
                points={edge.head.map((point) => point.join(',')).join(' ')}
                fill="currentColor"
              />
              <text
                x={edge.lx}
                y={edge.ly}
                textAnchor="middle"
                fill="currentColor"
                fontSize={12 * textScale}
                className="font-mono"
              >
                {edge.label}
                {edge.uncertain && (
                  <tspan dx={4 * textScale} className="fill-iris-ink">
                    ?
                  </tspan>
                )}
              </text>
            </g>
          ))}
          {layout.states.map((state) => (
            <g
              key={state.id}
              data-testid={`readback-state-${state.id}`}
              data-accept={state.accept}
              data-uncertain={state.uncertain}
              className={cn('text-ink', state.uncertain && 'text-iris-ink')}
            >
              <circle
                cx={state.x}
                cy={state.y}
                r={state.r}
                className="fill-paper"
                stroke="currentColor"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={state.uncertain ? '4 3' : undefined}
              />
              {state.accept && (
                <circle
                  cx={state.x}
                  cy={state.y}
                  r={state.r * 0.82}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={state.uncertain ? '4 3' : undefined}
                />
              )}
              <text
                x={state.x}
                y={state.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="currentColor"
                fontSize={13 * textScale}
              >
                {state.label}
              </text>
              {state.uncertain && (
                <text
                  x={state.x + state.r + 4}
                  y={state.y - state.r}
                  fontSize={12 * textScale}
                  className="fill-iris-ink"
                >
                  ?
                </text>
              )}
            </g>
          ))}
        </svg>
        {layout.missingMoves && (
          <p className="mt-2 text-[12px] text-smoke-text">
            {t('vision.readback.deadState', { lng: lang })}
          </p>
        )}
        {reading.uncertain.length > 0 && (
          <p className="mt-2 text-[12px] text-iris-ink">
            {t('vision.readback.uncertain', { lng: lang })}
          </p>
        )}
        <ul className="sr-only">
          {reading.states.map((state) => (
            <li key={`state-${state.id}`}>
              {t('vision.readback.srState', {
                lng: lang,
                state: state.label,
                start: String(state.start),
                accept: String(state.accept),
              })}
              {reading.uncertain.includes(state.id) && (
                <span> {t('vision.readback.uncertain', { lng: lang })}</span>
              )}
            </li>
          ))}
          {reading.transitions.map((edge) => (
            <li key={`edge-${edge.id}`}>
              {t('vision.readback.srTransition', {
                lng: lang,
                from: labels.get(edge.source) ?? edge.source,
                to: labels.get(edge.target) ?? edge.target,
                symbols: [...new Set(edge.symbols)].sort().join(','),
              })}
              {reading.uncertain.includes(edge.id) && (
                <span> {t('vision.readback.uncertain', { lng: lang })}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
