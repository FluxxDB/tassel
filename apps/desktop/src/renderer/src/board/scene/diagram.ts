// A diagram's pieces and sizes (board.diagram): its groups, nodes and edges as element refs, what
// each needs shown first, and how big each node card and group label is. The layout takes the
// sizes, so Graphviz leaves room for exactly what the shapes draw (figures.tsx's NodeFigure and
// GroupFigure set their text with these metrics). Pure: the board store measures with the DOM.
import {
  type DiagramEdge,
  type DiagramSpec,
  type ElementRef,
  edgeRef,
  parseElementRef,
  type StateId,
} from '@tassel/shared/beats';
import type { DiagramSizes } from '../layout/types';
import type { BoardTextStyle, MeasureText } from './placement';

/**
 * A node card: its stroke ICON at PAD_LEFT, then after ICON_GAP its label's line (Geist
 * LABEL_SIZE/500) over its sublabel's (Geist Mono SUB_SIZE, SUB_GAP below) when it has one, then
 * PAD_RIGHT; PAD_Y above and below the taller of the icon and the text, and never narrower than
 * MIN_W. Beside, not over: a network of zones stacks its nodes, and short cards keep it clear of
 * Ada's tile and the captions at a readable zoom.
 */
export const NODE_CARD = Object.freeze({
  padLeft: 12,
  icon: 24,
  iconGap: 10,
  padRight: 14,
  padY: 10,
  labelSize: 14,
  labelLine: 18,
  subSize: 12,
  subGap: 2,
  subLine: 16,
  minW: 112,
});

/**
 * A group's label block at its frame's top-left: PAD in from the frame's corner, one line of its
 * label (Geist Mono 12, uppercase) and, GAP after it, its sublabel; then BELOW before the first
 * node. One line, so a stack of zones stays short.
 */
export const GROUP_LABEL = Object.freeze({ pad: 10, size: 12, line: 16, gap: 8, below: 6 });

/** The edges a diagram draws: one per ordered pair (the first), and no self-loops. */
export function diagramEdges(spec: DiagramSpec): DiagramEdge[] {
  const seen = new Set<string>();
  return spec.edges.filter(({ from, to }) => {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every piece of a diagram: its groups, then its nodes, then its edges. */
export function diagramElements(spec: DiagramSpec): ElementRef[] {
  return [
    ...spec.groups.map(({ id }): ElementRef => `group:${id}`),
    ...spec.nodes.map(({ id }): ElementRef => `node:${id}`),
    ...diagramEdges(spec).map(({ from, to }) => edgeRef(from, to)),
  ];
}

/**
 * `ref` as the diagram names it, or null when it names nothing in it. An undirected edge can be
 * named either way round: 'edge:B>A' is its drawn 'edge:A>B'.
 */
export function diagramRef(spec: DiagramSpec, ref: ElementRef): ElementRef | null {
  const parsed = parseElementRef(ref);
  switch (parsed?.kind) {
    case 'group':
      return spec.groups.some(({ id }) => id === parsed.id) ? ref : null;
    case 'node':
      return spec.nodes.some(({ id }) => id === parsed.id) ? ref : null;
    case 'edge': {
      const edges = diagramEdges(spec);
      if (edges.some(({ from, to }) => from === parsed.from && to === parsed.to)) {
        return edgeRef(parsed.from, parsed.to);
      }
      const back = edges.find(
        ({ from, to, directed }) => !directed && from === parsed.to && to === parsed.from,
      );
      return back ? edgeRef(back.from, back.to) : null;
    }
    default:
      return null;
  }
}

/**
 * `el` after what it needs: a node comes with its group's frame, and an edge with its two nodes.
 * A group comes with every node in it, so revealing a zone shows the zone.
 */
export function diagramNeeds(spec: DiagramSpec, el: ElementRef): ElementRef[] {
  const node = (id: StateId): ElementRef[] => {
    const group = spec.nodes.find((n) => n.id === id)?.group;
    return group === undefined ? [`node:${id}`] : [`group:${group}`, `node:${id}`];
  };
  const parsed = parseElementRef(el);
  switch (parsed?.kind) {
    case 'node':
      return node(parsed.id);
    case 'edge':
      return [...node(parsed.from), ...node(parsed.to), el];
    case 'group':
      return [
        el,
        ...spec.nodes
          .filter((n) => n.group === parsed.id)
          .map(({ id }): ElementRef => `node:${id}`),
      ];
    default:
      return [el];
  }
}

/** Each node card's size and each group's label block, with the board's text measured. */
export function diagramSizes(spec: DiagramSpec, measure: MeasureText): DiagramSizes {
  const width = (text: string, style: BoardTextStyle) => {
    if (text === '') return 0;
    // One line each: the shapes never wrap them. A measure that sees no layout (jsdom, Node)
    // gives 0, and an estimate stands in.
    const measured = measure(text, style, 10_000).w;
    return Math.ceil(measured > 0 ? measured : estimate(text, style));
  };
  const nodes: DiagramSizes['nodes'] = {};
  for (const { id, label, sublabel } of spec.nodes) {
    const { padLeft, icon, iconGap, padRight, padY, labelLine, subGap, subLine, minW } = NODE_CARD;
    const text = Math.max(width(label, 'nodeLabel'), width(sublabel ?? '', 'nodeSub'));
    const lines = labelLine + (sublabel ? subGap + subLine : 0);
    nodes[id] = {
      w: Math.max(minW, padLeft + icon + iconGap + text + padRight),
      h: 2 * padY + Math.max(icon, lines),
    };
  }
  const groups: DiagramSizes['groups'] = {};
  for (const { id, label, sublabel } of spec.groups) {
    const { pad, line, gap, below } = GROUP_LABEL;
    const sub = sublabel ? gap + width(sublabel, 'groupSub') : 0;
    groups[id] = { w: pad + width(label, 'groupLabel') + sub + pad, h: pad + line + below };
  }
  return { nodes, groups };
}

/** Em per character, generously: Hangul and other wide script 1, capitals 0.7, the rest 0.6. */
function estimate(text: string, style: BoardTextStyle): number {
  const size =
    style === 'nodeLabel' ? NODE_CARD.labelSize : style === 'nodeSub' ? NODE_CARD.subSize : 12;
  const mono = style !== 'nodeLabel';
  const upper = style === 'groupLabel';
  let ems = 0;
  for (const char of text) {
    if (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/u.test(char)) ems += 1;
    else if (mono) ems += 0.63;
    else if (upper || /[A-Z0-9]/.test(char)) ems += 0.7;
    else ems += 0.6;
  }
  return ems * size;
}
