// Where each item of the scene goes on the board, and how big it is. Items stack in one column at
// x 0, in scene order, ITEM_GAP apart; a note by an item sits beside it instead: right of it while
// the row stays within NOTE_ROW_MAX, else below it, or left of it once something is below it. An item whose
// size isn't known yet (an automaton waiting for its layout) holds back every item after it, so
// nothing jumps when a layout arrives.
//
// Ada's text is measured, not guessed (ruling P5-R5, review I11): her notes and the trace card's
// verdict row wrap, in the session's language, so their sizes come through `BoardText`. The
// constants below are the metrics Task 5's shapes draw with; a shape that set its text another
// way would no longer match its box.
import { automatonLayoutOf, type BoardLayout, isDiagramLayout } from '../layout/types';
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
/**
 * How far right a note beside an item may reach: past it, the board grows too wide for the
 * camera to fit it readably in a split panel, so the note goes below or left of its item.
 */
export const NOTE_ROW_MAX = 960;
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

/**
 * How the board sets its text: 'note' is Geist 17/400; 'verdict' is Geist 15; a diagram's node
 * label is Geist 14/500 and its sublabel Geist Mono 12; a group's label is Geist Mono 12 uppercase
 * and its sublabel Geist Mono 12 (diagram.ts's NODE_CARD and GROUP_LABEL).
 */
export type BoardTextStyle =
  | 'note'
  | 'verdict'
  | 'nodeLabel'
  | 'nodeSub'
  | 'groupLabel'
  | 'groupSub';

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
  layouts: Readonly<Record<string, BoardLayout>>,
  text: BoardText,
): Record<string, Box> {
  const boxes: Record<string, Box> = {};
  /** The side each item's notes take, chosen by its first, and where the next one goes there. */
  const beside = new Map<string, { side: 'right' | 'below' | 'left'; next: number }>();
  /** Where the next note left of an item goes, once its notes can't go below it any more. */
  const leftNext = new Map<string, number>();
  let y = 0;
  /** The item at the column's end, its notes below it included: only it has room below. */
  let last: string | null = null;
  for (const item of scene.items) {
    const size = itemSize(item, layouts, text);
    if (!size) break;
    const anchor = item.kind === 'note' && item.near ? boxes[item.near.item] : undefined;
    if (item.kind === 'note' && item.near && anchor) {
      const of = item.near.item;
      let spot = beside.get(of);
      if (!spot) {
        const side =
          anchor.x + anchor.w + NOTE_OFFSET + size.w <= NOTE_ROW_MAX
            ? 'right'
            : last === of
              ? 'below'
              : 'left';
        spot = { side, next: side === 'below' ? anchor.y + anchor.h + NOTE_STACK_GAP : anchor.y };
        beside.set(of, spot);
      }
      if (spot.side === 'right') {
        boxes[item.id] = { x: anchor.x + anchor.w + NOTE_OFFSET, y: spot.next, ...size };
        spot.next += size.h + NOTE_STACK_GAP;
      } else if (spot.side === 'below' && last === of) {
        boxes[item.id] = { x: anchor.x, y: spot.next, ...size };
        spot.next += size.h + NOTE_STACK_GAP;
        // The column goes on below the note.
        y = Math.max(y, spot.next - NOTE_STACK_GAP + ITEM_GAP);
      } else {
        const top = leftNext.get(of) ?? anchor.y;
        boxes[item.id] = { x: anchor.x - NOTE_OFFSET - size.w, y: top, ...size };
        leftNext.set(of, top + size.h + NOTE_STACK_GAP);
      }
      continue;
    }
    // Everything else goes in the column, a note whose item is gone too.
    boxes[item.id] = { x: 0, y, ...size };
    y += size.h + ITEM_GAP;
    last = item.id;
  }
  return boxes;
}

/**
 * The box the camera fits for `focus` (P5-R9): the item with the notes that go with it, so none
 * is cut off at the panel's edge. Those are the notes beside it and the notes that follow it in
 * the column, up to the next item. For no focus, everything placed. Undefined when there's
 * nothing placed to fit.
 */
export function focusBox(
  scene: BoardScene,
  boxes: Readonly<Record<string, Box>>,
  focus: string | null,
): Box | undefined {
  if (focus === null) return union(Object.values(boxes));
  const own = boxes[focus];
  if (!own) return undefined;
  const parts = [own];
  for (const item of scene.items) {
    if (item.kind === 'note' && item.near?.item === focus && boxes[item.id])
      parts.push(boxes[item.id]);
  }
  const at = scene.items.findIndex((item) => item.id === focus);
  for (const item of scene.items.slice(at + 1)) {
    if (item.kind !== 'note') break;
    // A note beside another item is that item's; it doesn't end the run.
    if (item.near && boxes[item.near.item]) continue;
    if (boxes[item.id]) parts.push(boxes[item.id]);
  }
  return union(parts);
}

function union(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** An item's size, or null while it waits for its layout. */
export function itemSize(
  item: BoardItem,
  layouts: Readonly<Record<string, BoardLayout>>,
  text: BoardText,
): { w: number; h: number } | null {
  switch (item.kind) {
    case 'automaton':
    case 'diagram': {
      // A layout of the other kind is one an item of the same id had before: it waits too.
      const layout = layouts[item.id];
      const fits = item.kind === 'diagram' ? isDiagramLayout(layout) : automatonLayoutOf(layout);
      if (!layout || !fits) return null;
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
