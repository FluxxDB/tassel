// Automata as Ada draws them, on her board and on the student's paper: the spec, the references
// to its pieces (the start arrow, a state, an edge), and the check every spec passes before it's
// drawn. The server's Pydantic mirror (services/server/src/tassel/beats/models.py) holds to the
// same rules, against the shared fixtures.json.

/**
 * A state's id, which is also its label: /^[A-Za-z0-9][A-Za-z0-9_]{0,15}$/. That takes "q0" and
 * "qd", and the textbook "0", "1" and "2" a reading of her paper may carry (M19).
 */
export type StateId = string;

export const EPSILON = 'ε';

export interface AutomatonSpec {
  kind: 'dfa' | 'nfa';
  states: Array<{ id: StateId; accept?: boolean }>;
  start: StateId;
  /**
   * Each symbol is 1–4 characters, with no comma or space; EPSILON only in an NFA. Two
   * transitions on one ordered pair are one edge, their symbols merged.
   */
  transitions: Array<{ from: StateId; to: StateId; symbols: string[] }>;
}

/** A piece of an automaton: its start arrow, a state, or the edge of an ordered pair. */
export type ElementRef =
  | 'start'
  | `state:${string}`
  | `edge:${string}>${string}`
  /** A diagram's node or group (board.diagram). Its edges are `edge:A>B` between node ids. */
  | `node:${string}`
  | `group:${string}`;

export type ParsedElementRef =
  | { kind: 'start' }
  | { kind: 'state'; id: StateId }
  | { kind: 'edge'; from: StateId; to: StateId }
  | { kind: 'node'; id: StateId }
  | { kind: 'group'; id: StateId };

// JavaScript's $ matches only at the very end, so "q1\n" fails (Python's re.fullmatch agrees).
// No id starts with "_", so none can meet Graphviz's "__start" node.
const STATE_ID = /^[A-Za-z0-9][A-Za-z0-9_]{0,15}$/;

export function isStateId(id: unknown): id is StateId {
  return typeof id === 'string' && STATE_ID.test(id);
}

/** The ref of the edge from `from` to `to`, such as 'edge:q0>q1'. */
export function edgeRef(from: StateId, to: StateId): ElementRef {
  return `edge:${from}>${to}`;
}

/**
 * Reads 'start', 'state:q0', 'edge:q0>q1' (a self-loop is 'edge:q0>q0'), 'node:r1' or
 * 'group:zone1'; else null.
 */
export function parseElementRef(ref: string): ParsedElementRef | null {
  if (typeof ref !== 'string') return null;
  if (ref === 'start') return { kind: 'start' };
  if (ref.startsWith('state:')) {
    const id = ref.slice('state:'.length);
    return isStateId(id) ? { kind: 'state', id } : null;
  }
  for (const kind of ['node', 'group'] as const) {
    if (ref.startsWith(`${kind}:`)) {
      const id = ref.slice(kind.length + 1);
      return isStateId(id) ? { kind, id } : null;
    }
  }
  if (ref.startsWith('edge:')) {
    const ends = ref.slice('edge:'.length).split('>');
    if (ends.length === 2 && isStateId(ends[0]) && isStateId(ends[1])) {
      return { kind: 'edge', from: ends[0], to: ends[1] };
    }
  }
  return null;
}

/** A symbol of 1–4 characters (code points, as Python counts them), with no comma or space. */
export function isSymbol(symbol: unknown): symbol is string {
  if (typeof symbol !== 'string') return false;
  const length = [...symbol].length;
  return length >= 1 && length <= 4 && !/[,\s]/u.test(symbol);
}

/**
 * Every problem with a spec, each named once, in this order: bad and duplicate state ids, an
 * unknown start, then per transition its unknown states, no symbols at all, bad symbols, ε in a
 * DFA and a second move on one symbol. [] when the spec is valid. The exact strings:
 * `bad state id "q 1"`, `duplicate state q1`, `unknown start q9`, `unknown state q9 in q0>q9`,
 * `no symbols in q0>q1`, `bad symbol "0,1"`, `ε in a DFA`, `two moves from q0 on 1`.
 */
export function checkAutomaton(spec: AutomatonSpec): string[] {
  const problems = new Set<string>();
  const known = new Set<StateId>();
  for (const { id } of spec.states) {
    if (!isStateId(id)) problems.add(`bad state id ${JSON.stringify(id)}`);
    else if (known.has(id)) problems.add(`duplicate state ${id}`);
    known.add(id);
  }
  if (!known.has(spec.start)) problems.add(`unknown start ${spec.start}`);

  // A DFA's moves: from each state, on each symbol, the states it goes to.
  const moves = new Map<string, Set<StateId>>();
  for (const { from, to, symbols } of spec.transitions) {
    for (const end of [from, to]) {
      if (!known.has(end)) problems.add(`unknown state ${end} in ${from}>${to}`);
    }
    // An edge with no label: nothing could ever take it.
    if (symbols.length === 0) problems.add(`no symbols in ${from}>${to}`);
    for (const symbol of symbols) {
      if (!isSymbol(symbol)) {
        problems.add(`bad symbol ${JSON.stringify(symbol)}`);
      } else if (spec.kind === 'dfa' && symbol === EPSILON) {
        problems.add('ε in a DFA');
      } else if (spec.kind === 'dfa') {
        // Keyed by the pair, so no state id or symbol can run into another.
        const key = JSON.stringify([from, symbol]);
        const targets = moves.get(key) ?? new Set<StateId>();
        targets.add(to);
        moves.set(key, targets);
        if (targets.size > 1) problems.add(`two moves from ${from} on ${symbol}`);
      }
    }
  }
  return [...problems];
}
