// Ada's board as data: the automata, diagrams, trace cards and notes she has put on it, what of each is
// revealed or highlighted, and which item has the camera. reduceBoard changes it one action at a
// time; placement.ts lays it out; Task 5 draws it with tldraw.
import type { AutomatonSpec, DiagramSpec, ElementRef, StateId } from '@tassel/shared/beats';
import type { AutomatonRun } from '../automata/run';

export interface AutomatonItem {
  kind: 'automaton';
  id: string;
  title: string | null;
  spec: AutomatonSpec;
  /** What she has shown so far, in the order she showed it. */
  revealed: 'all' | ElementRef[];
  highlighted: ElementRef[];
  /** Where a trace on this automaton is now: its token's states. */
  current: StateId[];
}

/**
 * A general diagram (a network, a flowchart, a tree): groups, nodes and edges, laid out by the
 * app. Its pieces are `group:ID`, `node:ID` and `edge:A>B` (diagram.ts's diagramElements).
 */
export interface DiagramItem {
  kind: 'diagram';
  id: string;
  title: string | null;
  spec: DiagramSpec;
  /** What she has shown so far, in the order she showed it. */
  revealed: 'all' | ElementRef[];
  highlighted: ElementRef[];
}

export interface TraceItem {
  kind: 'trace';
  id: string;
  title: string | null;
  spec: AutomatonSpec;
  input: string;
  run: AutomatonRun;
  /** How many of the run's steps the card shows. */
  shown: number;
  /** Whose automaton it is: "Your DFA" or "This DFA". */
  subject: 'student' | 'tutor';
  /** The automaton item the trace moves a token on, if any. */
  on: string | null;
  verdict: {
    got: 'accept' | 'reject';
    expected: 'accept' | 'reject' | null;
    note: string | null;
  } | null;
}

export interface NoteItem {
  kind: 'note';
  id: string;
  text: string;
  near: { item: string; el: ElementRef } | null;
}

export type BoardItem = AutomatonItem | DiagramItem | TraceItem | NoteItem;

export interface BoardScene {
  items: BoardItem[];
  /** The item the camera fits, or null for everything. */
  focus: string | null;
  /** Bumped by every change. */
  rev: number;
}

/** Motion the board plays once, with no lasting change to the scene. */
export type BoardEffect =
  | { type: 'pulse'; item: string; el: ElementRef }
  | { type: 'glide'; item: string; edges: ElementRef[] };

export const EMPTY_SCENE: BoardScene = { items: [], focus: null, rev: 0 };
