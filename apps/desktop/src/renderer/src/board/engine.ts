// What the rest of the app knows of a board engine (P5-R1's thin wrapper): it draws Ada's scene,
// plays her effects, moves the camera, and reports the student's own edits. board/tldraw/ is the
// one engine; another (Excalidraw, say) would implement this and nothing else. No tldraw here.
import type { AutomatonSpec } from '@tassel/shared/beats';
import type { AutomatonLayout } from './layout/types';
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

export interface BoardEngine {
  /** Draws `scene`, changing only what changed since the last call. */
  render(scene: BoardScene, layouts: Readonly<Record<string, AutomatonLayout>>): void;
  /** Plays an effect; resolves when it ends, at once under reduced motion. */
  play(effect: BoardEffect): Promise<void>;
  /** Fits the camera to an item, or to everything for null. */
  focus(item: string | null, opts: { animate: boolean }): void;
  /** Her edits, one per quiet moment. Returns the unsubscribe. */
  onStudentEdit(listener: (edit: StudentBoardEdit) => void): () => void;
  dispose(): void;
}
