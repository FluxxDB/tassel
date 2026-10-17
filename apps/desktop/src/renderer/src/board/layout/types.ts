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
  /** State centers. */
  states: Record<StateId, { x: number; y: number; r: number }>;
  /** One per merged edge, keyed 'q0>q1'. */
  edges: Record<string, EdgeLayout>;
  /** `to` is on the start state's edge; `from` is START_ARROW_LENGTH out from it. */
  start: { from: Pt; to: Pt };
}
