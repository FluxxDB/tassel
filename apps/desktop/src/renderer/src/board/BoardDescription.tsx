// The board's text alternative: a visually hidden list of what Ada has put on her board, in the
// session's language: what she has revealed of her automata (their states, start, accepting
// states and transitions) and of her diagrams (their groups with the nodes in them, each node, and
// its links), the steps her trace cards show so far and their verdicts, and her notes (review M3). It reads the store, not tldraw, so it holds whatever tldraw does.
import { edgeRef } from '@tassel/shared/beats';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { mergedEdges } from './automata/run';
import { useBoardStore } from './board-store';
import { diagramEdges } from './scene/diagram';
import { verdictPills } from './scene/placement';
import { isRevealed } from './scene/reduce';
import type { AutomatonItem, BoardItem, DiagramItem, TraceItem } from './scene/types';
import { useSessionLang } from './use-session-lang';

type Say = (key: string, values?: Record<string, string>) => string;

export function BoardDescription(): JSX.Element {
  const lang = useSessionLang();
  const { t } = useTranslation();
  const items = useBoardStore((state) => state.scene.items);
  const say: Say = (key, values) => t(key, { ...values, lng: lang });
  // Two items can read the same line, so each line is keyed by its item and place.
  const lines = items.flatMap((item) =>
    describe(item, say).map((text, at) => ({ key: `${item.id}:${at}`, text })),
  );
  return (
    <ul aria-label={say('board.description.label')} lang={lang} className="sr-only">
      {lines.map(({ key, text }) => (
        <li key={key}>{text}</li>
      ))}
    </ul>
  );
}

function describe(item: BoardItem, say: Say): string[] {
  switch (item.kind) {
    case 'automaton':
      return describeAutomaton(item, say);
    case 'diagram':
      return describeDiagram(item, say);
    case 'trace':
      return describeTrace(item, say);
    case 'note':
      return [say('board.description.note', { text: item.text })];
  }
}

/** One automaton's revealed elements, in its spec's order. */
function describeAutomaton(item: AutomatonItem, say: Say): string[] {
  const states = item.spec.states.filter(({ id }) => isRevealed(item, `state:${id}`));
  const lines: string[] = [];
  if (states.length > 0) {
    lines.push(say('board.description.states', { list: states.map(({ id }) => id).join(', ') }));
  }
  if (isRevealed(item, 'start')) {
    lines.push(say('board.description.start', { state: item.spec.start }));
  }
  const accepting = states.filter(({ accept }) => accept);
  if (accepting.length > 0) {
    lines.push(
      say('board.description.accepting', { list: accepting.map(({ id }) => id).join(', ') }),
    );
  }
  for (const { from, to, symbols } of mergedEdges(item.spec)) {
    if (isRevealed(item, edgeRef(from, to))) {
      lines.push(say('board.description.transition', { from, to, symbols: symbols.join(', ') }));
    }
  }
  return lines;
}

/**
 * One diagram's revealed pieces: its title once any is shown, each group with its shown nodes,
 * each shown node with its icon's name and sublabel, then each shown edge, in spec order.
 */
function describeDiagram(item: DiagramItem, say: Say): string[] {
  const { spec } = item;
  const nodes = spec.nodes.filter(({ id }) => isRevealed(item, `node:${id}`));
  const labels = new Map(spec.nodes.map(({ id, label }) => [id, label]));
  const lines: string[] = [];
  if (item.title !== null && (item.revealed === 'all' || item.revealed.length > 0)) {
    lines.push(say('board.description.diagram', { title: item.title }));
  }
  for (const group of spec.groups) {
    if (!isRevealed(item, `group:${group.id}`)) continue;
    const name = group.sublabel ? `${group.label} (${group.sublabel})` : group.label;
    const members = nodes.filter((node) => node.group === group.id).map(({ label }) => label);
    lines.push(
      members.length > 0
        ? say('board.description.group', { name, list: members.join(', ') })
        : say('board.description.groupEmpty', { name }),
    );
  }
  for (const { label, sublabel, icon } of nodes) {
    const kind = say(`board.icon.${icon}`);
    lines.push(
      sublabel
        ? say('board.description.nodeSub', { label, kind, sublabel })
        : say('board.description.node', { label, kind }),
    );
  }
  for (const edge of diagramEdges(spec)) {
    if (!isRevealed(item, edgeRef(edge.from, edge.to))) continue;
    const key = `${edge.directed ? 'arrow' : 'link'}${edge.label ? 'Labeled' : ''}`;
    const ends = { from: labels.get(edge.from) ?? edge.from, to: labels.get(edge.to) ?? edge.to };
    lines.push(say(`board.description.${key}`, edge.label ? { ...ends, label: edge.label } : ends));
  }
  return lines;
}

/** A trace card as it reads now: its title, the steps Ada has shown, then her verdict. */
function describeTrace(item: TraceItem, say: Say): string[] {
  const states = (ids: readonly string[]) => (ids.length === 1 ? ids[0] : `{${ids.join(', ')}}`);
  const steps = item.run.steps.slice(0, item.shown).map((step, at) => {
    const values = { n: String(at + 1), symbol: step.symbol, from: states(step.from) };
    return step.to.length === 0
      ? say('board.description.stuck', values)
      : say('board.description.step', { ...values, to: states(step.to) });
  });
  return [
    item.title ?? say('board.trace.title', { input: item.input }),
    ...steps,
    // The verdict row's pills, as the card shows them.
    ...verdictPills(item, say),
  ];
}
