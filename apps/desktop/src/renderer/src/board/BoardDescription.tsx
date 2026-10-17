// The board's text alternative: a visually hidden list of what Ada has put on her board, in the
// session's language: what she has revealed of her automata (their states, start, accepting
// states and transitions), the steps her trace cards show so far and their verdicts, and her
// notes (review M3). It reads the store, not tldraw, so it holds whatever tldraw does.
import { edgeRef } from '@tassel/shared/beats';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { mergedEdges } from './automata/run';
import { useBoardStore } from './board-store';
import { verdictPills } from './scene/placement';
import { isRevealed } from './scene/reduce';
import type { AutomatonItem, BoardItem, TraceItem } from './scene/types';
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
