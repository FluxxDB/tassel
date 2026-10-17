// The board's text alternative: a visually hidden list of what Ada has revealed of her automata
// (their states, start, accepting states and transitions), in the session's language. It reads
// the store, not tldraw, so it holds whatever tldraw does.
import { edgeRef } from '@tassel/shared/beats';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { mergedEdges } from './automata/run';
import { useBoardStore } from './board-store';
import { isRevealed } from './scene/reduce';
import type { AutomatonItem } from './scene/types';
import { useSessionLang } from './use-session-lang';

type Say = (key: string, values?: Record<string, string>) => string;

export function BoardDescription(): JSX.Element {
  const lang = useSessionLang();
  const { t } = useTranslation();
  const items = useBoardStore((state) => state.scene.items);
  const say: Say = (key, values) => t(key, { ...values, lng: lang });
  // Two automata can read the same line, so each line is keyed by its item and place.
  const lines = items.flatMap((item) =>
    item.kind === 'automaton'
      ? describe(item, say).map((text, at) => ({ key: `${item.id}:${at}`, text }))
      : [],
  );
  return (
    <ul aria-label={say('board.description.label')} lang={lang} className="sr-only">
      {lines.map(({ key, text }) => (
        <li key={key}>{text}</li>
      ))}
    </ul>
  );
}

/** One automaton's revealed elements, in its spec's order. */
function describe(item: AutomatonItem, say: Say): string[] {
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
