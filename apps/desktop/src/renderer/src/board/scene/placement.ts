// Where each item of the scene goes on the board, and how big it is. Items stack in one column at
// x 0, in scene order, ITEM_GAP apart; a note by an item sits beside it instead. An item whose
// size isn't known yet (an automaton waiting for its layout) holds back every item after it, so
// nothing jumps when a layout arrives.
//
// Ada's text is measured, not guessed (ruling P5-R5, review I11): her notes and the trace card's
// verdict row wrap, in the session's language, so their sizes come through `BoardText`. The
// constants below are the metrics Task 5's shapes draw with; a shape that set its text another
// way would no longer match its box.
import type { AutomatonLayout } from '../layout/types';
import type { BoardItem, BoardScene, TraceItem } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Between items in the column. */
export const ITEM_GAP = 64;
/** How far right of its item's box a note sits. */
export const NOTE_OFFSET = 32;
/** Between notes stacked beside one item. */
export const NOTE_STACK_GAP = 16;
/** An automaton's title row, above its layout. */
export const TITLE_ROW = 28;

/** The trace card: padding 20 around 440 px of content, so at least 480 wide. */
export const TRACE_CARD = Object.freeze({
  padding: 20,
  contentWidth: 440,
  /** A tape cell (44 px) and the gap after it. */
  cellPitch: 52,
  /** The padding, title, tape and their gaps, with no rows yet. */
  base: 132,
  row: 42,
});

/**
 * The verdict row under the trace rows: TOP px down, its pills laid out left to right, GAP apart,
 * wrapping to a new line ROW_GAP below when the next one won't fit the card's content width. A
 * pill's text wraps inside it. Hers is an ink pill and the note a 1px ink ring; both set text in
 * the 'verdict' style with PAD_Y × PAD_X padding.
 */
export const VERDICT_ROW = Object.freeze({ top: 16, padX: 18, padY: 10, gap: 12, rowGap: 8 });

/** A note: the 'note' style in an ink box at most 320 px wide, with 10 × 16 padding. */
export const NOTE_BOX = Object.freeze({ maxWidth: 320, padX: 16, padY: 10 });

/** How the board sets its text: 'note' is Geist 17/400; 'verdict' is Geist 15. */
export type BoardTextStyle = 'note' | 'verdict';

/**
 * How big `text` is when the board sets it in `style` and wraps it at `maxWidth` px, keeping words
 * whole (Korean ones too): its widest line, and all its lines' height. Task 5 measures with the
 * fonts the shapes use; tests use a fixed-width stand-in.
 */
export type MeasureText = (
  text: string,
  style: BoardTextStyle,
  maxWidth: number,
) => { w: number; h: number };

/** Board copy in the session's language: i18next's t with { lng } (see use-session-lang.ts). */
export type Translate = (key: string, values?: Record<string, string>) => string;

/** What sizing Ada's text needs: how to measure it, and the session language's copy. */
export interface BoardText {
  measure: MeasureText;
  t: Translate;
}

export function placeItems(
  scene: BoardScene,
  layouts: Readonly<Record<string, AutomatonLayout>>,
  text: BoardText,
): Record<string, Box> {
  const boxes: Record<string, Box> = {};
  /** Where the next note beside an item goes. */
  const besideNext = new Map<string, number>();
  let y = 0;
  for (const item of scene.items) {
    const size = itemSize(item, layouts, text);
    if (!size) break;
    const anchor = item.kind === 'note' && item.near ? boxes[item.near.item] : undefined;
    if (item.kind === 'note' && item.near && anchor) {
      const top = besideNext.get(item.near.item) ?? anchor.y;
      boxes[item.id] = { x: anchor.x + anchor.w + NOTE_OFFSET, y: top, ...size };
      besideNext.set(item.near.item, top + size.h + NOTE_STACK_GAP);
      continue;
    }
    // Everything else goes in the column, a note whose item is gone too.
    boxes[item.id] = { x: 0, y, ...size };
    y += size.h + ITEM_GAP;
  }
  return boxes;
}

/** An item's size, or null while it waits for its layout. */
export function itemSize(
  item: BoardItem,
  layouts: Readonly<Record<string, AutomatonLayout>>,
  text: BoardText,
): { w: number; h: number } | null {
  switch (item.kind) {
    case 'automaton': {
      const layout: AutomatonLayout | undefined = layouts[item.id];
      if (!layout) return null;
      return { w: layout.width, h: layout.height + (item.title === null ? 0 : TITLE_ROW) };
    }
    case 'trace':
      // Room for every step from the start, so the card doesn't grow as Ada steps through it.
      return traceSize(item.input, item.run.steps.length, verdictPills(item, text.t), text.measure);
    case 'note':
      return noteSize(item.text, text.measure);
  }
}

/**
 * A trace card's size: 52 px a tape cell past the 480 px minimum, 132 + 42 px a row, and the
 * verdict row's measured height when it has pills (verdictPills).
 */
export function traceSize(
  input: string,
  rows: number,
  verdict: readonly string[],
  measure: MeasureText,
): { w: number; h: number } {
  const { padding, contentWidth, cellPitch, base, row } = TRACE_CARD;
  const w = Math.max(contentWidth + 2 * padding, 2 * padding + cellPitch * [...input].length);
  const pills = verdict.length > 0 ? VERDICT_ROW.top + verdictRow(verdict, measure).h : 0;
  return { w, h: base + row * rows + pills };
}

/**
 * The verdict row's pills, laid out: each pill's box from the row's top-left, and the row's
 * height. Task 5 can place the pills at these boxes.
 */
export function verdictRow(
  pills: readonly string[],
  measure: MeasureText,
): { boxes: Box[]; h: number } {
  const { padX, padY, gap, rowGap } = VERDICT_ROW;
  const width = TRACE_CARD.contentWidth;
  const boxes: Box[] = [];
  let x = 0;
  let top = 0;
  let lineHeight = 0;
  for (const pill of pills) {
    const text = measure(pill, 'verdict', width - 2 * padX);
    const w = Math.min(width, text.w + 2 * padX);
    const h = text.h + 2 * padY;
    if (x > 0 && x + w > width) {
      top += lineHeight + rowGap;
      x = 0;
      lineHeight = 0;
    }
    boxes.push({ x, y: top, w, h });
    x += w + gap;
    lineHeight = Math.max(lineHeight, h);
  }
  return { boxes, h: boxes.length > 0 ? top + lineHeight : 0 };
}

/** A note's size: its text wrapped inside NOTE_BOX's padding, at most 320 px wide. */
export function noteSize(text: string, measure: MeasureText): { w: number; h: number } {
  const { maxWidth, padX, padY } = NOTE_BOX;
  const lines = measure(text, 'note', maxWidth - 2 * padX);
  return { w: Math.min(maxWidth, lines.w + 2 * padX), h: lines.h + 2 * padY };
}

/**
 * The verdict row's pills, in the session's language: hers or Ada's verdict ("Your DFA: accept",
 * "This NFA: reject"), then the note, if any. [] before the verdict.
 */
export function verdictPills(item: TraceItem, t: Translate): string[] {
  if (!item.verdict) return [];
  const label = t(item.subject === 'student' ? 'board.verdict.yours' : 'board.verdict.this', {
    kind: t(`board.kind.${item.spec.kind}`),
    verdict: t(`board.verdict.${item.verdict.got}`),
  });
  return item.verdict.note === null ? [label] : [label, item.verdict.note];
}
