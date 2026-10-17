import { describe, expect, it } from 'vitest';
import { insideQuad } from '../src/geometry.ts';
import { makeClip, truthJson, VARIANTS } from '../src/index.ts';
import { handBounds, strokeSamples } from '../src/scene.ts';

const W = 960;
const H = 720;

/** True when any part of the hand, pen or forearm overlaps the frame. */
function handInFrame(name: (typeof VARIANTS)[number], tMs: number): boolean {
  const box = handBounds(makeClip(name), tMs, W, H);
  return box !== null && box.x1 > 0 && box.y1 > 0 && box.x0 < W && box.y0 < H;
}

describe('dfa-demo truth', () => {
  const { truth } = makeClip('dfa-demo');

  it('has states q0–q3, with q0 the start state and only q3 accepting', () => {
    expect(truth.dfa.states.map((s) => s.id)).toEqual(['q0', 'q1', 'q2', 'q3']);
    expect(truth.dfa.states.filter((s) => s.start).map((s) => s.id)).toEqual(['q0']);
    expect(truth.dfa.states.filter((s) => s.accept).map((s) => s.id)).toEqual(['q3']);
    expect(truth.dfa.states.map((s) => [s.center.x, s.center.y, s.radius])).toEqual([
      [0.18, 0.55, 0.055],
      [0.39, 0.55, 0.055],
      [0.6, 0.55, 0.055],
      [0.81, 0.55, 0.055],
    ]);
  });

  it('has the five transitions, each label above its arrow', () => {
    expect(truth.dfa.transitions.map((t) => [t.from, t.label, t.to])).toEqual([
      ['q0', '0', 'q1'],
      ['q1', '1', 'q2'],
      ['q2', '0', 'q3'],
      ['q3', '0,1', 'q3'],
      ['q0', '1', 'q0'],
    ]);
    for (const t of truth.dfa.transitions) expect(t.labelAt.y).toBeLessThan(0.55);
  });

  it('expects three ink triggers at 26.7, 38.5 and 47.1 s', () => {
    expect(truth.expectedTriggers.map((t) => [t.reason, t.atMs, t.toleranceMs])).toEqual([
      ['ink', 26700, 700],
      ['ink', 38500, 700],
      ['ink', 47100, 700],
    ]);
    expect(truth.expectedTriggers[0]?.groups).toEqual([
      'start',
      'q0',
      'q0-q1',
      'q1',
      'q1-q2',
      'q2',
      'q2-q3',
      'q3',
    ]);
    expect(truth.expectedTriggers[1]?.groups).toEqual(['loop-q3']);
    expect(truth.expectedTriggers[2]?.groups).toEqual(['loop-q0']);
  });

  it('times its groups as the script says', () => {
    expect(truth.groups.map((g) => [g.id, g.startMs, g.endMs])).toEqual([
      ['start', 6000, 7000],
      ['q0', 7200, 9200],
      ['q0-q1', 9600, 11200],
      ['q1', 11600, 13600],
      ['q1-q2', 14000, 15600],
      ['q2', 16000, 18000],
      ['q2-q3', 18400, 20000],
      ['q3', 20400, 23200],
      ['loop-q3', 32000, 35000],
      ['loop-q0', 41000, 43600],
    ]);
  });
});

describe('every variant', () => {
  it('every stroke point lies inside the page quad at its time', () => {
    for (const name of VARIANTS) {
      const clip = makeClip(name);
      const samples = strokeSamples(clip, W, H);
      // Blank-page variants (shadow-pass, slow-drift) have no handwriting at all.
      expect(samples.length > 0, name).toBe(clip.truth.groups.length > 0);
      for (const s of samples) {
        expect(insideQuad(clip.pageQuadAt(s.tMs, W, H), s), `${name} at ${s.tMs}`).toBe(true);
      }
    }
  });

  it("the hand is out of frame from each expected ink trigger's atMs − 3000 to atMs", () => {
    for (const name of VARIANTS) {
      for (const trigger of makeClip(name).truth.expectedTriggers) {
        if (trigger.reason !== 'ink') continue;
        for (let t = trigger.atMs - 3000; t <= trigger.atMs; t += 50) {
          expect(handInFrame(name, t), `${name} at ${t}`).toBe(false);
        }
      }
    }
  });

  it('lists the hand in its truth exactly while the hand is in frame', () => {
    for (const name of VARIANTS) {
      const clip = makeClip(name);
      const listed = (t: number) => clip.truth.hand.some((h) => t > h.fromMs && t < h.toMs);
      for (let t = 25; t < clip.durationMs; t += 100) {
        if (handInFrame(name, t)) expect(listed(t), `${name} at ${t}`).toBe(true);
        if (!listed(t)) expect(handInFrame(name, t), `${name} at ${t}`).toBe(false);
      }
    }
  });
});

describe('hand timing', () => {
  it('hand-rests keeps the hand out of frame for its first 1.6 s', () => {
    for (let t = 0; t <= 1600; t += 20) expect(handInFrame('hand-rests', t), `${t}`).toBe(false);
    expect(handInFrame('hand-rests', 1800)).toBe(true);
  });

  it('hand-rests lies still on the page from 4.0 to 10.0 s', () => {
    const { hand } = makeClip('hand-rests').truth;
    const rest = hand.find((h) => !h.moving);
    expect(rest).toMatchObject({ onPage: true, toMs: 10000 });
    expect(rest?.fromMs).toBeGreaterThanOrEqual(4000);
    expect(rest?.fromMs).toBeLessThanOrEqual(4400);
    expect(hand.at(-1)?.toMs).toBe(10500);
  });

  it('starts-with-hand rests on the page from the first frame', () => {
    const { hand } = makeClip('starts-with-hand').truth;
    expect(hand[0]).toEqual({ fromMs: 0, toMs: 4000, onPage: true, moving: false });
    expect(handInFrame('starts-with-hand', 0)).toBe(true);
    expect(handInFrame('starts-with-hand', 4600)).toBe(false);
  });
});

describe('truthJson', () => {
  it('adds frame-pixel coordinates beside the page coordinates', () => {
    const json = truthJson(makeClip('dfa-short'), W, H) as Record<string, unknown> & {
      width: number;
      height: number;
      pageQuad: Array<{ x: number; y: number }>;
      dfa: { states: Array<{ center: { x: number; y: number }; centerPx: { x: number } }> };
      groups: Array<{ bbox: object; bboxPx: { x: number; y: number; w: number; h: number } }>;
    };
    expect(json.width).toBe(W);
    expect(json.height).toBe(H);
    expect(json.pageQuad).toHaveLength(4);
    const q0 = json.dfa.states[0];
    // q0 sits 18% across a page 86% of the frame high, centered: about 223 px from the left.
    expect(q0?.centerPx.x).toBeGreaterThan(200);
    expect(q0?.centerPx.x).toBeLessThan(250);
    const box = json.groups[0]?.bboxPx;
    expect(box?.w).toBeGreaterThan(80);
    expect(box?.h).toBeGreaterThan(80);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
