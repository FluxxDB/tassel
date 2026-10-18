import { describe, expect, it } from 'vitest';
import { sampleArc } from '../../../../src/renderer/src/board/tldraw/arc';

describe('sampleArc', () => {
  it('bend 0 is the straight segment, including both terminals', () => {
    expect(sampleArc({ x: 10, y: 20 }, { x: 110, y: 20 }, 0, 3)).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 20 },
      { x: 110, y: 20 },
    ]);
  });
  it('bend 40 puts the middle 40 px to the left on the y-down board', () => {
    const arc = sampleArc({ x: 10, y: 20 }, { x: 110, y: 20 }, 40, 5);
    expect(arc).toHaveLength(5);
    expect(arc[0]).toEqual({ x: 10, y: 20 });
    expect(arc[4]).toEqual({ x: 110, y: 20 });
    expect(arc[2].x).toBeCloseTo(60);
    expect(arc[2].y).toBeCloseTo(-20);
    // All samples lie on the circle through the endpoints and offset midpoint.
    const cy = 31.25;
    for (const p of arc) expect(Math.hypot(p.x - 60, p.y - cy)).toBeCloseTo(51.25);
  });
  it('supports negative bends, major arcs (self-loops), and degenerate inputs', () => {
    expect(sampleArc({ x: 0, y: 0 }, { x: 20, y: 0 }, -50, 3)[1].y).toBeCloseTo(50);
    expect(sampleArc({ x: 2, y: 3 }, { x: 2, y: 3 }, 40, 3)).toEqual(Array(3).fill({ x: 2, y: 3 }));
    expect(sampleArc({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, 0)).toEqual([]);
    expect(sampleArc({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, 1)).toEqual([{ x: 0, y: 0 }]);
  });
});
