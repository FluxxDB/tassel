// An automaton as Graphviz DOT, for dot to lay out left to right. Nodes are 64 pt circles (twice
// STATE_RADIUS: 0.8889 in) with no text, since the board draws its own labels, and an invisible
// "__start" point gives the start arrow its tail. Each edge carries its key as its `id`, because
// Graphviz returns edges out of their input order.
import type { AutomatonSpec, DiagramSpec } from '@tassel/shared/beats';
import { mergedEdges } from '../automata/run';
import { diagramEdges } from '../scene/diagram';
import type { DiagramSizes } from './types';

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
 * A diagram as DOT, for dot to lay out in its direction: each node a box of its measured size
 * (px are points here, 72 an inch) with no text, since the board draws its own; each group a
 * cluster around its nodes, whose label is an empty table the size of the group's label block, so
 * dot leaves room for it at the cluster's top-left; and each drawn edge with its key as its `id`,
 * an undirected one with no arrowhead (dir=none), a labelled one with its label for the room the
 * board's label takes.
 */
export function diagramToDot(spec: DiagramSpec, sizes: DiagramSizes): string {
  const node = (id: string) => {
    const size = sizes.nodes[id] ?? { w: 112, h: 56 };
    return `${quote(id)} [width=${inches(size.w)}, height=${inches(size.h)}];`;
  };
  const clusters = spec.groups.map(({ id }) => {
    const label = sizes.groups[id] ?? { w: 0, h: 0 };
    const members = spec.nodes.filter((n) => n.group === id).map((n) => `    ${node(n.id)}`);
    return [
      `  subgraph ${quote(`cluster_${id}`)} {`,
      `    label=<<table border="0" cellborder="0" cellpadding="0" cellspacing="0" fixedsize="true" width="${label.w}" height="${label.h}"><tr><td></td></tr></table>>;`,
      '    labeljust=l; labelloc=t; margin=10;',
      ...members,
      '  }',
    ];
  });
  const loose = spec.nodes.filter((n) => n.group === undefined).map((n) => `  ${node(n.id)}`);
  const edges = diagramEdges(spec).map(({ from, to, label, directed }) => {
    const attrs = [
      `id=${quote(`${from}>${to}`)}`,
      ...(directed ? [] : ['dir=none']),
      ...(label === undefined ? [] : [`label=${quote(label)}`]),
    ];
    return `  ${quote(from)} -> ${quote(to)} [${attrs.join(', ')}];`;
  });
  return [
    'digraph diagram {',
    `  rankdir=${spec.direction}; nodesep=0.25; ranksep=0.5; splines=true;`,
    '  node [shape=box, fixedsize=true, label=""];',
    '  edge [arrowsize=0.7, fontname="Courier", fontsize=15];',
    ...clusters.flat(),
    ...loose,
    ...edges,
    '}',
  ].join('\n');
}

/** `px` in inches, Graphviz's unit for a node's size: one px is a point. */
function inches(px: number): string {
  return (px / 72).toFixed(4);
}

/**
 * A DOT string. Every id is quoted: a digit-led one such as "0a" isn't a DOT id when bare (M19),
 * and "node", "edge" and "graph" are keywords. A symbol may hold a quote or a backslash, which
 * would end the string or start one of Graphviz's label escapes (\N is the node's name).
 */
function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}
