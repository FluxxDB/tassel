// A group of one of Ada's diagrams: the frame around its nodes, behind them. The student can move
// or erase it, not resize it. Only its border hits, so a click inside it reaches the board or a
// node, never the frame.
import { type JSX, useContext } from 'react';
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, Rectangle2d, T } from 'tldraw';
import { BoardLang } from '../board-lang';
import { GroupFigure } from './figures';
import type { GroupShape } from './types';

export class GroupShapeUtil extends BaseBoxShapeUtil<GroupShape> {
  static override type = 'tassel-group' as const;
  static override props: RecordProps<GroupShape> = {
    w: T.number,
    h: T.number,
    label: T.string,
    sublabel: T.string,
    tone: T.number,
    highlight: T.boolean,
  };

  override getDefaultProps(): GroupShape['props'] {
    return { w: 160, h: 120, label: '', sublabel: '', tone: 0, highlight: false };
  }

  override getGeometry(shape: GroupShape): Rectangle2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false });
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

  override canBind(): boolean {
    return false;
  }

  override getText(shape: GroupShape): string {
    return shape.props.label;
  }

  override getAriaDescriptor(shape: GroupShape): string {
    const { label, sublabel } = shape.props;
    return sublabel === '' ? label : `${label}, ${sublabel}`;
  }

  override component(shape: GroupShape): JSX.Element {
    return (
      <HTMLContainer>
        <Group shape={shape} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: GroupShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 16);
    return path;
  }
}

function Group({ shape }: { shape: GroupShape }): JSX.Element {
  const lang = useContext(BoardLang);
  return <GroupFigure {...shape.props} lang={lang} />;
}
