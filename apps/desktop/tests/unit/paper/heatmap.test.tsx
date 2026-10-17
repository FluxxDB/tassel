// @vitest-environment jsdom
// The debug heatmap: what the detector compares, drawn over the feed. A fake 2D context records
// the drawing, since jsdom has no canvas.
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectorStats } from '../../../src/renderer/src/paper/contracts';
import { Heatmap } from '../../../src/renderer/src/paper/debug/Heatmap';

interface Call {
  name: string;
  args: number[];
  alpha: number;
  dashed: boolean;
  lineWidth: number;
}

function fakeContext() {
  const calls: Call[] = [];
  let dash: number[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    setLineDash: (segments: number[]) => {
      dash = segments;
    },
  } as Record<string, unknown>;
  for (const name of [
    'setTransform',
    'clearRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'fill',
    'stroke',
  ]) {
    ctx[name] = (...args: number[]) =>
      calls.push({
        name,
        args,
        alpha: ctx.globalAlpha as number,
        dashed: dash.length > 0,
        lineWidth: ctx.lineWidth as number,
      });
  }
  return { ctx, calls };
}

// A 50 × 38 grid on a page whose quad is the frame's top-left 500 × 380: 10 frame px a cell.
const STATS: DetectorStats = {
  t: 1_000,
  busy: false,
  occluded: false,
  quiet: 2,
  cols: 50,
  rows: 38,
  changed: [0, 51, 99],
  solid: [5],
  quad: [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 380 },
    { x: 0, y: 380 },
  ],
  refAgeMs: 200,
  triggers: 0,
  opencv: true,
};

let fake: ReturnType<typeof fakeContext>;

beforeEach(() => {
  fake = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fake.ctx as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal('devicePixelRatio', 2);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Heatmap', () => {
  it('the heatmap draws one quad per changed cell, scaled by devicePixelRatio', () => {
    render(
      <Heatmap
        stats={STATS}
        video={{ w: 960, h: 720 }}
        crop={null}
        transform={{ scale: 0.5, x: 10, y: 20 }}
        box={{ w: 500, h: 400 }}
      />,
    );
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1000, 800]);
    expect(canvas.style.width).toBe('500px');
    expect(canvas.style.height).toBe('400px');
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ name: 'setTransform', args: [2, 0, 0, 2, 0, 0] }),
    );

    const fills = fake.calls.filter((call) => call.name === 'fill');
    // Changed cells in sky at 55%, solid cells in ink at 25%.
    expect(fills.filter((call) => call.alpha === 0.55)).toHaveLength(3);
    expect(fills.filter((call) => call.alpha === 0.25)).toHaveLength(1);
    // The page quad: one dashed 1.5 px stroke.
    const strokes = fake.calls.filter((call) => call.name === 'stroke');
    expect(strokes).toEqual([expect.objectContaining({ dashed: true, lineWidth: 1.5 })]);
    expect(fake.calls.filter((call) => call.name === 'beginPath')).toHaveLength(5);

    // Each cell goes page → frame (the quad's homography) → CSS (the video's transform).
    const starts = fake.calls.filter((call) => call.name === 'moveTo').map((call) => call.args);
    expect(starts[0]?.[0]).toBeCloseTo(10); // cell 0 at frame (0, 0)
    expect(starts[0]?.[1]).toBeCloseTo(20);
    expect(starts[1]?.[0]).toBeCloseTo(15); // cell 51 is column 1, row 1: frame (10, 10)
    expect(starts[1]?.[1]).toBeCloseTo(25);
  });

  it('places cells inside a crop: a window capture’s content, below its title bar', () => {
    render(
      <Heatmap
        stats={{ ...STATS, changed: [0], solid: [] }}
        video={{ w: 960, h: 800 }}
        crop={{ x: 0, y: 0.1, w: 1, h: 0.9 }}
        transform={{ scale: 1, x: 0, y: -80 }}
        box={{ w: 960, h: 720 }}
      />,
    );
    // The quad is in pixels of the content; the content starts 80 px down the video.
    const [start] = fake.calls.filter((call) => call.name === 'moveTo');
    expect(start?.args[0]).toBeCloseTo(0);
    expect(start?.args[1]).toBeCloseTo(0);
  });

  it('draws nothing but a clear canvas until the detector has a page', () => {
    render(
      <Heatmap
        stats={{ ...STATS, quad: null }}
        video={{ w: 960, h: 720 }}
        crop={null}
        transform={{ scale: 0.5, x: 10, y: 20 }}
        box={{ w: 500, h: 400 }}
      />,
    );
    expect(fake.calls.map((call) => call.name)).toEqual(['setTransform', 'clearRect']);
  });
});
