import type { PaperTarget, Pt } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DFA_WRONG } from '../../../../src/renderer/src/board/marks/fixture-paper';
import {
  arrowFor,
  calloutFor,
  checkFor,
  circleFor,
  type Resolved,
  resolveTarget,
  stepDotFor,
  strikeFor,
  targetExists,
  underlineFor,
} from '../../../../src/renderer/src/board/marks/geometry';
import {
  containFit,
  type Fit,
  rectProjector,
  toScreen,
} from '../../../../src/renderer/src/board/marks/project';

const { elements } = FIXTURE_DFA_WRONG;
const project = rectProjector(1100, 850);
/** The fixture page at half size in a 550×600 panel: { scale: 0.5, x: 0, y: 87.5 }. */
const HALF = containFit({ w: 1100, h: 850 }, { w: 550, h: 600 });

function resolve(target: PaperTarget, fit: Fit = HALF): Resolved {
  const resolved = resolveTarget(target, elements, project, fit);
  if (!resolved) throw new Error(`${JSON.stringify(target)} didn't resolve`);
  return resolved;
}

function expectNear(actual: Pt, expected: Pt, within = 1e-6): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(within);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(within);
}

/** A target that is just a box in panel px, its anchor at the box's top right. */
function boxTarget(x: number, y: number, w: number, h: number): Resolved {
  return {
    anchor: { x: x + w, y },
    center: { x: x + w / 2, y: y + h / 2 },
    radius: 0,
    bbox: { x, y, w, h },
    path: null,
    labelSide: null,
  };
}

describe('resolveTarget', () => {
  it('a state resolves to its projected center and radius', () => {
    const q1 = resolve({ el: 'state:q1' });
    expectNear(q1.center, { x: 214.5, y: 321.25 });
    expect(q1.radius).toBeCloseTo(30.25, 6);
    expect(q1.bbox.x).toBeCloseTo(214.5 - 30.25, 6);
    expect(q1.bbox.y).toBeCloseTo(321.25 - 30.25, 6);
    expect(q1.bbox.w).toBeCloseTo(60.5, 6);
    expect(q1.bbox.h).toBeCloseTo(60.5, 6);
    expect(q1.path).toBeNull();
    expect(q1.labelSide).toBeNull();
  });

  it('an edge resolves to its projected path, its box and the side its label is on', () => {
    const raw = elements.edges['q0>q1'];
    const edge = resolve({ el: 'edge:q0>q1' });
    expect(edge.path).toEqual(raw.path.map((p) => toScreen(p, project, HALF)));
    expect(edge.labelSide).toBe('above');
    expect(edge.radius).toBe(0);
    // Its box covers the path and its label.
    const label = toScreen(raw.label as Pt, project, HALF);
    for (const p of [...(edge.path as Pt[]), label]) {
      expect(p.x).toBeGreaterThanOrEqual(edge.bbox.x - 1e-9);
      expect(p.x).toBeLessThanOrEqual(edge.bbox.x + edge.bbox.w + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(edge.bbox.y - 1e-9);
      expect(p.y).toBeLessThanOrEqual(edge.bbox.y + edge.bbox.h + 1e-9);
    }
    // A self-loop's label sits above it too.
    expect(resolve({ el: 'edge:q0>q0' }).labelSide).toBe('above');
  });

  it('the start arrow resolves to its path, which has no label', () => {
    const start = resolve({ el: 'start' });
    expect(start.path).toEqual((elements.start?.path ?? []).map((p) => toScreen(p, project, HALF)));
    expect(start.labelSide).toBeNull();
  });

  it('a point and a box resolve in panel px', () => {
    const at = resolve({ at: { x: 0.5, y: 0.5 } });
    expect(at.anchor).toEqual({ x: 275, y: 300 });
    expect(at.center).toEqual({ x: 275, y: 300 });
    expect(at.radius).toBe(0);
    expect(at.bbox).toEqual({ x: 275, y: 300, w: 0, h: 0 });

    const box = resolve({ box: { x: 0.1, y: 0.2, w: 0.2, h: 0.1 } });
    expect(box.bbox.x).toBeCloseTo(55, 6);
    expect(box.bbox.y).toBeCloseTo(172.5, 6);
    expect(box.bbox.w).toBeCloseTo(110, 6);
    expect(box.bbox.h).toBeCloseTo(42.5, 6);
    expectNear(box.center, { x: 110, y: 193.75 });
    expect(box.path).toBeNull();
  });

  it('an unknown state resolves to null', () => {
    expect(resolveTarget({ el: 'state:q9' }, elements, project, HALF)).toBeNull();
    expect(resolveTarget({ el: 'edge:q1>q0' }, elements, project, HALF)).toBeNull();
    // With no elements known, only points and boxes resolve.
    expect(resolveTarget({ el: 'state:q1' }, null, project, HALF)).toBeNull();
    expect(resolveTarget({ el: 'start' }, { states: {}, edges: {} }, project, HALF)).toBeNull();
    expect(resolveTarget({ at: { x: 0.5, y: 0.5 } }, null, project, HALF)).not.toBeNull();
  });

  it("targetExists says whether the paper has a target's piece of ink", () => {
    expect(targetExists({ el: 'state:q3' }, elements)).toBe(true);
    expect(targetExists({ el: 'edge:q3>q3' }, elements)).toBe(true);
    expect(targetExists({ el: 'start' }, elements)).toBe(true);
    expect(targetExists({ el: 'state:q9' }, elements)).toBe(false);
    expect(targetExists({ el: 'edge:q3>q0' }, elements)).toBe(false);
    expect(targetExists({ el: 'state:q0' }, null)).toBe(false);
    expect(targetExists({ box: { x: 0, y: 0, w: 1, h: 1 } }, null)).toBe(true);
  });
});

describe('circleFor', () => {
  it("rings a state at 1.35 × its radius and pads an edge's box by 14", () => {
    const q1 = resolve({ el: 'state:q1' });
    const ring = circleFor(q1);
    expectNear({ x: ring.cx, y: ring.cy }, q1.center);
    expect(ring.rx).toBeCloseTo(1.35 * 30.25, 6);
    expect(ring.ry).toBeCloseTo(1.35 * 30.25, 6);

    const loop = resolve({ el: 'edge:q0>q0' });
    expect(circleFor(loop)).toEqual({
      cx: loop.bbox.x + loop.bbox.w / 2,
      cy: loop.bbox.y + loop.bbox.h / 2,
      rx: loop.bbox.w / 2 + 14,
      ry: loop.bbox.h / 2 + 14,
    });
  });
});

describe('stepDotFor', () => {
  it('puts dot 2 below the q0→q1 edge, between q0 and q1, and shifts a repeat by 30', () => {
    const q0 = resolve({ el: 'state:q0' });
    const q1 = resolve({ el: 'state:q1' });
    const edge = resolve({ el: 'edge:q0>q1' });
    const [from, to] = edge.path as Pt[];
    const dot = stepDotFor(edge, 0);
    expect(dot.x).toBeGreaterThan(q0.center.x + q0.radius);
    expect(dot.x).toBeLessThan(q1.center.x - q1.radius);
    // Its midpoint, moved 26 px away from the label above: below.
    expectNear(dot, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 26 });
    // The same edge numbered again: 30 px along it, from q0 toward q1.
    expectNear(stepDotFor(edge, 1), { x: dot.x + 30, y: dot.y });
    expectNear(stepDotFor(edge, 2), { x: dot.x + 60, y: dot.y });
  });

  it("puts a self-loop's dot 22 px left of its leftmost point, and a repeat 30 px down", () => {
    const loop = resolve({ el: 'edge:q0>q0' });
    const leftmost = (loop.path as Pt[]).reduce((a, b) => (b.x < a.x ? b : a));
    expectNear(stepDotFor(loop, 0), { x: leftmost.x - 22, y: leftmost.y });
    expectNear(stepDotFor(loop, 2), { x: leftmost.x - 22, y: leftmost.y + 60 });
  });

  it("puts a state's dot below and left of it, and a point's or box's at its anchor", () => {
    const q1 = resolve({ el: 'state:q1' });
    expectNear(stepDotFor(q1, 0), {
      x: q1.center.x - 0.7 * (q1.radius + 18),
      y: q1.center.y + 0.7 * (q1.radius + 18),
    });
    const at = resolve({ at: { x: 0.5, y: 0.5 } });
    expect(stepDotFor(at, 0)).toEqual(at.anchor);
    const box = resolve({ box: { x: 0.1, y: 0.2, w: 0.2, h: 0.1 } });
    expect(stepDotFor(box, 0)).toEqual(box.anchor);
  });

  it('moves away from a label below its edge, and below an edge with no label', () => {
    const edge: Resolved = {
      ...boxTarget(100, 100, 100, 0),
      path: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      labelSide: 'below',
    };
    expectNear(stepDotFor(edge, 0), { x: 150, y: 74 });
    expectNear(stepDotFor({ ...edge, labelSide: null }, 0), { x: 150, y: 126 });
  });
});

describe('calloutFor', () => {
  it('sits above and right of its target, 24 px off its box, with a leader to the anchor', () => {
    const target = boxTarget(100, 200, 60, 40);
    const placed = calloutFor(target, { w: 200, h: 44 }, { w: 800, h: 600 });
    expect(placed.x).toBe(184);
    expect(placed.y).toBe(132);
    // A quadratic curve from the pill's nearest edge midpoint (its left) to the anchor.
    expect(placed.leader[0]).toEqual({ x: 184, y: 154 });
    expect(placed.leader[2]).toEqual(target.anchor);
  });

  it('keeps a 320×80 pill inside a 490×400 panel for a target at its top-right corner', () => {
    const target = boxTarget(430, 20, 40, 40);
    const { x, y, leader } = calloutFor(target, { w: 320, h: 80 }, { w: 490, h: 400 });
    expect(x).toBeGreaterThanOrEqual(14);
    expect(x + 320).toBeLessThanOrEqual(490 - 14);
    expect(y).toBeGreaterThanOrEqual(54);
    expect(y + 80).toBeLessThanOrEqual(400 - 14);
    // Flipped left of the target, and below it.
    expect(x).toBe(430 - 24 - 320);
    expect(y).toBe(20 + 40 + 24);
    expect(leader[2]).toEqual(target.anchor);
  });

  it('clamps a pill that fits on neither side to 14 px inside the panel', () => {
    const placed = calloutFor(boxTarget(200, 300, 100, 80), { w: 320, h: 80 }, { w: 490, h: 400 });
    expect(placed.x).toBe(14);
    expect(placed.y).toBe(196);
    // A tall target near the top: flipped below it, then held 14 px above the panel's bottom.
    const low = calloutFor(boxTarget(60, 40, 40, 300), { w: 320, h: 80 }, { w: 490, h: 400 });
    expect(low.y).toBe(400 - 14 - 80);
  });
});

describe('the other marks', () => {
  it('an arrow stops short of a state and ends in a 10 px open head', () => {
    const q1 = resolve({ el: 'state:q1' });
    const arrow = arrowFor(resolve({ at: { x: 0.39, y: 0.2 } }), q1);
    if (!arrow) throw new Error('no arrow from the point to q1');
    const { line, head } = arrow;
    const [start, end] = line;
    expectNear(start, toScreen({ x: 0.39, y: 0.2 }, project, HALF));
    // Straight down onto q1, 8 px above its ink.
    expectNear(end, { x: q1.center.x, y: q1.center.y - q1.radius - 8 });
    expect(head[1]).toEqual(end);
    for (const tip of [head[0], head[2]]) {
      expect(Math.hypot(tip.x - end.x, tip.y - end.y)).toBeCloseTo(10, 6);
      expect(tip.y).toBeLessThan(end.y);
    }
    // Nothing to draw between two targets that overlap.
    expect(arrowFor(q1, q1)).toBeNull();
  });

  it('a strike crosses a state, and a check sits at the anchor', () => {
    const q2 = resolve({ el: 'state:q2' });
    const [a, b] = strikeFor(q2);
    expectNear({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, q2.center);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(2 * q2.radius);
    const [, corner] = checkFor(q2);
    expect(Math.hypot(corner.x - q2.anchor.x, corner.y - q2.anchor.y)).toBeLessThan(10);
  });
});

describe('underline', () => {
  it('runs just under handwriting, the width of its box', () => {
    // Live test: "underline the IP and the subnet" drew callout bubbles instead.
    const box = resolve({ box: { x: 0.1, y: 0.2, w: 0.2, h: 0.1 } });
    const [a, b] = underlineFor(box);
    const bottom = box.bbox.y + box.bbox.h;
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.y).toBeGreaterThan(bottom);
    expect(a.y - bottom).toBeLessThan(8);
    expect(a.x).toBeCloseTo(box.bbox.x, 6);
    expect(b.x).toBeCloseTo(box.bbox.x + box.bbox.w, 6);
  });

  it('runs under a state, the width of the circle', () => {
    const q2 = resolve({ el: 'state:q2' });
    const [a, b] = underlineFor(q2);
    expect(a.y).toBeGreaterThan(q2.center.y + q2.radius);
    expect(b.x - a.x).toBeCloseTo(2 * q2.radius, 6);
  });
});

describe('marks follow the panel', () => {
  it("marks follow the panel's size", () => {
    // The paper panel at 1440×900 and at 1024×680, alone and beside the board.
    const panels = [
      { w: 1408, h: 736 },
      { w: 698, h: 736 },
      { w: 992, h: 516 },
      { w: 490, h: 516 },
    ];
    for (const panel of panels) {
      const fit = containFit({ w: 1100, h: 850 }, panel);
      const q1 = resolve({ el: 'state:q1' }, fit);
      const center = toScreen(elements.states.q1.center, project, fit);
      expectNear(q1.center, center, 0.5);
      const edge = resolve({ el: 'edge:q0>q1' }, fit);
      elements.edges['q0>q1'].path.forEach((p, i) => {
        expectNear((edge.path as Pt[])[i], toScreen(p, project, fit), 0.5);
      });
      // Marks are drawn in panel px: dot 2 keeps its 26 px from the edge at every size.
      const [from, to] = edge.path as Pt[];
      expect(stepDotFor(edge, 0).y - (from.y + to.y) / 2).toBeCloseTo(26, 6);
    }
  });
});
