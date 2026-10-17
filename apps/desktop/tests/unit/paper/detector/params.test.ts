import { describe, expect, it } from 'vitest';
import { DETECTOR_VERSION as CONTRACT_VERSION } from '../../../../src/renderer/src/paper/contracts';
import {
  DEFAULT_PARAMS,
  DETECTOR_VERSION,
  parseParams,
} from '../../../../src/renderer/src/paper/detector/params';

describe('DEFAULT_PARAMS', () => {
  it('holds the plan’s starting values, plus the re-review’s scenery timeout', () => {
    expect(DEFAULT_PARAMS).toEqual({
      sampleIntervalMs: 200,
      motionWidth: 160,
      motionHeight: 120,
      motionDelta: 15,
      busyFraction: 0.005,
      stableSamples: 5,
      compareLongSide: 800,
      fallbackCrop: 0.8,
      lightingBlur: 31,
      inkDelta: 0.1,
      cellSize: 16,
      cellMinPixels: 6,
      triggerMinCells: 2,
      quietInkMs: 2000,
      minTriggerIntervalMs: 5000,
      bigChangeFraction: 0.4,
      pageClearFraction: 0.8,
      pageMoveFraction: 0.02,
      referenceRefreshMs: 30000,
      occluderLevel: 0.8,
      occluderSmoothness: 0.08,
      occlusionMinCells: 4,
      solidCellFraction: 0.5,
      staleSamples: 5,
      sceneryMs: 10000,
    });
    expect(Object.isFrozen(DEFAULT_PARAMS)).toBe(true);
  });

  it('re-exports the contract’s DETECTOR_VERSION', () => {
    expect(DETECTOR_VERSION).toBe('p3.1');
    expect(DETECTOR_VERSION).toBe(CONTRACT_VERSION);
  });
});

describe('parseParams', () => {
  it('keeps quietInkMs 2500 and drops quietInkMs -1 and unknown keys', () => {
    expect(parseParams({ quietInkMs: 2500 })).toEqual({ quietInkMs: 2500 });
    expect(parseParams({ quietInkMs: -1 })).toEqual({});
    expect(parseParams({ quietInkMs: 2500, shoeSize: 9, inkDelta: 0.12 })).toEqual({
      quietInkMs: 2500,
      inkDelta: 0.12,
    });
  });

  it('drops values that are not finite numbers, or not whole where a count is needed', () => {
    expect(
      parseParams({
        inkDelta: '0.2',
        busyFraction: Number.NaN,
        referenceRefreshMs: Number.POSITIVE_INFINITY,
        stableSamples: 2.5,
        cellSize: 16,
      }),
    ).toEqual({ cellSize: 16 });
  });

  it('keeps an odd lighting blur and drops an even one', () => {
    expect(parseParams({ lightingBlur: 41 })).toEqual({ lightingBlur: 41 });
    expect(parseParams({ lightingBlur: 30 })).toEqual({});
  });

  it('returns nothing for input that is not an object', () => {
    for (const input of [null, undefined, 3, 'quietInkMs', [2500]])
      expect(parseParams(input)).toEqual({});
  });
});
