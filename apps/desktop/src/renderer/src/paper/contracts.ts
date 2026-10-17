// Types and constants shared by P3's tracks: the sources, the detector, its worker and the uploader.
//
// Coordinates (P4 and P5 depend on these conventions):
// - A `Quad` is TL, TR, BR, BL, in pixels of the uploaded full JPEG. That is the native frame
//   inside the feed's `contentRect`, so a window capture's title bar is already cut away.
// - Page coordinates are 0–1 from the flattened page's top-left. `crop_rect` uses them.
// - `CellMask.cells` are `[col, row]` pairs on the flattened page's grid, sorted by row, then by
//   column.
import type { PaperSourceKind } from '../../../shared/paper-bridge';

export type { PaperSourceKind };

/** Goes with every upload, so the server knows which detector rules chose the frame. */
export const DETECTOR_VERSION = 'p3.1';

export interface Pt {
  x: number;
  y: number;
}

/** TL, TR, BR, BL, in pixels of the uploaded full JPEG. */
export type Quad = [Pt, Pt, Pt, Pt];

/** A rectangle in 0–1 units from its image's top-left; a trigger's `cropRect` is in page coordinates. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Changed cells on the flattened page's grid: `[col, row]` pairs, sorted by row, then by column. */
export interface CellMask {
  cols: number;
  rows: number;
  cells: Array<[number, number]>;
}

export interface DetectorStats {
  t: number;
  busy: boolean;
  occluded: boolean;
  quiet: number;
  cols: number;
  rows: number;
  changed: number[];
  solid: number[];
  quad: Quad | null;
  refAgeMs: number | null;
  triggers: number;
  opencv: boolean;
}

export interface DetectorTrigger {
  reason: 'ink' | 'page';
  capturedAt: string;
  full: Blob;
  crop: Blob | null;
  width: number;
  height: number;
  pageFound: boolean;
  pageQuad: Quad;
  cropRect: NormRect | null;
  mask: CellMask | null;
  changedCells: number;
  inkPixels: number;
  erasePixels: number;
}

export interface UploadStats {
  sent: number;
  pending: number;
  failed: number;
  lastError: 'offline' | 'server' | 'rejected' | 'gone' | 'auth' | null;
}
