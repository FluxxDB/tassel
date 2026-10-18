// Where the chat sidebar goes: 360 px on the window's right. From 1120 px wide the stage shrinks
// beside it, keeping 760 px for the stage (captions over 600 px wide, the dock and Ada's tile with
// room to spare); narrower, it lies over the stage's right side instead, so her paper keeps its
// size, and the stage's tiles, captions and dock move clear of it (`cover`); in split, the stage
// itself makes room, so her board and its controls never go under it.
import { type CSSProperties, useSyncExternalStore } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { useStageStore } from '../session/stage-store';

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

/**
 * How much of the stage's own right side the overlaying sidebar covers, in px: none in split,
 * where the stage itself makes room (useStageInset).
 */
export const useStageCover = (): number => {
  const split = useStageStore((state) => state.mode === 'split');
  return useChatCover((state) => (split ? 0 : Math.max(0, state.cover - STAGE_RIGHT_INSET)));
};

/**
 * The stage's right edge while the sidebar overlays it in split: paper and board share what the
 * sidebar leaves, so neither her board nor its controls go under it. Her paper alone keeps its
 * size, the sidebar over its right side. Undefined otherwise: the stage's own inset.
 */
export const useStageInset = (): CSSProperties | undefined => {
  const split = useStageStore((state) => state.mode === 'split');
  const cover = useChatCover((state) => state.cover);
  return split && cover > 0 ? { right: cover + STAGE_RIGHT_INSET } : undefined;
};
