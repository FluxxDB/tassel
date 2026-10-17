// Ada's three shapes as tldraw records (https://tldraw.dev/docs/shapes). Their props are the
// figures' (figures.tsx), so a shape draws exactly what desired.ts asks for.
import type { TLShape } from 'tldraw';
import type { NoteProps, StateProps, TraceProps } from './figures';

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'tassel-state': StateProps;
    'tassel-trace': TraceProps;
    'tassel-note': NoteProps;
  }
}

export type StateShape = TLShape<'tassel-state'>;
export type TraceShape = TLShape<'tassel-trace'>;
export type NoteShape = TLShape<'tassel-note'>;
