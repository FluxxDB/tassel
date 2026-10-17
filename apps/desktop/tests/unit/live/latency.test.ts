import { expect, it } from 'vitest';
import { LatencyMeter } from '../../../src/renderer/src/tutor/live/latency';

it('measures first audio from sustained speech end', () => {
  const meter = new LatencyMeter();
  const results = [];
  for (let t = 0; t <= 2000; t += 20) {
    const result = meter.sample(t, t < 1000 ? 0.1 : 0, t >= 1900 ? 0.1 : 0);
    if (result) results.push(result);
  }
  expect(results).toEqual([{ ttfa_ms: 900, barge_in_ms: null, yield_ms: null }]);
});
it('measures yield and silence from the start of a barge-in', () => {
  const meter = new LatencyMeter();
  const results = [];
  for (let t = 0; t <= 5600; t += 20) {
    if (t === 5260) meter.markDuck(5250);
    const result = meter.sample(t, t >= 5000 ? 0.1 : 0, t < 5420 ? 0.1 : 0);
    if (result) results.push(result);
  }
  expect(results).toEqual([{ ttfa_ms: null, barge_in_ms: 420, yield_ms: 250 }]);
});
it('ignores short mic blips and backchannels with no silence within two seconds', () => {
  const meter = new LatencyMeter();
  const results = [];
  for (let t = 0; t <= 8000; t += 20) {
    const result = meter.sample(t, t === 1000 || (t >= 5000 && t < 5300) ? 0.1 : 0, 0.1);
    if (result) results.push(result);
  }
  expect(results).toEqual([]);
});
