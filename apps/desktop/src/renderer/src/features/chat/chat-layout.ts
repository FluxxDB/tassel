// Where the chat sidebar goes: 360 px on the window's right. From 1120 px wide the stage shrinks
// beside it, keeping 760 px for the stage (captions over 600 px wide, the dock and Ada's tile with
// room to spare); narrower, it lies over the stage's right side instead, so her paper keeps its
// size, and the stage's tiles, captions and dock move clear of it (`cover`).
import { useSyncExternalStore } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export const SIDEBAR_WIDTH = 360;
/** The narrowest window the sidebar pushes the stage in; below it, the sidebar overlays. */
export const PUSH_MIN_WIDTH = 1120;

const QUERY = `(min-width: ${PUSH_MIN_WIDTH}px)`;

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener?.('change', onChange);
  return () => media.removeEventListener?.('change', onChange);
}

/** True while the window is wide enough for the sidebar to push the stage. */
export function useWideWindow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === 'function' ? (window.matchMedia(QUERY).matches ?? true) : true,
    () => true,
  );
}

interface ChatCover {
  /** How much of main's right edge the sidebar covers, in px: 0 unless it overlays the stage. */
  cover: number;
  setCover(cover: number): void;
}

/** The overlaying sidebar's width, for the stage's tiles and the board's fit to keep clear of. */
export const useChatCover: UseBoundStore<StoreApi<ChatCover>> = create<ChatCover>()((set) => ({
  cover: 0,
  setCover: (cover) => set({ cover }),
}));

/** The stage's inset from main's right edge (Stage.tsx's right-4). */
const STAGE_RIGHT_INSET = 16;

/** How much of the stage's own right side the overlaying sidebar covers, in px. */
export const useStageCover = (): number =>
  useChatCover((state) => Math.max(0, state.cover - STAGE_RIGHT_INSET));
