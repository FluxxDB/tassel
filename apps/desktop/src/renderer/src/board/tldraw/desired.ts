// Ada's board as she wants it: every shape and binding of hers, by stable id, in tldraw's terms
// but as plain data. planSync diffs one of these against the next. Pure: no tldraw import.
import type { Pt } from '@tassel/shared/beats';

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
