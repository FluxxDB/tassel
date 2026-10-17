// One of Ada's notes on her board, or the title over one of her automata. The student can move
// or erase it, not resize it: its box is the size its text was measured at.
import type { JSX } from 'react';
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, T } from 'tldraw';
import { NoteFigure } from './figures';
import type { NoteShape } from './types';

export class NoteShapeUtil extends BaseBoxShapeUtil<NoteShape> {
  static override type = 'tassel-note' as const;
  static override props: RecordProps<NoteShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    variant: T.literalEnum('note', 'title'),
  };

  override getDefaultProps(): NoteShape['props'] {
    return { w: 1, h: 1, text: '', variant: 'note' };
  }

  override canResize(): boolean {
    return false;
  }

  override hideResizeHandles(): boolean {
    return true;
  }

  override hideRotateHandle(): boolean {
    return true;
  }

  override getText(shape: NoteShape): string {
    return shape.props.text;
  }

  override getAriaDescriptor(shape: NoteShape): string {
    return shape.props.text;
  }

  override component(shape: NoteShape): JSX.Element {
    return (
      <HTMLContainer>
        <NoteFigure {...shape.props} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: NoteShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, shape.props.variant === 'note' ? 20 : 0);
    return path;
  }
}
