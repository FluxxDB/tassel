// Ada's marks on the student's paper, over a frozen snapshot of it. Task 1's stub, with its final
// exports: Task 7 replaces the body with the snapshot, its loading and the marks.
import type { PaperAction } from '@tassel/shared/beats';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface MarksState {
  apply(action: PaperAction): void;
  reset(): void;
}

export const useMarksStore: UseBoundStore<StoreApi<MarksState>> = create<MarksState>()(() => ({
  apply: () => {},
  reset: () => {},
}));

/** Applies one of Ada's paper actions, which dispatchActions has checked. */
export function applyPaperAction(action: PaperAction): void {
  useMarksStore.getState().apply(action);
}
