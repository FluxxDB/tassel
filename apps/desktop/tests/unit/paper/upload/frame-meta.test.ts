import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DETECTOR_VERSION,
  type DetectorTrigger,
} from '../../../../src/renderer/src/paper/contracts';
import { buildFrameMeta } from '../../../../src/renderer/src/paper/upload/frame-meta';

// The server's example `meta`. services/server/tests/frames/test_frame_meta.py validates the same
// file, so the app and the server agree on the wire format.
const SERVER_EXAMPLE = new URL(
  '../../../../../../services/server/tests/frames/frame-meta-example.json',
  import.meta.url,
);

const jpeg = (byte: number) => new Blob([new Uint8Array([0xff, 0xd8, byte, 0xff, 0xd9])]);

/** The ink trigger that the server's example describes. */
function exampleTrigger(): DetectorTrigger {
  return {
    reason: 'ink',
    capturedAt: '2026-10-17T14:32:05.120Z',
    full: jpeg(1),
    crop: jpeg(2),
    width: 1280,
    height: 800,
    pageFound: true,
    pageQuad: [
      { x: 240, y: 120 },
      { x: 1040, y: 132 },
      { x: 1032, y: 750 },
      { x: 232, y: 738 },
    ],
    cropRect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
    mask: {
      cols: 50,
      rows: 38,
      cells: [
        [5, 12],
        [6, 12],
      ],
    },
    changedCells: 2,
    inkPixels: 31,
    erasePixels: 0,
  };
}

describe('buildFrameMeta', () => {
  it("matches the server's example", () => {
    const example: unknown = JSON.parse(readFileSync(SERVER_EXAMPLE, 'utf8'));
    expect(buildFrameMeta(exampleTrigger(), 'fake-clip')).toStrictEqual(example);
  });

  it('stamps the detector version on every frame', () => {
    expect(buildFrameMeta(exampleTrigger(), 'fake-clip').detector.version).toBe(DETECTOR_VERSION);
  });

  it('sends a page event with no crop rectangle or mask, from the source it came from', () => {
    const trigger: DetectorTrigger = {
      ...exampleTrigger(),
      reason: 'page',
      crop: null,
      cropRect: null,
      mask: null,
    };
    expect(buildFrameMeta(trigger, 'deskview-helper')).toMatchObject({
      reason: 'page',
      source: 'deskview-helper',
      crop_rect: null,
      mask: null,
    });
  });

  it("keeps the fallback region's quad when no page was found, so the crop maps to pixels", () => {
    const fallback = exampleTrigger().pageQuad;
    const meta = buildFrameMeta({ ...exampleTrigger(), pageFound: false }, 'window-capture');
    expect(meta.page_found).toBe(false);
    expect(meta.page_quad).toStrictEqual(fallback);
  });

  it("copies the trigger's quad, rectangle and mask rather than sharing them", () => {
    const trigger = exampleTrigger();
    const meta = buildFrameMeta(trigger, 'fake-clip');
    trigger.pageQuad[0].x = 0;
    const { cropRect, mask } = trigger;
    if (cropRect) cropRect.x = 0.9;
    mask?.cells.push([7, 12]);
    expect(meta.page_quad?.[0]).toStrictEqual({ x: 240, y: 120 });
    expect(meta.crop_rect).toStrictEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.25 });
    expect(meta.mask?.cells).toHaveLength(2);
  });
});
