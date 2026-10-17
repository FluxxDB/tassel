// An automaton as Graphviz DOT, for dot to lay out left to right. Nodes are 64 pt circles (twice
// STATE_RADIUS: 0.8889 in) with no text, since the board draws its own labels, and an invisible
// "__start" point gives the start arrow its tail. Each edge carries its key as its `id`, because
// Graphviz returns edges out of their input order.
import type { AutomatonSpec } from '@tassel/shared/beats';
import { mergedEdges } from '../automata/run';

/** The DOT for `spec`: its states, then its merged edges, in spec order. */
export function toDot(spec: AutomatonSpec): string {
  const states = spec.states
    .map(({ id, accept }) => (accept ? `${quote(id)} [shape=doublecircle];` : `${quote(id)};`))
    .join(' ');
  const edges = mergedEdges(spec).map(
    ({ from, to, symbols }) =>
      `  ${quote(from)} -> ${quote(to)} [id=${quote(`${from}>${to}`)}, label=${quote(symbols.join(','))}];`,
  );
  return [
    'digraph automaton {',
    '  rankdir=LR; nodesep=0.45; ranksep=0.6; splines=true;',
    '  node [shape=circle, fixedsize=true, width=0.8889, label="", fontsize=14];',
    '  edge [arrowsize=0.7, fontsize=14];',
    '  "__start" [shape=point, width=0.01, style=invis];',
    `  ${states}`,
    `  "__start" -> ${quote(spec.start)} [id="start"];`,
    ...edges,
    '}',
  ].join('\n');
}

/**
 * A DOT string. Every id is quoted: a digit-led one such as "0a" isn't a DOT id when bare (M19),
 * and "node", "edge" and "graph" are keywords. A symbol may hold a quote or a backslash, which
 * would end the string or start one of Graphviz's label escapes (\N is the node's name).
 */
function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}
