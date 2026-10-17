// Ada's board as she wants it: every shape and binding of hers, by stable id, in tldraw's terms
// but as plain data. planSync diffs one of these against the next. Pure: no tldraw import.
import { type ElementRef, edgeRef, type Pt } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import { mergedEdges } from '../automata/run';
import type { AutomatonLayout, LoopSide } from '../layout/types';
import { type BoardText, type Box, placeItems, TITLE_ROW } from '../scene/placement';
import { isRevealed } from '../scene/reduce';
import type { AutomatonItem, BoardScene, NoteItem, TraceItem } from '../scene/types';

export interface DesiredShape {
  id: string;
  type: 'tassel-state' | 'tassel-trace' | 'tassel-note' | 'arrow';
  x: number;
  y: number;
  opacity: 0 | 1;
  props: Record<string, unknown>;
  /**
   * Whose shape this is and what it draws. `hidden` until Ada reveals it: tldraw then neither
   * draws it nor lets the student hit it (P5-R5, I2).
   */
  meta: { ada: true; item: string; el: string; hidden: boolean };
}

export interface DesiredBinding {
  id: string;
  /** The arrow's shape id. */
  arrow: string;
  /** The bound shape's id. */
  to: string;
  terminal: 'start' | 'end';
  normalizedAnchor: Pt;
  isPrecise: boolean;
}

export interface Desired {
  shapes: Map<string, DesiredShape>;
  bindings: Map<string, DesiredBinding>;
}

/** Nothing of Ada's: the board before her first drawing, and after a reset. */
export const NO_SHAPES: Desired = { shapes: new Map(), bindings: new Map() };

/** The id of the shape that draws element `el` (a state, an edge, the start arrow…) of `item`. */
export function adaShapeId(item: string, el: string): string {
  return `shape:ada.${item}.${el}`;
}

/** The id of the binding that ties one terminal of Ada's arrow `el` of `item` to a shape. */
export function adaBindingId(item: string, el: string, terminal: 'start' | 'end'): string {
  return `binding:ada.${item}.${el}.${terminal}`;
}

/** An arrow bound at the middle of a shape: tldraw aims it at the shape's center (imprecise). */
const CENTER: Pt = { x: 0.5, y: 0.5 };

/**
 * A self-loop's anchors on its state, start then end, on the side Graphviz put the loop. They run
 * so that the right of travel points away from the state, where tldraw bends a positive bend, so
 * one bend, LOOP_BEND × r, draws every loop outside its state. tldraw keeps the anchors when both
 * ends bind one shape, even imprecise. Counterclockwise on purpose: tldraw 5.5.2 computes the
 * clockwise mirror of a top or bottom loop as invalid about half the time (a NaN end), and draws
 * nothing.
 */
const LOOP_ANCHORS: Readonly<Record<LoopSide, readonly [Pt, Pt]>> = {
  top: [
    { x: 0.7, y: 0.06 },
    { x: 0.3, y: 0.06 },
  ],
  bottom: [
    { x: 0.3, y: 0.94 },
    { x: 0.7, y: 0.94 },
  ],
  left: [
    { x: 0.06, y: 0.3 },
    { x: 0.06, y: 0.7 },
  ],
  right: [
    { x: 0.94, y: 0.7 },
    { x: 0.94, y: 0.3 },
  ],
};
const LOOP_BEND = 1.6;

/** What every arrow of Ada's shares: tldraw's thinnest solid arc, an arrowhead at its end, mono labels. */
const ARROW = {
  kind: 'arc',
  size: 's',
  // An ink line, not tldraw's default hand-drawn one.
  dash: 'solid',
  font: 'mono',
  arrowheadStart: 'none',
  arrowheadEnd: 'arrow',
  labelPosition: 0.5,
} as const;

/**
 * The shapes and bindings that draw `scene`, each item at its placeItems box. An automaton whose
 * layout hasn't come yet, and everything placed after it, draws nothing until it comes.
 * `text` measures and words Ada's text as placement does; `lang` is the session's language.
 */
export function desiredBoard(
  scene: BoardScene,
  layouts: Readonly<Record<string, AutomatonLayout>>,
  text: BoardText,
  lang: Lang,
): Desired {
  const board: Desired = { shapes: new Map(), bindings: new Map() };
  const boxes = placeItems(scene, layouts, text);
  for (const item of scene.items) {
    const box = boxes[item.id];
    if (!box) continue;
    if (item.kind === 'automaton') {
      const layout = layouts[item.id];
      if (layout) addAutomaton(board, item, layout, box);
    } else if (item.kind === 'trace') {
      addTrace(board, item, box, lang);
    } else {
      addNote(board, item, box);
    }
  }
  return board;
}

/**
 * An automaton: its title on top, then its states, start arrow and edges where its layout puts
 * them. Each element is hidden until revealed; the title shows with the first of them.
 */
function addAutomaton(board: Desired, item: AutomatonItem, layout: AutomatonLayout, box: Box) {
  const { spec } = item;
  let top = box.y;
  if (item.title !== null) {
    const anything = item.revealed === 'all' || item.revealed.length > 0;
    put(board, item.id, 'title', 'tassel-note', box.x, top, !anything, {
      w: layout.width,
      h: TITLE_ROW,
      text: item.title,
      variant: 'title',
    });
    top += TITLE_ROW;
  }

  // The states first, so the arrows lie over them.
  for (const state of spec.states) {
    const center = layout.states[state.id];
    if (!center) continue;
    const el: ElementRef = `state:${state.id}`;
    const ring = item.current.includes(state.id)
      ? 'current'
      : item.highlighted.includes(el)
        ? 'highlight'
        : 'none';
    put(
      board,
      item.id,
      el,
      'tassel-state',
      box.x + center.x - center.r,
      top + center.y - center.r,
      !isRevealed(item, el),
      {
        w: 2 * center.r,
        h: 2 * center.r,
        label: state.id,
        accept: state.accept === true,
        ring,
      },
    );
  }

  // The start arrow: free at its tail, its head bound to the start state.
  const { from, to } = layout.start;
  put(board, item.id, 'start', 'arrow', box.x + from.x, top + from.y, !isRevealed(item, 'start'), {
    ...ARROW,
    bend: 0,
    label: '',
    color: 'black',
    labelColor: 'black',
    start: { x: 0, y: 0 },
    end: { x: to.x - from.x, y: to.y - from.y },
  });
  bind(board, item.id, 'start', 'end', `state:${spec.start}`, CENTER);

  for (const edge of mergedEdges(spec)) {
    const el = edgeRef(edge.from, edge.to);
    const drawn = layout.edges[`${edge.from}>${edge.to}`];
    const tail = layout.states[edge.from];
    const head = layout.states[edge.to];
    if (!drawn || !tail || !head) continue;
    const loop = edge.from === edge.to ? (drawn.loop ?? 'top') : null;
    const color = item.highlighted.includes(el) ? 'violet' : 'black';
    put(board, item.id, el, 'arrow', box.x + tail.x, top + tail.y, !isRevealed(item, el), {
      ...ARROW,
      // Task 2's bend is positive to the left of tail → head; tldraw's to the right (P5-R2).
      bend: loop ? LOOP_BEND * tail.r : -drawn.bend,
      label: edge.symbols.join(','),
      color,
      labelColor: color,
      start: { x: 0, y: 0 },
      end: { x: head.x - tail.x, y: head.y - tail.y },
    });
    const [startAnchor, endAnchor] = loop ? LOOP_ANCHORS[loop] : [CENTER, CENTER];
    bind(board, item.id, el, 'start', `state:${edge.from}`, startAnchor);
    bind(board, item.id, el, 'end', `state:${edge.to}`, endAnchor);
  }
}

/** A trace card at its box: one row per step of its run, the ones Ada has shown drawn. */
function addTrace(board: Desired, item: TraceItem, box: Box, lang: Lang) {
  const states = (ids: readonly string[]) =>
    ids.length === 1 ? ids[0] : ids.length === 0 ? '' : `{${ids.join(', ')}}`;
  put(board, item.id, 'trace', 'tassel-trace', box.x, box.y, false, {
    w: box.w,
    h: box.h,
    lang,
    input: item.input,
    title: item.title,
    kind: item.spec.kind,
    subject: item.subject,
    rows: item.run.steps.map((step) => ({
      symbol: step.symbol,
      from: states(step.from),
      to: states(step.to),
      loop: step.to.length > 0 && sameStates(step.from, step.to),
      stuck: step.to.length === 0,
    })),
    shown: item.shown,
    verdict: item.verdict && { got: item.verdict.got, note: item.verdict.note },
  });
}

function addNote(board: Desired, item: NoteItem, box: Box) {
  put(board, item.id, 'note', 'tassel-note', box.x, box.y, false, {
    w: box.w,
    h: box.h,
    text: item.text,
    variant: 'note',
  });
}

function put(
  board: Desired,
  item: string,
  el: string,
  type: DesiredShape['type'],
  x: number,
  y: number,
  hidden: boolean,
  props: Record<string, unknown>,
) {
  const id = adaShapeId(item, el);
  board.shapes.set(id, {
    id,
    type,
    x,
    y,
    opacity: hidden ? 0 : 1,
    props,
    meta: { ada: true, item, el, hidden },
  });
}

function bind(
  board: Desired,
  item: string,
  el: string,
  terminal: 'start' | 'end',
  toEl: string,
  normalizedAnchor: Pt,
) {
  const id = adaBindingId(item, el, terminal);
  board.bindings.set(id, {
    id,
    arrow: adaShapeId(item, el),
    to: adaShapeId(item, toEl),
    terminal,
    normalizedAnchor: { ...normalizedAnchor },
    isPrecise: false,
  });
}

function sameStates(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
