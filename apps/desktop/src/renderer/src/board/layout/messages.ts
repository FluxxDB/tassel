// What the layout client and its worker say to each other: a spec to lay out, and its layout or
// the reason there is none, matched by id.
import type { AutomatonSpec } from '@tassel/shared/beats';
import type { AutomatonLayout } from './types';

export type ToLayoutWorker = { id: number; spec: AutomatonSpec };

export type FromLayoutWorker =
  | { id: number; layout: AutomatonLayout }
  | { id: number; error: string };
