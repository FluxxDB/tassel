// Ada's board: the scene she has drawn, which the board panel shows. Task 1's stub, with its
// final exports: Task 5 replaces the body with the scene, the layouts and the engine.
import type { BoardAction } from '@tassel/shared/beats';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface BoardState {
  apply(action: BoardAction): void;
  reset(): void;
}

export const useBoardStore: UseBoundStore<StoreApi<BoardState>> = create<BoardState>()(() => ({
  apply: () => {},
  reset: () => {},
}));

/** Applies one of Ada's board actions, which dispatchActions has checked. */
export function applyBoardAction(action: BoardAction): void {
  useBoardStore.getState().apply(action);
}
