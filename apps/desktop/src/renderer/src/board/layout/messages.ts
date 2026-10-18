// What the layout client and its worker say to each other: a spec to lay out (an automaton's, or
// a diagram's with its measured sizes), and its layout or the reason there is none, matched by id.
import type { AutomatonSpec, DiagramSpec } from '@tassel/shared/beats';
import type { BoardLayout, DiagramSizes } from './types';

export type ToLayoutWorker =
  | { id: number; spec: AutomatonSpec }
  | { id: number; diagram: DiagramSpec; sizes: DiagramSizes };

export type FromLayoutWorker = { id: number; layout: BoardLayout } | { id: number; error: string };
