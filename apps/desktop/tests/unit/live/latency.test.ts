import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LatencyMeter,
  percentile,
  startLatencySampler,
} from '../../../src/renderer/src/tutor/live/latency';

function trace(meter: LatencyMeter, end: number, signals: (at: number) => [number, number]) {
  const results = [];
  for (let at = 0; at <= end; at += 20) {
    const result = meter.sample(at, ...signals(at));
    if (result) results.push(result);
  }
  return results;
}
afterEach(() => vi.useRealTimers());
describe('LatencyMeter', () => {
  it('times first audio from the first silent mic sample, not the debounce confirmation', () => {
    expect(
      trace(new LatencyMeter(), 2500, (at) => [at < 1000 ? 0.1 : 0, at >= 1900 ? 0.1 : 0]),
    ).toEqual([{ ttfa_ms: 900, barge_in_ms: null, yield_ms: null }]);
  });
  it('keeps an audio onset that arrives before mic silence is confirmed', () => {
    expect(
      trace(new LatencyMeter(), 1800, (at) => [at < 1000 ? 0.1 : 0, at >= 1100 ? 0.1 : 0]),
    ).toEqual([{ ttfa_ms: 100, barge_in_ms: null, yield_ms: null }]);
  });
  it('times barge-in silence and duck from the original speech onset', () => {
    const meter = new LatencyMeter();
    expect(
      trace(meter, 6000, (at) => {
        if (at === 5260) meter.markDuck(5250);
        return [at >= 5000 ? 0.1 : 0, at < 5420 ? 0.1 : 0];
      }),
    ).toEqual([{ ttfa_ms: null, barge_in_ms: 420, yield_ms: 250 }]);
  });
  it('a backchannel reports nothing even when the bot eventually stops', () => {
    expect(
      trace(new LatencyMeter(), 8500, (at) => [
        at >= 5000 && at < 5300 ? 0.1 : 0,
        at < 8000 ? 0.1 : 0,
      ]),
    ).toEqual([]);
  });
  it('ignores mic blips under 40 ms', () => {
    expect(
      trace(new LatencyMeter(), 2000, (at) => [at === 0 ? 0.1 : 0, at >= 1000 ? 0.1 : 0]),
    ).toEqual([]);
  });
  it('treats a short pause in mic speech as part of the same utterance', () => {
    expect(
      trace(new LatencyMeter(), 2500, (at) => [
        at < 600 || (at >= 800 && at < 1000) ? 0.1 : 0,
        at >= 1900 ? 0.1 : 0,
      ]),
    ).toEqual([{ ttfa_ms: 900, barge_in_ms: null, yield_ms: null }]);
  });
  it('does not mistake a short bot pause for silence', () => {
    expect(
      trace(new LatencyMeter(), 3000, (at) => [
        at >= 500 && at < 800 ? 0.1 : 0,
        at >= 600 && at < 640 ? 0 : 0.1,
      ]),
    ).toEqual([]);
  });
  it.each([2000, 2020])(
    'uses the silence onset for the two-second barge window (%i ms)',
    (delay) => {
      const result = trace(new LatencyMeter(), 3300, (at) => [
        at >= 1000 && at < 1400 ? 0.1 : 0,
        at < 1000 + delay ? 0.1 : 0,
      ]);
      expect(result).toEqual(
        delay === 2000 ? [{ ttfa_ms: null, barge_in_ms: 2000, yield_ms: null }] : [],
      );
    },
  );
  it.each([10000, 10020])('limits first audio to ten seconds (%i ms)', (delay) => {
    expect(
      trace(new LatencyMeter(), 12000, (at) => [at < 1000 ? 0.1 : 0, at >= 1000 + delay ? 0.1 : 0]),
    ).toEqual(delay === 10000 ? [{ ttfa_ms: 10000, barge_in_ms: null, yield_ms: null }] : []);
  });
  it('does not reuse a duck from a prior turn', () => {
    const meter = new LatencyMeter();
    meter.markDuck(100);
    expect(trace(meter, 6000, (at) => [at >= 5000 ? 0.1 : 0, at < 5420 ? 0.1 : 0])).toEqual([
      { ttfa_ms: null, barge_in_ms: 420, yield_ms: null },
    ]);
  });
  it('does not count a bot restart when the bot was still speaking at mic end', () => {
    expect(
      trace(new LatencyMeter(), 1800, (at) => [
        at >= 500 && at < 1000 ? 0.1 : 0,
        at < 1100 || at >= 1200 ? 0.1 : 0,
      ]),
    ).toEqual([{ ttfa_ms: null, barge_in_ms: 600, yield_ms: null }]);
  });
  it('does not carry an unconfirmed silence into the next bot utterance as a barge-in', () => {
    expect(
      trace(new LatencyMeter(), 1000, (at) => [
        at >= 120 && at < 800 ? 0.1 : 0,
        at < 100 || (at >= 300 && at < 500) ? 0.1 : 0,
      ]),
    ).toEqual([]);
  });
  it('uses the first duck during a barge-in, even if ducking toggles again', () => {
    const meter = new LatencyMeter();
    expect(
      trace(meter, 6000, (at) => {
        if (at === 5200 || at === 5300) meter.markDuck(at);
        return [at >= 5000 ? 0.1 : 0, at < 5420 ? 0.1 : 0];
      }),
    ).toEqual([{ ttfa_ms: null, barge_in_ms: 420, yield_ms: 200 }]);
  });
  it('accepts a custom mic hold threshold', () => {
    expect(
      trace(new LatencyMeter({ micOnMs: 80 }), 2000, (at) => [
        at < 60 ? 0.1 : 0,
        at >= 1000 ? 0.1 : 0,
      ]),
    ).toEqual([]);
  });
});
describe('percentile', () => {
  it('uses nearest rank and leaves the input untouched', () => {
    const values = [1300, 800, 900, 1100, 1000];
    expect(percentile(values, 50)).toBe(1000);
    expect(percentile(values, 90)).toBe(1300);
    expect(values).toEqual([1300, 800, 900, 1100, 1000]);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 90)).toBe(7);
  });
});
describe('startLatencySampler', () => {
  it('samples the sent mic every 20 ms and stops cleanly', () => {
    vi.useFakeTimers();
    let at = 0;
    const mic = { sentLevel: vi.fn(() => (at < 1000 ? 0.1 : 0)) };
    const audio = { level: () => (at >= 1900 ? 0.1 : 0) };
    const onMetrics = vi.fn();
    const stop = startLatencySampler({
      mic,
      audio,
      meter: new LatencyMeter(),
      onMetrics,
      now: () => at,
    });
    for (at = 0; at <= 2000; at += 20) vi.advanceTimersByTime(20);
    expect(onMetrics).toHaveBeenCalledExactlyOnceWith({
      ttfa_ms: 900,
      barge_in_ms: null,
      yield_ms: null,
    });
    const count = mic.sentLevel.mock.calls.length;
    stop();
    stop();
    vi.advanceTimersByTime(1000);
    expect(mic.sentLevel).toHaveBeenCalledTimes(count);
  });
  it('supports a custom sampling interval and never times withheld speech', () => {
    vi.useFakeTimers();
    const mic = { sentLevel: vi.fn(() => 0) };
    const onMetrics = vi.fn();
    const stop = startLatencySampler({
      mic,
      audio: { level: () => 0.1 },
      meter: new LatencyMeter(),
      onMetrics,
      intervalMs: 10,
    });
    vi.advanceTimersByTime(100);
    expect(mic.sentLevel).toHaveBeenCalledTimes(10);
    expect(onMetrics).not.toHaveBeenCalled();
    stop();
  });
});

// Task 17 integration traces, retained across P2-R19 reconciliation.
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
