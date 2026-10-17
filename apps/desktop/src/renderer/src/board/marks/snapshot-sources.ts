// Where a snapshot of her paper comes from, by the kind of frame Ada names: the fixture page
// here, and P3's stored frames, its latest one and a grab of the live feed once Task 12
// registers them. A source loads the image, the projection from page coordinates onto it, and
// when it has them, the automaton's spec and where its ink is.
import type { AutomatonSpec, FrameRef, PaperElements } from '@tassel/shared/beats';
import { FIXTURE_DFA_WRONG } from './fixture-paper';
import { type Project, rectProjector } from './project';

/** The snapshot's picture: an image URL to revoke once it's no longer shown, or a fixture page. */
export type SnapshotImage =
  | { kind: 'url'; url: string; w: number; h: number; revoke(): void }
  | { kind: 'fixture'; name: 'dfa-wrong'; w: number; h: number };

export interface LoadedFrame {
  image: SnapshotImage;
  /** Page coordinates → the image's pixels. */
  project: Project;
  /** When the frame was captured, as an ISO 8601 date-time. */
  capturedAt: string;
  elements?: PaperElements;
  spec?: AutomatonSpec;
}

export interface SnapshotSource {
  /** Rejects on failure; `signal` aborts when a newer freeze or going live replaces this one. */
  load(ref: FrameRef, ctx: { signal: AbortSignal }): Promise<LoadedFrame>;
}

const sources = new Map<FrameRef['kind'], SnapshotSource>();

/**
 * Makes `source` load every frame of `kind`. Returns the unregister, which brings back the
 * source it replaced, if any.
 */
export function registerSnapshotSource(kind: FrameRef['kind'], source: SnapshotSource): () => void {
  const previous = sources.get(kind);
  sources.set(kind, source);
  return () => {
    if (sources.get(kind) !== source) return;
    if (previous) sources.set(kind, previous);
    else sources.delete(kind);
  };
}

/** The source for frames of `kind`, if one is registered. */
export function snapshotSourceFor(kind: FrameRef['kind']): SnapshotSource | undefined {
  return sources.get(kind);
}

/** The fixture page, captured as it's asked for. */
export const fixtureSource: SnapshotSource = {
  async load(ref, { signal }) {
    if (signal.aborted) throw new DOMException('The freeze was replaced', 'AbortError');
    if (ref.kind !== 'fixture')
      throw new Error(`The fixture source can't load a ${ref.kind} frame`);
    const { w, h, spec, elements } = FIXTURE_DFA_WRONG;
    return {
      image: { kind: 'fixture', name: ref.name, w, h },
      project: rectProjector(w, h),
      capturedAt: new Date().toISOString(),
      elements,
      spec,
    };
  },
};

registerSnapshotSource('fixture', fixtureSource);
