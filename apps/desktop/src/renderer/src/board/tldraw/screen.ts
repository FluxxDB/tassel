import type { CSSProperties } from 'react';
// Screen primitives use the same tldraw records and diff engine as the regular whiteboard.
import { getIndexAbove, type IndexKey, toRichText } from 'tldraw';
import type { ScreenMark } from '../../../../shared/screen-bridge';
import type { Desired, DesiredShape } from './desired';

export function screenDesired(
  marks: readonly ScreenMark[],
  width: number,
  height: number,
): Desired {
  const shapes = new Map<string, DesiredShape>();
  for (const mark of marks) {
    const a = mark.points[0];
    if (!a) continue;
    const b = mark.points[1] ?? a;
    const color = mark.color ?? 'violet';
    let x = a.x * width,
      y = a.y * height;
    let type: DesiredShape['type'];
    let props: Record<string, unknown>;
    const stroke = { color, size: 's', dash: 'solid' };
    if (mark.kind === 'text') {
      type = 'text';
      props = {
        color,
        size: 's',
        font: 'sans',
        richText: toRichText(mark.text ?? ''),
        autoSize: true,
        w: 300,
      };
    } else if (['circle', 'rectangle', 'pointer'].includes(mark.kind)) {
      type = 'geo';
      x = mark.kind === 'pointer' ? x - 9 : Math.min(a.x, b.x) * width;
      y = mark.kind === 'pointer' ? y - 9 : Math.min(a.y, b.y) * height;
      props = {
        ...stroke,
        geo: mark.kind === 'rectangle' ? 'rectangle' : 'ellipse',
        fill: 'none',
        w: mark.kind === 'pointer' ? 18 : Math.max(1, Math.abs(b.x - a.x) * width),
        h: mark.kind === 'pointer' ? 18 : Math.max(1, Math.abs(b.y - a.y) * height),
      };
    } else if (mark.kind === 'arrow') {
      type = 'arrow';
      props = {
        ...stroke,
        start: { x: 0, y: 0 },
        end: { x: (b.x - a.x) * width, y: (b.y - a.y) * height },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        bend: 0,
      };
    } else {
      type = 'line';
      let index = 'a0' as IndexKey;
      const points = Object.fromEntries(
        mark.points.map((p) => {
          index = getIndexAbove(index);
          return [index, { id: index, index, x: p.x * width - x, y: p.y * height - y }];
        }),
      );
      // A tap remains visible; tldraw lines need two points.
      if (mark.points.length === 1) {
        index = getIndexAbove(index);
        points[index] = { id: index, index, x: 1, y: 1 };
      }
      props = { ...stroke, spline: 'line', points };
    }
    const id = `shape:screen.${mark.id}`;
    shapes.set(id, {
      id,
      type,
      x,
      y,
      opacity: 1,
      props,
      meta: { ada: true, item: mark.id, el: mark.kind, hidden: false },
    });
  }
  return { shapes, bindings: new Map() };
}

/** Geometry is in display units; figures retain their regular whiteboard typography. */
export function screenShapeStyle(shape: { meta: Record<string, unknown> }): CSSProperties {
  const color = shape.meta.screenColor;
  const ink = color === 'violet' ? '#7d4fc4' : String(color);
  return {
    transform: `scale(${Number(shape.meta.screenScale ?? 1)})`,
    transformOrigin: 'top left',
    ...(color
      ? {
          '--color-ink': ink,
          '--color-smoke-text': ink,
          '--color-hairline': ink,
          '--color-iris-ink': ink,
          '--color-paper': 'transparent',
        }
      : {}),
  };
}
