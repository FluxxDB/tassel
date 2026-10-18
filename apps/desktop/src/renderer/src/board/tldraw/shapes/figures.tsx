// What Ada's shapes draw: a state, the trace card and a note, at the global constraints' visual
// values (CSS px at zoom 1). Plain React with no tldraw, so they're tested in jsdom; the shape
// utils place them on the canvas. Ada's content speaks the session's language (`lang`).
import type { Lang } from '@tassel/shared/i18n';
import type { CSSProperties, JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { MOTION } from '../../motion';
import '../../trace.css';
import { cn } from '../../../lib/cn';

export type StateRing = 'none' | 'highlight' | 'current';

export interface StateProps {
  w: number;
  h: number;
  label: string;
  accept: boolean;
  ring: StateRing;
}

export interface TraceRow {
  symbol: string;
  /** The state (or, for an NFA, the states) the step reads from. */
  from: string;
  /** Where it goes; '' when there's no move. */
  to: string;
  loop: boolean;
  stuck: boolean;
}

export interface TraceProps {
  w: number;
  h: number;
  lang: Lang;
  input: string;
  title: string | null;
  kind: 'dfa' | 'nfa';
  subject: 'student' | 'tutor';
  rows: TraceRow[];
  /** How many rows Ada has shown; the last of them is the newest. */
  shown: number;
  verdict: { got: 'accept' | 'reject'; note: string | null } | null;
}

export interface NoteProps {
  w: number;
  h: number;
  text: string;
  variant: 'note' | 'title';
}

const INK = 'var(--color-ink)';
const PAPER = 'var(--color-paper)';
const IRIS_INK = 'var(--color-iris-ink)';
const SMOKE_TEXT = 'var(--color-smoke-text)';

/**
 * How the board sets Ada's measured text (Track B's BoardTextStyle): a note in Geist 17/400, a
 * verdict pill in Geist 15. The board's text measure sets text with exactly these, so what is
 * drawn wraps where it was measured.
 */
export const TEXT_STYLE = Object.freeze({
  note: { fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 400, lineHeight: '24px' },
  verdict: { fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 400, lineHeight: '20px' },
} satisfies Record<'note' | 'verdict', CSSProperties>);

/** One line of a lab label (a title), cut short with an ellipsis rather than wrapped. */
const LAB_LABEL_LINE: CSSProperties = {
  fontSize: 12,
  lineHeight: '16px',
  color: SMOKE_TEXT,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** A state's circle, radius 32. */
const R = 32;

/**
 * A state: an ink circle on paper with its label. An accepting state has an inner circle; a
 * highlighted one an iris-ink ring, and the current one (in a trace) a heavier ring on iris.
 */
export function StateFigure({
  label,
  accept,
  ring,
  lang,
}: Pick<StateProps, 'label' | 'accept' | 'ring'> & { lang: Lang }): JSX.Element {
  const { t } = useTranslation();
  const name = accept ? t('board.state.accepting', { id: label, lng: lang }) : label;
  const body = ring === 'current' ? 'color-mix(in oklab, var(--color-iris) 20%, white)' : PAPER;
  return (
    <div
      role="img"
      aria-label={name}
      data-accept={accept}
      data-ring={ring}
      style={{ width: 2 * R, height: 2 * R }}
    >
      <svg
        width={2 * R}
        height={2 * R}
        viewBox={`0 0 ${2 * R} ${2 * R}`}
        overflow="visible"
        aria-hidden="true"
      >
        <circle cx={R} cy={R} r={R} style={{ fill: body, stroke: INK, strokeWidth: 2 }} />
        {accept && (
          <circle cx={R} cy={R} r={26} style={{ fill: 'none', stroke: INK, strokeWidth: 2 }} />
        )}
        {ring !== 'none' && (
          <circle
            cx={R}
            cy={R}
            r={38}
            key={ring}
            className={ring === 'current' ? 'trace-ring' : undefined}
            style={{
              fill: 'none',
              stroke: IRIS_INK,
              strokeWidth: ring === 'current' ? 3 : 2,
              animationDuration: `${MOTION.pulseMs}ms`,
              animationTimingFunction: MOTION.ease,
            }}
          />
        )}
        <text
          x={R}
          y={R}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fill: INK, fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 520 }}
        >
          {label}
        </text>
      </svg>
    </div>
  );
}

/**
 * The trace card: its title, the input on a tape, one row per step Ada has shown (the newest on
 * an iris wash, the cell it read in blush), then the verdict once she gives it.
 */
export function TraceCard({
  w,
  h,
  lang,
  input,
  title,
  kind,
  subject,
  rows,
  shown,
  verdict,
}: TraceProps): JSX.Element {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) => t(key, { ...values, lng: lang });
  const visible = rows.slice(0, Math.max(0, Math.min(shown, rows.length)));
  const newest = visible.length - 1;
  const symbols = [...input];
  return (
    <div
      data-testid="trace-card"
      lang={lang}
      // The whole box from the start: it has room for every step, so it never grows (Track B).
      style={{
        boxSizing: 'border-box',
        width: w,
        height: h,
        padding: 20,
        borderRadius: 16,
        backgroundColor: PAPER,
        boxShadow: '0 0 0 1px var(--color-hairline)',
        color: INK,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div className="mono" style={LAB_LABEL_LINE}>
        {title ?? tr('board.trace.title', { input })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {symbols.map((symbol, index) => (
          <span
            // The tape's cells are its positions: the same symbol can sit in several.
            // biome-ignore lint/suspicious/noArrayIndexKey: a cell is its index
            key={index}
            data-testid="trace-cell"
            data-reading={index === newest}
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              flex: 'none',
              borderRadius: 10,
              border: `1.5px solid ${INK}`,
              backgroundColor: index === newest ? 'var(--color-blush)' : PAPER,
              fontFamily: 'var(--font-mono)',
              fontSize: 24,
            }}
          >
            {symbol}
          </span>
        ))}
      </div>
      <ol style={{ listStyle: 'none', margin: '20px 0 0', padding: 0 }}>
        {visible.map((row, index) => (
          <TraceStep
            // Rows only ever grow at the end, so a row's index is its identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is its step
            key={index}
            row={row}
            n={index + 1}
            newest={index === newest}
            tr={tr}
          />
        ))}
      </ol>
      {verdict && (
        // Laid out as Track B's verdictRow measures it: VERDICT_ROW's gaps, 440 px wide.
        <div
          data-testid="trace-verdict"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            columnGap: 12,
            rowGap: 8,
            marginTop: 16,
          }}
        >
          <span style={{ ...PILL, backgroundColor: INK, color: PAPER }}>
            {tr(subject === 'student' ? 'board.verdict.yours' : 'board.verdict.this', {
              kind: tr(`board.kind.${kind}`),
              verdict: tr(`board.verdict.${verdict.got}`),
            })}
          </span>
          {verdict.note && (
            <span style={{ ...PILL, boxShadow: `inset 0 0 0 1px ${INK}` }}>{verdict.note}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** A verdict pill: its text in the 'verdict' style, wrapping inside 10 × 18 padding, ≤ 440. */
const PILL: CSSProperties = {
  ...TEXT_STYLE.verdict,
  flex: 'none',
  boxSizing: 'border-box',
  maxWidth: 440,
  padding: '10px 18px',
  borderRadius: 20,
  overflowWrap: 'break-word',
};

function TraceStep({
  row,
  n,
  newest,
  tr,
}: {
  row: TraceRow;
  n: number;
  newest: boolean;
  tr: (key: string, values?: Record<string, unknown>) => string;
}): JSX.Element {
  return (
    <li
      data-testid="trace-row"
      className="trace-fade"
      data-newest={newest}
      style={{
        animationDuration: `${MOTION.fadeMs}ms`,
        animationTimingFunction: MOTION.ease,
        display: 'flex',
        alignItems: 'baseline',
        gap: 16,
        height: 42,
        padding: '0 18px',
        lineHeight: '42px',
        borderRadius: 12,
        backgroundColor: newest
          ? 'color-mix(in oklab, var(--color-iris) 18%, white)'
          : 'transparent',
        fontSize: 17,
        whiteSpace: 'nowrap',
        overflowX: 'auto',
      }}
    >
      <span className="mono" style={{ fontSize: 12, color: SMOKE_TEXT }}>
        {tr('board.trace.step', { n })}
      </span>
      <span>{tr('board.trace.read', { symbol: row.symbol })}</span>
      {row.stuck ? (
        <>
          <span>{row.from}</span>
          <span>{tr('board.trace.stuck')}</span>
        </>
      ) : (
        <span>{`${row.from} → ${row.to}`}</span>
      )}
      {row.loop && <span style={{ color: IRIS_INK }}>{tr('board.trace.loops')}</span>}
    </li>
  );
}

/**
 * A note: Ada's words in an ink box, filling the box her text was measured for (Track B's
 * noteSize: NOTE_BOX's 10 × 16 padding, at most 320 wide). A title: the lab label over one of her
 * automata, on one line.
 */
export function NoteFigure({ w, h, text, variant }: NoteProps): JSX.Element {
  if (variant === 'title') {
    return (
      <div className={cn('mono')} style={{ ...LAB_LABEL_LINE, width: w }}>
        {text}
      </div>
    );
  }
  return (
    <div
      style={{
        ...TEXT_STYLE.note,
        boxSizing: 'border-box',
        width: w,
        height: h,
        padding: '10px 16px',
        borderRadius: 20,
        backgroundColor: INK,
        color: PAPER,
        overflowWrap: 'break-word',
      }}
    >
      {text}
    </div>
  );
}
