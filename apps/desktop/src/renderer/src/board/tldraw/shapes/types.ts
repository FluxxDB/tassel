// Ada's shapes as tldraw records (https://tldraw.dev/docs/shapes). Their props are the
// figures' (figures.tsx), so a shape draws exactly what desired.ts asks for.
import type { TLShape } from 'tldraw';
import type { GroupProps, NodeProps, NoteProps, StateProps, TraceProps } from './figures';

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'tassel-state': StateProps;
    'tassel-trace': TraceProps;
    'tassel-note': Omit<NoteProps, 'transparent'>;
    'tassel-node': NodeProps;
    'tassel-group': GroupProps;
  }
}

export type StateShape = TLShape<'tassel-state'>;
export type TraceShape = TLShape<'tassel-trace'>;
export type NoteShape = TLShape<'tassel-note'>;
export type NodeShape = TLShape<'tassel-node'>;
export type GroupShape = TLShape<'tassel-group'>;
