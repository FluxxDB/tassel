// Graphviz in WebAssembly (@viz-js/viz): dot lays an automaton out, and fromGraphvizJson turns
// its json0 into board px. One viz instance per thread, made on first use: the layout worker's in
// the app (the page's CSP compiles no WebAssembly, P5-R3), Node's under Vitest.
import type { AutomatonSpec } from '@tassel/shared/beats';
import { instance, type Viz } from '@viz-js/viz';
import { toDot } from './dot';
import { fromGraphvizJson, type GraphvizJson0 } from './from-graphviz';
import type { AutomatonLayout } from './types';

let viz: Promise<Viz> | null = null;

/** Lays `spec` out with Graphviz. Rejects if Graphviz can't start or can't draw it. */
export async function layoutWithViz(spec: AutomatonSpec): Promise<AutomatonLayout> {
  const dot = toDot(spec);
  const json = JSON.parse((await loadViz()).renderString(dot, { format: 'json0' }));
  return fromGraphvizJson(json as GraphvizJson0, spec);
}

function loadViz(): Promise<Viz> {
  viz ??= instance().catch((error: unknown) => {
    // Let the next layout try again.
    viz = null;
    throw error;
  });
  return viz;
}
