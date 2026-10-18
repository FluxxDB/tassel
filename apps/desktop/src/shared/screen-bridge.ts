import type { BoardLayout } from '../renderer/src/board/layout/types';
import type { BoardScene } from '../renderer/src/board/scene/types';

export const SCREEN_COLORS = [
  'violet',
  'red',
  'blue',
  'green',
  'orange',
  'black',
  'white',
] as const;
export type ScreenColor = (typeof SCREEN_COLORS)[number];
export interface ScreenBoard {
  scene: BoardScene;
  layouts: Record<string, BoardLayout>;
  placements: Record<string, { x: number; y: number; w: number; h: number; color?: ScreenColor }>;
}

/** Only display IDs selected by the student may be granted to getDisplayMedia. */
export interface DisplayChoice {
  id: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface ScreenIdentity {
  source: string;
  epoch: number;
  revision: number;
}
export interface ScreenPoint {
  x: number;
  y: number;
}
export interface ScreenMark {
  id: string;
  kind: 'pointer' | 'circle' | 'underline' | 'arrow' | 'freehand' | 'rectangle' | 'text';
  points: ScreenPoint[];
  author: 'student' | 'tutor';
  text?: string;
  color?: ScreenColor;
}
export interface OverlayState {
  sequence: number;
  strokeReceipt?: number;
  status: 'sharing' | 'paused' | 'resetting' | 'error';
  caption: string;
  tutorState: string;
  micOn: boolean;
  draw: boolean;
  marks: ScreenMark[];
  /** Plain data; the existing avatar reader validates this in the HUD. */
  avatar: Record<string, string>;
  notice: string;
  boardHint?: boolean;
  language?: 'en' | 'es' | 'ko';
  board?: ScreenBoard;
  /** The shared display in points; its origin lets the ink window map marks to the display
   * wherever the OS put the window. */
  viewport?: { width: number; height: number; x?: number; y?: number };
}
export type OverlayIntent =
  | 'reset'
  | 'restore'
  | 'pause'
  | 'stop'
  | 'mic'
  | 'draw'
  | 'look'
  | 'undo'
  | 'escape'
  | 'board';
export interface ScreenBridge {
  displays(): Promise<DisplayChoice[]>;
  select(id: string): Promise<DisplayChoice>;
  prepare(): Promise<void>;
  collapse(reducedMotion?: boolean): Promise<void>;
  restore(reducedMotion?: boolean): Promise<void>;
  close(): Promise<void>;
  publish(state: OverlayState): void;
  onState(listener: (state: OverlayState) => void): () => void;
  intent(intent: OverlayIntent): void;
  onIntent(listener: (intent: OverlayIntent) => void): () => void;
  stroke(points: ScreenPoint[]): void;
  onStroke(listener: (points: ScreenPoint[]) => void): () => void;
  /** Moves the overlay bar by a keyboard nudge, in display points; it stays on screen. */
  move(dx: number, dy: number): void;
  ready(): void;
  onArrived?(listener: () => void): () => void;
  /** Read the HUD mask without changing native annotation visibility. */
  capture(clean: boolean): Promise<{ x: number; y: number; width: number; height: number } | null>;
}
export const SCREEN_IPC = {
  displays: 'screen:displays',
  select: 'screen:select',
  prepare: 'screen:prepare',
  collapse: 'screen:collapse',
  restore: 'screen:restore',
  close: 'screen:close',
  publish: 'screen:publish',
  state: 'screen:state',
  intent: 'screen:intent',
  stroke: 'screen:stroke',
  move: 'screen:move',
  ready: 'screen:ready',
  capture: 'screen:capture',
  arrived: 'screen:arrived',
} as const;
export const OVERLAY_INTENTS: readonly string[] = [
  'reset',
  'restore',
  'pause',
  'stop',
  'mic',
  'draw',
  'look',
  'undo',
  'escape',
  'board',
];
/** The keyboard way to drag the bar: arrows move it a step, Shift a stride; it stays on screen. */
export function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 96 : 24;
  if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
  if (key === 'ArrowRight') return { dx: step, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: -step };
  if (key === 'ArrowDown') return { dx: 0, dy: step };
  return null;
}

/** A keyboard nudge from the HUD: two finite steps, each at most a few hundred points. */
export function validNudge(value: unknown): value is { dx: number; dy: number } {
  if (!value || typeof value !== 'object') return false;
  const { dx, dy } = value as { dx: unknown; dy: unknown };
  return [dx, dy].every((v) => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 400);
}

export function validPoints(value: unknown): value is ScreenPoint[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.every(
      (p) =>
        p &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1,
    )
  );
}

/** Validate data before it crosses from the owner to native presentation windows. */
export function validOverlayState(value: unknown): value is OverlayState {
  if (!value || typeof value !== 'object') return false;
  const s = value as OverlayState;
  if (
    !Number.isSafeInteger(s.sequence) ||
    s.sequence < 0 ||
    (s.strokeReceipt !== undefined &&
      (!Number.isSafeInteger(s.strokeReceipt) || s.strokeReceipt < 0)) ||
    !['sharing', 'paused', 'resetting', 'error'].includes(s.status) ||
    typeof s.caption !== 'string' ||
    s.caption.length > 16000 ||
    typeof s.notice !== 'string' ||
    s.notice.length > 100 ||
    typeof s.tutorState !== 'string' ||
    s.tutorState.length > 30 ||
    typeof s.draw !== 'boolean' ||
    typeof s.micOn !== 'boolean' ||
    (s.language !== undefined && !['en', 'es', 'ko'].includes(s.language)) ||
    !s.avatar ||
    typeof s.avatar !== 'object' ||
    Object.keys(s.avatar).length > 30 ||
    !Object.values(s.avatar).every((v) => typeof v === 'string' && v.length <= 100) ||
    !Array.isArray(s.marks) ||
    s.marks.length > 200
  )
    return false;
  if (
    s.viewport &&
    (![s.viewport.width, s.viewport.height].every(Number.isFinite) ||
      s.viewport.width <= 0 ||
      s.viewport.height <= 0 ||
      s.viewport.width > 32768 ||
      s.viewport.height > 32768 ||
      (s.viewport.x !== undefined && !Number.isFinite(s.viewport.x)) ||
      (s.viewport.y !== undefined && !Number.isFinite(s.viewport.y)))
  )
    return false;
  if (s.board !== undefined && !validScreenBoard(s.board)) return false;
  let points = 0;
  const ids = new Set<string>();
  return s.marks.every((mark) => {
    if (!validScreenMark(mark) || ids.has(mark.id)) return false;
    ids.add(mark.id);
    points += mark.points.length;
    return points <= 32768;
  });
}

/** Shared validation for IPC and tutor command batches. Student taps may contain one point. */
export function validScreenMark(value: unknown): value is ScreenMark {
  if (!value || typeof value !== 'object') return false;
  const mark = value as ScreenMark;
  if (
    typeof mark.id !== 'string' ||
    !mark.id ||
    mark.id.length > 100 ||
    !['pointer', 'circle', 'underline', 'arrow', 'freehand', 'rectangle', 'text'].includes(
      mark.kind,
    ) ||
    !['student', 'tutor'].includes(mark.author) ||
    !validPoints(mark.points) ||
    (mark.color !== undefined && !SCREEN_COLORS.includes(mark.color)) ||
    (mark.text !== undefined && (typeof mark.text !== 'string' || mark.text.length > 500))
  )
    return false;
  if (mark.kind === 'freehand') return mark.points.length >= (mark.author === 'student' ? 1 : 2);
  if (mark.kind === 'text' && !mark.text?.trim()) return false;
  if (mark.kind === 'pointer' || mark.kind === 'text') return mark.points.length === 1;
  if (mark.points.length !== 2) return false;
  const [a, b] = mark.points;
  if (a.x === b.x && a.y === b.y) return false;
  return !['circle', 'rectangle'].includes(mark.kind) || (a.x !== b.x && a.y !== b.y);
}

function validScreenBoard(board: ScreenBoard): boolean {
  if (
    !board ||
    typeof board !== 'object' ||
    !board.scene ||
    !Array.isArray(board.scene.items) ||
    board.scene.items.length > 100 ||
    !board.layouts ||
    typeof board.layouts !== 'object' ||
    !board.placements ||
    typeof board.placements !== 'object'
  )
    return false;
  if (Object.keys(board.placements).length > 100) return false;
  for (const region of Object.values(board.placements)) {
    if (
      !region ||
      ![region.x, region.y, region.w, region.h].every(Number.isFinite) ||
      region.x < 0 ||
      region.y < 0 ||
      region.w <= 0 ||
      region.h <= 0 ||
      region.x + region.w > 1.000001 ||
      region.y + region.h > 1.000001 ||
      (region.color !== undefined && !SCREEN_COLORS.includes(region.color))
    )
      return false;
  }
  try {
    return JSON.stringify(board).length <= 750000;
  } catch {
    return false;
  }
}
