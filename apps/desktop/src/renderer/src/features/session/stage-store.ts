// The live session's stage: which view shows (her paper, Ada's board, or both side by side),
// what Ada is doing, and the two caption lines. Ada requests views; the student can pin one,
// and Ada's requests then wait, remembered, until she unpins.
import type { Lang } from '@tassel/shared/i18n';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type StageMode = 'paper' | 'board' | 'split';
export type TutorState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'watching';
export type Speaker = 'student' | 'tutor';

export interface CaptionLine {
  speaker: Speaker;
  text: string;
  /** The line's own language, which can differ from the UI's (a Korean line in English, say). */
  lang?: Lang;
}

interface StageStore {
  mode: StageMode;
  pinned: StageMode | null;
  requested: StageMode;
  tutorState: TutorState;
  captionsOn: boolean;
  micOn: boolean;
  cameraOn: boolean;
  caption: { previous?: CaptionLine; current?: CaptionLine };
  /** Ada's request: shown unless a view is pinned, and remembered in `requested` either way. */
  requestMode(m: StageMode): void;
  pin(m: StageMode): void;
  /** Follow Ada again: shows the view she asked for last. */
  unpin(): void;
  setTutorState(s: TutorState): void;
  /** The new line becomes current and the current one previous. */
  pushCaption(speaker: Speaker, text: string, lang?: Lang): void;
  toggleCaptions(): void;
  toggleMic(): void;
  toggleCamera(): void;
  reset(): void;
}

// Her work first: a session opens on her paper, with Ada still connecting.
const INITIAL = {
  mode: 'paper',
  pinned: null,
  requested: 'paper',
  tutorState: 'connecting',
  captionsOn: true,
  micOn: true,
  cameraOn: true,
} as const;

export const useStageStore: UseBoundStore<StoreApi<StageStore>> = create<StageStore>()((set) => ({
  ...INITIAL,
  caption: {},
  requestMode: (m) => set((state) => ({ requested: m, mode: state.pinned ?? m })),
  pin: (m) => set({ pinned: m, mode: m }),
  unpin: () => set((state) => ({ pinned: null, mode: state.requested })),
  setTutorState: (tutorState) => set({ tutorState }),
  pushCaption: (speaker, text, lang) =>
    set((state) => ({
      caption: {
        previous: state.caption.current,
        current: lang ? { speaker, text, lang } : { speaker, text },
      },
    })),
  toggleCaptions: () => set((state) => ({ captionsOn: !state.captionsOn })),
  toggleMic: () => set((state) => ({ micOn: !state.micOn })),
  toggleCamera: () => set((state) => ({ cameraOn: !state.cameraOn })),
  reset: () => set({ ...INITIAL, caption: {} }),
}));

/**
 * The Board control, both the dock button and B (R17): Paper pinned → Split pinned → Board
 * pinned → Follow Ada (unpinned, which shows her last request) → Paper pinned.
 */
export function cycleBoardView(): void {
  const { pinned, pin, unpin } = useStageStore.getState();
  if (pinned === null) pin('paper');
  else if (pinned === 'paper') pin('split');
  else if (pinned === 'split') pin('board');
  else unpin();
}
