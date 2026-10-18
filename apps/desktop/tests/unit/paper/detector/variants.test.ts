import { makeClip, renderFrame, VARIANTS, type VariantName } from '@tassel/paper-synth';
import { describe, expect, it } from 'vitest';
import { darkCells } from '../../../../src/renderer/src/paper/detector/cells';
import { toGray } from '../../../../src/renderer/src/paper/detector/gray';
import { compareSize } from '../../../../src/renderer/src/paper/detector/homography';
import { DEFAULT_PARAMS } from '../../../../src/renderer/src/paper/detector/params';
import {
  cellsOf,
  expectMaskOn,
  expectTheTriggers,
  FRAME_H,
  FRAME_W,
  type HarnessOptions,
  type HarnessRun,
  runClip,
  warpGray,
} from './harness';

// Each variant renders up to 280 frames through the harness.
const SLOW = 60_000;

const runs = new Map<string, HarnessRun>();
function run(name: VariantName, opts: HarnessOptions = {}): HarnessRun {
  const key = `${name}${JSON.stringify(opts)}`;
  let result = runs.get(key);
  if (!result) {
    result = runClip(name, opts);
    runs.set(key, result);
  }
  return result;
}

/** Whether the truth lists the hand in the scene at t. */
const handAt = (name: VariantName, t: number) =>
  makeClip(name).truth.hand.some((h) => t >= h.fromMs && t <= h.toMs);

describe('the variants through the detector', () => {
  it(
    'dfa-demo triggers three times, each mask covering only its new groups’ cells',
    () => {
      const result = run('dfa-demo');
      expectTheTriggers('dfa-demo', result);
      const expected = makeClip('dfa-demo').truth.expectedTriggers;
      for (const [i, trigger] of result.triggers.entries()) {
        expectMaskOn('dfa-demo', trigger, expected[i]?.groups ?? []);
      }
    },
    SLOW,
  );

  it(
    'dfa-short triggers once',
    () => {
      const result = run('dfa-short');
      expectTheTriggers('dfa-short', result);
      expectMaskOn('dfa-short', result.triggers[0], ['q0']);
    },
    SLOW,
  );

  it(
    'dfa-short with noise on, and with ±2 px quad jitter, still triggers once and never emits page',
    () => {
      for (const opts of [{ noise: true }, { jitter: 2 }, { noise: true, jitter: 2 }]) {
        const result = run('dfa-short', opts);
        expect(
          result.triggers.map((t) => t.reason),
          JSON.stringify(opts),
        ).toEqual(['ink']);
        expectTheTriggers('dfa-short', result);
        expectMaskOn('dfa-short', result.triggers[0], ['q0']);
      }
    },
    SLOW,
  );

  it(
    'hand-rests never triggers while the hand rests, and its one trigger’s mask excludes the hand’s cells',
    () => {
      const result = run('hand-rests');
      expectTheTriggers('hand-rests', result);
      const [trigger] = result.triggers;
      expect(handAt('hand-rests', trigger?.t ?? 0)).toBe(false);
      // While it rests the hand reads as an occluder: nothing is compared under it and nothing
      // goes out, though the rest of the page stays quiet and compared (2026-10-18).
      expect(
        result.log.filter((s) => s.t > 4600 && s.t < 10000).some((s) => s.stats.occluded),
      ).toBe(true);
      // The hand's cells, from the page as it lies with the hand at rest.
      const clip = makeClip('hand-rests');
      const quad = clip.pageQuadAt(7000, FRAME_W, FRAME_H);
      const size = compareSize(quad, 800, 16);
      const gray = toGray(
        renderFrame(clip, 7000, { width: FRAME_W, height: FRAME_H }),
        FRAME_W,
        FRAME_H,
      );
      const hand = darkCells(
        warpGray(gray, FRAME_W, FRAME_H, quad, size.width, size.height),
        size.width,
        size.height,
        DEFAULT_PARAMS,
      );
      expect(hand.length).toBeGreaterThan(10);
      const mask = new Set(
        (trigger?.mask?.cells ?? []).map(([c, r]) => r * (trigger?.mask?.cols ?? 0) + c),
      );
      expect(hand.filter((c) => mask.has(c))).toEqual([]);
      expectMaskOn('hand-rests', trigger, ['q0']);
    },
    SLOW,
  );

  it(
    'starts-with-hand takes its first reference only after the hand leaves, and triggers only for q1',
    () => {
      const result = run('starts-with-hand');
      const first = result.log.find((s) => s.stats.refAgeMs !== null);
      expect(first?.t).toBeGreaterThanOrEqual(4500);
      expect(handAt('starts-with-hand', first?.t ?? 0)).toBe(false);
      expectTheTriggers('starts-with-hand', result);
      expectMaskOn('starts-with-hand', result.triggers[0], ['q1']);
    },
    SLOW,
  );

  it(
    'shadow-pass, exposure-step and slow-drift never trigger',
    () => {
      for (const name of ['shadow-pass', 'exposure-step', 'slow-drift'] as const) {
        expect(run(name).triggers, name).toEqual([]);
      }
    },
    SLOW,
  );

  it(
    'slow-drift refreshes the reference by 31 s',
    () => {
      const result = run('slow-drift');
      const taken = [
        ...new Set(
          result.log
            .filter((s) => s.stats.refAgeMs !== null)
            .map((s) => s.t - (s.stats.refAgeMs ?? 0)),
        ),
      ];
      expect(taken[0]).toBe(1000);
      expect(taken[1]).toBeGreaterThan(30000);
      expect(taken[1]).toBeLessThanOrEqual(31000);
    },
    SLOW,
  );

  it(
    'page-shift emits one page trigger and no ink trigger',
    () => {
      const result = run('page-shift');
      expectTheTriggers('page-shift', result);
      expect(result.triggers[0]).toMatchObject({
        reason: 'page',
        mask: null,
        cropRect: null,
        pageFound: true,
      });
    },
    SLOW,
  );

  it(
    'slide-and-hold emits one page trigger when the hand leaves, then ink for q1',
    () => {
      const result = run('slide-and-hold');
      expectTheTriggers('slide-and-hold', result);
      expect(handAt('slide-and-hold', result.triggers[0]?.t ?? 0)).toBe(false);
      expectMaskOn('slide-and-hold', result.triggers[1], ['q1']);
    },
    SLOW,
  );

  it(
    'page-flip emits ink for q0, then one page trigger for the fresh sheet, and no erasure ink trigger',
    () => {
      const result = run('page-flip');
      expectTheTriggers('page-flip', result);
      expectMaskOn('page-flip', result.triggers[0], ['q0']);
    },
    SLOW,
  );

  it(
    'dfa-demo never reads its printed statement, its margin line or a label as an occluder',
    () => {
      const result = run('dfa-demo');
      const handless = result.log.filter((s) => !handAt('dfa-demo', s.t));
      expect(handless.length).toBeGreaterThan(100);
      expect(handless.filter((s) => s.stats.occluded).map((s) => s.t)).toEqual([]);
      // The finished page, directly: no dark cells at all.
      const clip = makeClip('dfa-demo');
      const quad = clip.pageQuadAt(55000, FRAME_W, FRAME_H);
      const size = compareSize(quad, 800, 16);
      const gray = toGray(
        renderFrame(clip, 55000, { width: FRAME_W, height: FRAME_H }),
        FRAME_W,
        FRAME_H,
      );
      expect(
        darkCells(
          warpGray(gray, FRAME_W, FRAME_H, quad, size.width, size.height),
          size.width,
          size.height,
          DEFAULT_PARAMS,
        ),
      ).toEqual([]);
    },
    SLOW,
  );

  it(
    'erase triggers ink with the label’s cells',
    () => {
      const result = run('erase');
      expectTheTriggers('erase', result);
      expectMaskOn('erase', result.triggers[0], ['q0-label-erase']);
      expect(result.triggers[0]?.erasePixels).toBeGreaterThan(result.triggers[0]?.inkPixels ?? 0);
    },
    SLOW,
  );
});

describe('the re-review’s variants', () => {
  it(
    'printed-box (N1): the dark printed box becomes scenery after 10 s, the reference is taken, and q0 triggers',
    () => {
      const result = run('printed-box');
      const first = result.log.find((s) => s.stats.refAgeMs !== null);
      // Occluded from the first stable sample (1.0 s), scenery ten seconds later.
      expect(first?.t).toBe(11000);
      expect(result.log.filter((s) => s.t < 11000).some((s) => s.stats.occluded)).toBe(true);
      expectTheTriggers('printed-box', result);
      expectMaskOn('printed-box', result.triggers[0], ['q0']);
    },
    SLOW,
  );

  it(
    'dark-desk (N1): through the fallback crop the dark desk becomes scenery, and q0 triggers',
    () => {
      const fallback = run('dark-desk', { fallback: true });
      expect(fallback.log.find((s) => s.stats.refAgeMs !== null)?.t).toBe(11000);
      expect(fallback.stats).toMatchObject({ cols: 40, rows: 30 });
      expectTheTriggers('dark-desk', fallback);
      expect(fallback.triggers[0]?.pageFound).toBe(false);
      // With the page found, the desk is never in view: the reference comes at once.
      const found = run('dark-desk');
      expect(found.log.find((s) => s.stats.refAgeMs !== null)?.t).toBe(1000);
      expectTheTriggers('dark-desk', found);
      expectMaskOn('dark-desk', found.triggers[0], ['q0']);
    },
    SLOW,
  );

  it(
    'bold-pen (N2): felt-tip strokes fill their cells, and still trigger once for q0',
    () => {
      const result = run('bold-pen');
      const compared = result.log.find((s) => s.t > 4500 && s.stats.changed.length > 0);
      expect(compared?.stats.solid.length).toBeGreaterThan(0);
      expectTheTriggers('bold-pen', result);
      expectMaskOn('bold-pen', result.triggers[0], ['q0']);
    },
    SLOW,
  );
});

describe('slight movement (owner, 2026-10-18)', () => {
  it(
    'nudge-while-writing: a sheet that never quite settles still gives one ink trigger for q1',
    () => {
      // The original detector never sent anything here: every sample read as motion.
      const result = run('nudge-while-writing');
      expectTheTriggers('nudge-while-writing', result);
      // The crop covers q1; a few pixels of jitter may spill a stray cell or two past it.
      const trigger = result.triggers[0];
      const { cols, rows, cells } = trigger?.mask ?? { cols: 0, rows: 0, cells: [] };
      const [q1] = makeClip('nudge-while-writing').truth.groups.filter((g) => g.id === 'q1');
      if (!q1) throw new Error('no q1 in the truth');
      const near = new Set(cellsOf(q1.bbox, cols, rows, 1));
      const inside = cells.filter(([c, r]) => near.has(r * cols + c));
      expect(inside.length).toBeGreaterThan(0);
      expect(cells.length - inside.length).toBeLessThanOrEqual(2);
    },
    SLOW,
  );
});

describe('every variant', () => {
  it('no variant triggers twice within 5 s', () => {
    for (const name of VARIANTS) {
      const times = run(name).triggers.map((t) => t.t);
      for (let i = 1; i < times.length; i++) {
        expect((times[i] ?? 0) - (times[i - 1] ?? 0), name).toBeGreaterThanOrEqual(5000);
      }
    }
  }, 240_000);
});
