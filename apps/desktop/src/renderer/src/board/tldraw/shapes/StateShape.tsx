// A state of one of Ada's automata: a circle the student can select, move, erase and bind her
// arrows to, but not resize or rotate. It hit-tests and binds as a circle, so arrows meet its rim.
import { type JSX, useContext } from 'react';
import { BaseBoxShapeUtil, Circle2d, HTMLContainer, type RecordProps, T } from 'tldraw';
import { BoardLang } from '../board-lang';
import { StateFigure } from './figures';
import type { StateShape } from './types';

export class StateShapeUtil extends BaseBoxShapeUtil<StateShape> {
  static override type = 'tassel-state' as const;
  static override props: RecordProps<StateShape> = {
    w: T.number,
    h: T.number,
    label: T.string,
    accept: T.boolean,
    ring: T.literalEnum('none', 'highlight', 'current'),
  };

  override getDefaultProps(): StateShape['props'] {
    return { w: 64, h: 64, label: '', accept: false, ring: 'none' };
  }

  override getGeometry(shape: StateShape): Circle2d {
    return new Circle2d({ radius: shape.props.w / 2, isFilled: true });
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

  override getText(shape: StateShape): string {
    return shape.props.label;
  }

  override getAriaDescriptor(shape: StateShape): string {
    return shape.props.label;
  }

  override component(shape: StateShape): JSX.Element {
    return (
      <HTMLContainer>
        <State shape={shape} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: StateShape): Path2D {
    const r = shape.props.w / 2;
    const path = new Path2D();
    path.arc(r, r, r, 0, Math.PI * 2);
    return path;
  }
}

function State({ shape }: { shape: StateShape }): JSX.Element {
  const lang = useContext(BoardLang);
  const { label, accept, ring } = shape.props;
  return <StateFigure label={label} accept={accept} ring={ring} lang={lang} />;
}
