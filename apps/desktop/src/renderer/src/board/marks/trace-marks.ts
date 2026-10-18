// A semantic trace plan, independent of the paper's projection and panel size.
import type { ElementRef, StateId } from '@tassel/shared/beats';
import type { AutomatonRun } from '../automata/run';

export interface PaperTracePlan {
  dots: Array<{ n: number; el: ElementRef; repeat: number }>;
  ring: StateId[];
  glide: ElementRef | null;
  done: boolean;
}

export function planPaperTrace(run: AutomatonRun, shown: number): PaperTracePlan {
  const count = Math.max(0, Math.min(Math.floor(shown), run.steps.length));
  const steps = run.steps.slice(0, count);
  const used = new Map<ElementRef, number>();
  const dots = steps.flatMap((step) =>
    step.edges.map((el) => {
      const repeat = used.get(el) ?? 0;
      used.set(el, repeat + 1);
      return { n: step.index + 1, el, repeat };
    }),
  );
  const latest = steps.at(-1);
  return {
    dots,
    ring: latest ? latest.to : (run.steps[0]?.from ?? run.final),
    glide: latest?.edges.at(-1) ?? null,
    done: count === run.steps.length,
  };
}
