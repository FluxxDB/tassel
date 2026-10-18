import { create } from 'zustand';
import type { DisplayChoice, ScreenMark, ScreenPoint } from '../../../shared/screen-bridge';
export interface ScreenState {
  status: 'off' | 'selecting' | 'sharing' | 'paused' | 'resetting' | 'error';
  presentation: 'expanded' | 'collapsing' | 'overlay' | 'restoring';
  displays: DisplayChoice[];
  selected: DisplayChoice | null;
  stream: MediaStream | null;
  marks: ScreenMark[];
  draw: boolean;
  notice: string;
}
export const useScreen = create<ScreenState>(() => ({
  status: 'off',
  presentation: 'expanded',
  displays: [],
  selected: null,
  stream: null,
  marks: [],
  draw: false,
  notice: '',
}));
export interface ScreenActions {
  choose(): Promise<void>;
  start(id: string): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  collapse(): Promise<void>;
  restore(): Promise<void>;
  look(): Promise<void>;
  stroke(points: ScreenPoint[]): void;
  draw(): void;
  undo(): void;
}
let actions: ScreenActions | null = null;
export function bindScreenActions(next: ScreenActions) {
  actions = next;
  return () => {
    if (actions === next) actions = null;
  };
}
export function screenActions() {
  return actions;
}
