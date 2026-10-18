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
}
export interface OverlayState {
  sequence: number;
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
  ready(): void;
  onArrived?(listener: () => void): () => void;
  /** Hide annotations for a clean frame on platforms without capture exclusion. */
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
    !['sharing', 'paused', 'resetting', 'error'].includes(s.status) ||
    typeof s.caption !== 'string' ||
    s.caption.length > 16000 ||
    typeof s.notice !== 'string' ||
    s.notice.length > 100 ||
    typeof s.tutorState !== 'string' ||
    s.tutorState.length > 30 ||
    typeof s.draw !== 'boolean' ||
    typeof s.micOn !== 'boolean' ||
    !s.avatar ||
    typeof s.avatar !== 'object' ||
    Object.keys(s.avatar).length > 30 ||
    !Object.values(s.avatar).every((v) => typeof v === 'string' && v.length <= 100) ||
    !Array.isArray(s.marks) ||
    s.marks.length > 200
  )
    return false;
  let points = 0;
  return s.marks.every((mark) => {
    if (
      !mark ||
      typeof mark.id !== 'string' ||
      mark.id.length > 100 ||
      !['pointer', 'circle', 'underline', 'arrow', 'freehand', 'rectangle', 'text'].includes(
        mark.kind,
      ) ||
      !['student', 'tutor'].includes(mark.author) ||
      !validPoints(mark.points) ||
      (mark.text !== undefined && (typeof mark.text !== 'string' || mark.text.length > 500))
    )
      return false;
    points += mark.points.length;
    return points <= 32768;
  });
}
