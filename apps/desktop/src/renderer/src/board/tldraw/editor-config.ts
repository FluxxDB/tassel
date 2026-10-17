// What Ada's editor is made of: her shapes, tldraw's arrow with her labels' size, her effects'
// overlay, and the rule that hides what she hasn't revealed. TldrawCanvas mounts tldraw with
// these, and the engine's unit tests build a real editor from them.
import { ArrowShapeUtil, type TLShape } from 'tldraw';
import { AdaEffectsOverlayUtil } from './effects';
import { NoteShapeUtil } from './shapes/NoteShape';
import { StateShapeUtil } from './shapes/StateShape';
import { TraceShapeUtil } from './shapes/TraceShape';

export const SHAPE_UTILS = [
  StateShapeUtil,
  TraceShapeUtil,
  NoteShapeUtil,
  // Ada's transitions label in Geist Mono 15, smaller than tldraw's thinnest size sets them.
  ArrowShapeUtil.configure({
    getCustomDisplayValues: (_editor, shape) =>
      shape.meta.ada === true ? { labelFontSize: 15 } : {},
  }),
];

export const OVERLAY_UTILS = [AdaEffectsOverlayUtil];

/** What Ada hasn't revealed is neither drawn nor hit by the student's tools (P5-R5, I2). */
export function hideUnrevealed(shape: TLShape): 'hidden' | 'inherit' {
  return shape.meta.hidden === true ? 'hidden' : 'inherit';
}
