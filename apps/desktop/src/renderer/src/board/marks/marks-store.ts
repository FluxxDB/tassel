// Ada's marks on the student's paper, over a frozen snapshot of it. `paper.freeze` loads a frame
// through the source for its kind; until it's ready, what Ada does to it waits in order, so the
// marks and the trace she sends in the same breath as the freeze still land (Review Focus 5,
// plan review C1). A load that fails leaves her paper live. Going live lets the image go.
import type {
  AutomatonSpec,
  FrameRef,
  PaperAction,
  PaperElements,
  PaperMark,
} from '@tassel/shared/beats';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { targetExists, targetsOf } from './geometry';
import { type LoadedFrame, type SnapshotImage, snapshotSourceFor } from './snapshot-sources';

/** `failed` shows like `live`, while the tag says the snapshot couldn't load. */
export type MarksStatus = 'live' | 'loading' | 'frozen' | 'failed';

export interface Snapshot extends Omit<LoadedFrame, 'elements' | 'spec'> {
  ref: FrameRef;
  /** The freeze's own, else the frame's, else null: then only points and boxes resolve. */
  elements: PaperElements | null;
  spec: AutomatonSpec | null;
}

/** Ada's trace over the snapshot: what she traces, and how many steps show. Task 10 runs it. */
export interface PaperTrace {
  input: string;
  shown: number;
}

export interface MarksState {
  status: MarksStatus;
  snapshot: Snapshot | null;
  marks: PaperMark[];
  trace: PaperTrace | null;
  /**
   * When the session screen opened, on Date.now's clock: the snapshot's label reads the session
   * timer's time (plan review M1). Null until a session starts.
   */
  sessionStartedAt: number | null;
  apply(action: PaperAction): void;
  /** Back to her live paper: drops the snapshot, its marks and any load in flight. */
  goLive(): void;
  /** Starts over, live, also aborting a load; `sessionStartedAt` starts a session's clock. */
  reset(sessionStartedAt?: number): void;
}

type Freeze = Extract<PaperAction, { kind: 'paper.freeze' }>;

/** The load in flight, if any: a newer freeze, going live or a reset aborts it. */
let loading: AbortController | null = null;
/** What Ada did to the snapshot while it loaded, in order. */
let queue: PaperAction[] = [];

const live = () =>
  ({ status: 'live', snapshot: null, marks: [], trace: null }) satisfies Partial<MarksState>;

export const useMarksStore: UseBoundStore<StoreApi<MarksState>> = create<MarksState>()(
  (set, get) => {
    /** Lets go of the snapshot on show and of any load in flight with what waits on it. */
    const release = () => {
      loading?.abort();
      loading = null;
      queue = [];
      revoke(get().snapshot?.image);
    };

    const fail = (frame: FrameRef, reason: unknown) => {
      console.warn(
        `[tassel] Couldn't load the ${frame.kind} snapshot; her paper stays live:`,
        reason,
      );
      set({ status: 'failed', snapshot: null, marks: [], trace: null });
    };

    const freeze = (action: Freeze) => {
      release();
      set({ status: 'loading', snapshot: null, marks: [], trace: null });
      const source = snapshotSourceFor(action.frame.kind);
      if (!source) {
        fail(action.frame, 'no source loads this kind of frame');
        return;
      }
      const controller = new AbortController();
      loading = controller;
      let load: Promise<LoadedFrame>;
      try {
        load = source.load(action.frame, { signal: controller.signal });
      } catch (error) {
        loading = null;
        fail(action.frame, error);
        return;
      }
      load.then(
        (frame) => {
          // Replaced while it loaded: nobody will show it.
          if (loading !== controller) {
            revoke(frame.image);
            return;
          }
          loading = null;
          const waiting = queue;
          queue = [];
          set({
            status: 'frozen',
            snapshot: {
              ...frame,
              ref: action.frame,
              elements: action.elements ?? frame.elements ?? null,
              spec: action.spec ?? frame.spec ?? null,
            },
            marks: [],
            trace: null,
          });
          for (const next of waiting) applyFrozen(next);
        },
        (error) => {
          if (loading !== controller) return;
          loading = null;
          queue = [];
          fail(action.frame, error);
        },
      );
    };

    /** One of Ada's actions on the snapshot on show. */
    const applyFrozen = (action: PaperAction) => {
      const { snapshot, marks, trace } = get();
      switch (action.kind) {
        case 'paper.mark': {
          const { mark } = action;
          const missing = targetsOf(mark).find(
            (target) => !targetExists(target, snapshot?.elements ?? null),
          );
          if (missing) {
            console.warn(
              `[tassel] Skipped Ada's ${mark.type} mark "${mark.id}": her paper has no such ink:`,
              missing,
            );
            return;
          }
          const at = marks.findIndex((m) => m.id === mark.id);
          set({ marks: at < 0 ? [...marks, mark] : marks.map((m, i) => (i === at ? mark : m)) });
          return;
        }
        case 'paper.unmark':
          if (marks.some((m) => m.id === action.id)) {
            set({ marks: marks.filter((m) => m.id !== action.id) });
          }
          return;
        case 'paper.clear':
          set({ marks: [], trace: null });
          return;
        case 'paper.trace':
          if (!snapshot?.spec) {
            console.warn("[tassel] Skipped a trace: there's no automaton on this snapshot to run.");
            return;
          }
          set({ trace: { input: action.input, shown: 0 } });
          return;
        case 'paper.traceStep':
          if (!trace) {
            console.warn('[tassel] Skipped a trace step: no trace has started on the paper.');
            return;
          }
          // Task 10 clamps it to the run's steps.
          set({ trace: { ...trace, shown: action.step ?? trace.shown + 1 } });
          return;
        default:
          return;
      }
    };

    return {
      ...live(),
      sessionStartedAt: null,
      apply(action) {
        if (action.kind === 'paper.freeze') {
          freeze(action);
          return;
        }
        if (action.kind === 'paper.live') {
          get().goLive();
          return;
        }
        const { status } = get();
        if (status === 'loading') {
          // Clear applies at once: what it would remove is still waiting, so it never shows.
          if (action.kind === 'paper.clear') queue = [];
          else queue.push(action);
          return;
        }
        if (status === 'frozen') {
          applyFrozen(action);
          return;
        }
        // Live, or failed to load: there's nothing to put it on. Unmark and clear have nothing
        // to remove.
        if (action.kind !== 'paper.unmark' && action.kind !== 'paper.clear') {
          console.warn(`[tassel] Skipped a ${action.kind}: her paper isn't frozen.`, action);
        }
      },
      goLive() {
        release();
        set(live());
      },
      reset(sessionStartedAt) {
        release();
        set({ ...live(), sessionStartedAt: sessionStartedAt ?? null });
      },
    };
  },
);

/** Applies one of Ada's paper actions, which dispatchActions has checked. */
export function applyPaperAction(action: PaperAction): void {
  useMarksStore.getState().apply(action);
}

/** Lets an image URL go once nothing shows it. */
function revoke(image: SnapshotImage | undefined): void {
  if (image?.kind !== 'url') return;
  try {
    image.revoke();
  } catch (error) {
    console.error("[tassel] Couldn't let go of a snapshot image:", error);
  }
}
