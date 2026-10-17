// What one of Ada's automata does with an input: the run behind her trace card and its token's
// glide, one step per symbol read. A DFA holds one state, and a missing move goes to the implicit
// dead state (spec §5.3): the run stops there, stuck, and rejects. An NFA holds every state it can
// be in, closed under ε-moves at the start and after each symbol, in spec order.
import {
  type AutomatonSpec,
  type ElementRef,
  EPSILON,
  edgeRef,
  type StateId,
} from '@tassel/shared/beats';

export interface RunStep {
  /** The step's place in the run, and the symbol's in readSymbols(spec, input). */
  index: number;
  symbol: string;
  from: StateId[];
  /** [] when no move reads the symbol: the run is stuck. */
  to: StateId[];
  /** The merged edges the step takes, in mergedEdges order, the ε-moves after the symbol too. */
  edges: ElementRef[];
}

export interface AutomatonRun {
  input: string;
  steps: RunStep[];
  /** Where the run ends: [] when it got stuck. */
  final: StateId[];
  accepted: boolean;
  /** The index of the step no move could take, or null. */
  stuckAt: number | null;
}

interface MergedEdge {
  from: StateId;
  to: StateId;
  symbols: string[];
}

/**
 * One entry per ordered pair, in order of first appearance, its symbols unique and in first-seen
 * order: the edges the board draws, one arrow each.
 */
export function mergedEdges(spec: AutomatonSpec): MergedEdge[] {
  const edges = new Map<string, MergedEdge>();
  for (const { from, to, symbols } of spec.transitions) {
    // A state id never holds '>', so the key is unambiguous.
    const key = `${from}>${to}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = { from, to, symbols: [] };
      edges.set(key, edge);
    }
    for (const symbol of symbols) {
      if (!edge.symbols.includes(symbol)) edge.symbols.push(symbol);
    }
  }
  return [...edges.values()];
}

/**
 * The input as the automaton reads it: one symbol per character (code point), as the contract
 * defines a trace's input, so the trace card's tape has a cell per character. A transition on a
 * symbol of several characters is never taken by a run.
 */
export function readSymbols(_spec: AutomatonSpec, input: string): string[] {
  return [...input];
}

export function runAutomaton(spec: AutomatonSpec, input: string): AutomatonRun {
  const edges = mergedEdges(spec);
  const accepting = new Set(spec.states.filter((s) => s.accept).map((s) => s.id));
  const inSpecOrder = (states: ReadonlySet<StateId>) =>
    spec.states.map((s) => s.id).filter((id) => states.has(id));
  const isMove = (edge: MergedEdge, from: ReadonlySet<StateId>, symbol: string) =>
    symbol !== EPSILON && from.has(edge.from) && edge.symbols.includes(symbol);
  const isEpsilonMove = (edge: MergedEdge, within: ReadonlySet<StateId>) =>
    spec.kind === 'nfa' && within.has(edge.from) && edge.symbols.includes(EPSILON);

  /** `states` and every state ε-moves reach from them (a DFA has none). */
  const closure = (states: Set<StateId>): Set<StateId> => {
    const queue = [...states];
    for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
      for (const edge of edges) {
        if (edge.from === state && isEpsilonMove(edge, states) && !states.has(edge.to)) {
          states.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return states;
  };

  const steps: RunStep[] = [];
  let current = closure(new Set([spec.start]));
  for (const [index, symbol] of readSymbols(spec, input).entries()) {
    const moved = new Set(edges.filter((e) => isMove(e, current, symbol)).map((e) => e.to));
    const next = closure(moved);
    const taken = edges.filter((e) => isMove(e, current, symbol) || isEpsilonMove(e, next));
    const to = inSpecOrder(next);
    steps.push({
      index,
      symbol,
      from: inSpecOrder(current),
      to,
      edges: taken.map((e) => edgeRef(e.from, e.to)),
    });
    if (to.length === 0) return { input, steps, final: [], accepted: false, stuckAt: index };
    current = next;
  }
  const final = inSpecOrder(current);
  return { input, steps, final, accepted: final.some((id) => accepting.has(id)), stuckAt: null };
}
