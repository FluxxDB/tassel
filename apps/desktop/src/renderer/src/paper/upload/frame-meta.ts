// The `meta` part of a frame upload: what the detector saw, in the server's FrameMeta wire format.
// services/server/tests/frames/frame-meta-example.json is the contract both sides test.
import { DETECTOR_VERSION, type DetectorTrigger, type PaperSourceKind } from '../contracts';

export interface FrameMetaJson {
  reason: 'ink' | 'page';
  source: PaperSourceKind;
  captured_at: string;
  page_found: boolean;
  /** TL, TR, BR, BL, in pixels of the full JPEG. */
  page_quad: Array<{ x: number; y: number }> | null;
  /** Page coordinates, 0–1 from the flattened page's top-left. */
  crop_rect: { x: number; y: number; w: number; h: number } | null;
  /** `[col, row]` cells on the flattened page's grid. */
  mask: { cols: number; rows: number; cells: Array<[number, number]> } | null;
  detector: { changed_cells: number; ink_pixels: number; erase_pixels: number; version: string };
}

/**
 * The meta for a trigger, copied out of it so the queued upload never shares the detector's
 * objects. The quad goes along even when no page was found: it is then the fallback region the
 * detector compared, which `crop_rect` is relative to, and `page_found` says so.
 */
export function buildFrameMeta(trigger: DetectorTrigger, source: PaperSourceKind): FrameMetaJson {
  const { cropRect, mask } = trigger;
  return {
    reason: trigger.reason,
    source,
    captured_at: trigger.capturedAt,
    page_found: trigger.pageFound,
    page_quad: trigger.pageQuad.map(({ x, y }) => ({ x, y })),
    crop_rect: cropRect && { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h },
    mask: mask && {
      cols: mask.cols,
      rows: mask.rows,
      cells: mask.cells.map(([col, row]): [number, number] => [col, row]),
    },
    detector: {
      changed_cells: trigger.changedCells,
      ink_pixels: trigger.inkPixels,
      erase_pixels: trigger.erasePixels,
      version: DETECTOR_VERSION,
    },
  };
}
