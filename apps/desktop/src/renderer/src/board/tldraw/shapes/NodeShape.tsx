// A node of one of Ada's diagrams: a card the student can select, move, erase and bind her
// arrows to, but not resize or rotate. It hit-tests and binds as its rectangle, so Ada's edges
// meet its border.

import { DIAGRAM_ICONS } from '@tassel/shared/beats';
import { type JSX, useContext } from 'react';
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, T } from 'tldraw';
import { BoardLang } from '../board-lang';
import { screenShapeStyle } from '../screen';
import { NodeFigure } from './figures';
import type { NodeShape } from './types';

export class NodeShapeUtil extends BaseBoxShapeUtil<NodeShape> {
  static override type = 'tassel-node' as const;
  static override props: RecordProps<NodeShape> = {
    w: T.number,
    h: T.number,
    label: T.string,
    sublabel: T.string,
    icon: T.literalEnum(...DIAGRAM_ICONS),
    highlight: T.boolean,
  };

  override getDefaultProps(): NodeShape['props'] {
    return { w: 112, h: 44, label: '', sublabel: '', icon: 'box', highlight: false };
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

  override getText(shape: NodeShape): string {
    return shape.props.label;
  }

  override getAriaDescriptor(shape: NodeShape): string {
    const { label, sublabel } = shape.props;
    return sublabel === '' ? label : `${label}, ${sublabel}`;
  }

  override component(shape: NodeShape): JSX.Element {
    return (
      <HTMLContainer style={screenShapeStyle(shape)}>
        <Node shape={shape} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: NodeShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}

function Node({ shape }: { shape: NodeShape }): JSX.Element {
  const lang = useContext(BoardLang);
  return (
    <NodeFigure
      {...shape.props}
      w={shape.props.w / Number(shape.meta.screenScale ?? 1)}
      h={shape.props.h / Number(shape.meta.screenScale ?? 1)}
      lang={lang}
    />
  );
}
