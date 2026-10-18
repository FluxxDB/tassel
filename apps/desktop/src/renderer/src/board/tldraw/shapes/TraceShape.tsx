// Ada's trace card: a run of an automaton on an input, step by step, then its verdict. The
// student can move or erase it, not resize it: Track B's placement sized it for every step.

import type { JSX } from 'react';
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, T } from 'tldraw';
import { screenShapeStyle } from '../screen';
import { TraceCard } from './figures';
import type { TraceShape } from './types';

export class TraceShapeUtil extends BaseBoxShapeUtil<TraceShape> {
  static override type = 'tassel-trace' as const;
  static override props: RecordProps<TraceShape> = {
    w: T.number,
    h: T.number,
    lang: T.literalEnum('en', 'es', 'ko'),
    input: T.string,
    title: T.string.nullable(),
    kind: T.literalEnum('dfa', 'nfa'),
    subject: T.literalEnum('student', 'tutor'),
    rows: T.arrayOf(
      T.object({
        symbol: T.string,
        from: T.string,
        to: T.string,
        loop: T.boolean,
        stuck: T.boolean,
      }),
    ),
    shown: T.number,
    verdict: T.object({
      got: T.literalEnum('accept', 'reject'),
      note: T.string.nullable(),
    }).nullable(),
  };

  override getDefaultProps(): TraceShape['props'] {
    return {
      w: 480,
      h: 132,
      lang: 'en',
      input: '',
      title: null,
      kind: 'dfa',
      subject: 'tutor',
      rows: [],
      shown: 0,
      verdict: null,
    };
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

  override component(shape: TraceShape): JSX.Element {
    return (
      <HTMLContainer style={screenShapeStyle(shape)}>
        <TraceCard
          {...shape.props}
          w={shape.props.w / Number(shape.meta.screenScale ?? 1)}
          h={shape.props.h / Number(shape.meta.screenScale ?? 1)}
        />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: TraceShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 16);
    return path;
  }
}
