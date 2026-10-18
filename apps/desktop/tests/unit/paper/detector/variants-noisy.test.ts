import { makeClip, VARIANTS } from '@tassel/paper-synth';
import { describe, it } from 'vitest';
import { expectMaskOn, expectTheTriggers, runClip } from './harness';

// Its own file, so Vitest runs it beside variants.test.ts: about 15 runs of up to 280 frames,
// each with sensor noise and a freshly jittered quad on every page sample.
describe('every variant, noisy', () => {
  it('keeps its expected triggers with noise on and ±2 px quad jitter', () => {
    for (const name of VARIANTS) {
      const result = runClip(name, { noise: true, jitter: 2 });
      expectTheTriggers(name, result);
      const expected = makeClip(name).truth.expectedTriggers;
      // A jittering sheet may spill a stray cell past q1; variants.test.ts checks its crop.
      if (name === 'nudge-while-writing') continue;
      result.triggers.forEach((trigger, i) => {
        if (trigger.reason === 'ink') expectMaskOn(name, trigger, expected[i]?.groups ?? []);
      });
    }
    const fallback = runClip('dark-desk', { noise: true, fallback: true });
    expectTheTriggers('dark-desk', fallback);
  }, 240_000);
});
