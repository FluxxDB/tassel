// An automaton laid out for Ada's board: where its states, edge curves, labels and start arrow go,
// in board px, with the origin top-left and y down. Graphviz makes it (layoutWithViz, in a
// worker); fallbackLayout makes one without Graphviz, to the same contract.
import type { Pt, StateId } from '@tassel/shared/beats';

/** A state's radius on the board, in px. */
export const STATE_RADIUS = 32;

/** The empty space around a layout's content, on every side. */
export const LAYOUT_MARGIN = 16;

/** The start arrow's length, from its tail to the start state's edge. */
export const START_ARROW_LENGTH = 48;

export type LoopSide = 'top' | 'bottom' | 'left' | 'right';

export interface EdgeLayout {
  /**
   * How far the curve's middle sits from the chord between the two state centers: positive to the
   * left of tail → head on the y-down board (ruling P5-R2), 0 for a straight edge or a self-loop.
   * Task 5 negates it for tldraw, whose positive bend is to the right.
   */
  bend: number;
  /** Where the edge's symbols go. */
  label: Pt;
  /** A self-loop's side of its state, else null. */
  loop: LoopSide | null;
}

export interface AutomatonLayout {
  width: number;
  height: number;
  /**
   * State centers. Take the states' order from the spec, not from this object: it lists
   * integer-like ids such as "0" and "10" (M19) first.
   */
  states: Record<StateId, { x: number; y: number; r: number }>;
  /** One per merged edge, keyed 'q0>q1'. */
  edges: Record<string, EdgeLayout>;
  /** `to` is on the start state's edge; `from` is START_ARROW_LENGTH out from it. */
  start: { from: Pt; to: Pt };
}

/** A box on the board: its top-left, width and height, in px. */
export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a diagram's layout needs measured first: each node card's size and group label block's. */
export interface DiagramSizes {
  nodes: Record<StateId, { w: number; h: number }>;
  groups: Record<StateId, { w: number; h: number }>;
}

/**
 * A diagram laid out (board.diagram), in board px with the origin top-left: each node card's box,
 * each group's frame around its nodes (its label block at its top-left), and each drawn edge's
 * bend, keyed 'a>b', as AutomatonLayout's EdgeLayout.bend measures it. Graphviz makes it
 * (layoutDiagramWithViz); fallbackDiagramLayout makes one on a grid, to the same contract.
 */
export interface DiagramLayout {
  kind: 'diagram';
  width: number;
  height: number;
  nodes: Record<StateId, LayoutBox>;
  groups: Record<StateId, LayoutBox>;
  edges: Record<string, { bend: number }>;
}

/** What the board store holds for an item: an automaton's layout or a diagram's. */
export type BoardLayout = AutomatonLayout | DiagramLayout;

export function isDiagramLayout(layout: BoardLayout | undefined): layout is DiagramLayout {
  return layout !== undefined && 'kind' in layout && layout.kind === 'diagram';
}

/** `layout` when it's an automaton's. */
export function automatonLayoutOf(layout: BoardLayout | undefined): AutomatonLayout | undefined {
  return layout === undefined || isDiagramLayout(layout) ? undefined : layout;
}
