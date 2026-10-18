// What the rest of the app knows of a board engine (P5-R1's thin wrapper): it draws Ada's scene,
// plays her effects, moves the camera, and reports the student's own edits. board/tldraw/ is the
// one engine; another (Excalidraw, say) would implement this and nothing else. No tldraw here.
import type { AutomatonSpec } from '@tassel/shared/beats';
import type { BoardLayout } from './layout/types';
import type { BoardEffect, BoardScene } from './scene/types';

/** What the student changed on the board, after a quiet moment (Task 6; spec §5.4, P5-R13). */
export interface StudentBoardEdit {
  /** When, as an ISO time. */
  at: string;
  changed: string[];
  removed: string[];
  /** The changed shapes' records. */
  shapes: unknown[];
  /** A PNG of the changed shapes that still exist, or null if the export failed. */
  image: Blob | null;
  /** What the board's automata read as now. */
  automata: AutomatonSpec[];
}

/** A box in CSS px: its top left, width and height. */
export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the stage lays things over the board, as the board panel measures it (ruling P5-R9): the
 * panel and the session's main area in window px, and whether captions are on. Her tile, the
 * panel's TopLine and the captions band follow from these.
 */
export interface StageGeometry {
  panel: StageRect;
  /** The session's main area: its bottom and width place the captions. */
  main: StageRect;
  captions: boolean;
}

export interface BoardEngine {
  /** Draws `scene`, changing only what changed since the last call. */
  render(scene: BoardScene, layouts: Readonly<Record<string, BoardLayout>>): void;
  /** Plays an effect; resolves when it ends, at once under reduced motion. */
  play(effect: BoardEffect): Promise<void>;
  /** Fits the camera to an item, or to everything for null. */
  focus(item: string | null, opts: { animate: boolean }): void;
  /** Optional student navigation surface; no shape editing is exposed. */
  camera?: {
    zoom(direction: 'in' | 'out'): void;
    fit(): void;
    adaAction(): void;
  };
  /**
   * The whole board as it is now, Ada's items and the student's, as a PNG about `maxSide` px on
   * its long side; null when the board is empty.
   */
  snapshot?(maxSide: number): Promise<Blob | null>;
  /** Her edits, one per quiet moment. Returns the unsubscribe. */
  onStudentEdit(listener: (edit: StudentBoardEdit) => void): () => void;
  dispose(): void;
}
