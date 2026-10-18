// How each of Ada's board actions changes the scene: purely, never in place, and never throwing.
// A bad action (an unknown item or element, a reveal before its automaton exists: Review Focus 5)
// leaves the scene as it was, the same object, and says why in `problem`. Where a rule says so,
// its valid part still applies. Every change bumps `rev`; an action that changes nothing doesn't.
import {
  type AutomatonSpec,
  type BoardAction,
  checkAutomaton,
  type ElementRef,
  edgeRef,
  type StateId,
} from '@tassel/shared/beats';
import { type AutomatonRun, mergedEdges, runAutomaton } from '../automata/run';
import { diagramElements, diagramNeeds, diagramRef } from './diagram';
import {
  type AutomatonItem,
  type BoardEffect,
  type BoardItem,
  type BoardScene,
  type DiagramItem,
  EMPTY_SCENE,
  type NoteItem,
  type TraceItem,
} from './types';

/** An item whose pieces Ada reveals, highlights and pulses: an automaton or a diagram. */
type Drawing = AutomatonItem | DiagramItem;

export { EMPTY_SCENE };

export interface BoardResult {
  scene: BoardScene;
  effects: BoardEffect[];
  problem: string | null;
}

export function reduceBoard(scene: BoardScene, action: BoardAction): BoardResult {
  switch (action.kind) {
    case 'board.automaton': {
      const problems = checkAutomaton(action.spec);
      if (problems.length > 0) return unchanged(scene, `bad spec: ${problems.join('; ')}`);
      const item: AutomatonItem = {
        kind: 'automaton',
        id: action.item,
        title: action.title ?? null,
        spec: action.spec,
        revealed: action.reveal === 'none' ? [] : 'all',
        highlighted: [],
        current: [],
      };
      return changed(scene, { items: put(scene.items, item), focus: item.id });
    }

    case 'board.diagram': {
      // The same diagram again redraws in place: what she has shown or highlighted and is still
      // there stays so, and with reveal: none what's new waits for her.
      const before = scene.items.find(
        (i): i is DiagramItem => i.kind === 'diagram' && i.id === action.item,
      );
      const now = new Set(diagramElements(action.spec));
      const kept = (els: 'all' | ElementRef[]): ElementRef[] =>
        before
          ? (els === 'all' ? diagramElements(before.spec) : els).filter((el) => now.has(el))
          : [];
      const item: DiagramItem = {
        kind: 'diagram',
        id: action.item,
        title: action.spec.title ?? null,
        spec: action.spec,
        revealed: action.reveal === 'none' ? kept(before?.revealed ?? []) : 'all',
        highlighted: kept(before?.highlighted ?? []),
      };
      return changed(scene, { items: put(scene.items, item), focus: item.id });
    }

    case 'board.addState': {
      const target = automatonOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      if (target.spec.states.some(({ id }) => id === action.id)) {
        return unchanged(scene, `duplicate state ${action.id}`);
      }
      const state = action.accept ? { id: action.id, accept: true } : { id: action.id };
      return withSpec(scene, target, { ...target.spec, states: [...target.spec.states, state] }, [
        `state:${action.id}`,
      ]);
    }

    case 'board.addTransition': {
      const target = automatonOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      const { from, to, symbols } = action;
      const { transitions } = target.spec;
      const at = transitions.findIndex((t) => t.from === from && t.to === to);
      const merged =
        at < 0
          ? [...transitions, { from, to, symbols: [...symbols] }]
          : transitions.map((t, i) =>
              i === at ? { ...t, symbols: [...new Set([...t.symbols, ...symbols])] } : t,
            );
      return withSpec(scene, target, { ...target.spec, transitions: merged }, [edgeRef(from, to)]);
    }

    case 'board.reveal': {
      const target = drawingOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      if (!action.els) {
        return target.revealed === 'all'
          ? unchanged(scene)
          : changed(scene, { items: put(scene.items, { ...target, revealed: 'all' }) });
      }
      const unknown = action.els.filter((el) => pieceOf(target, el) === null);
      const problem = unknown.length > 0 ? `unknown element ${unknown.join(', ')}` : null;
      const revealed = reveal(
        target,
        action.els.flatMap((el) => pieceOf(target, el) ?? []),
      );
      return revealed === target.revealed
        ? unchanged(scene, problem)
        : changed(scene, { items: put(scene.items, { ...target, revealed }) }, problem);
    }

    case 'board.highlight': {
      const target = drawingOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      const el = pieceOf(target, action.el);
      if (el === null) return unchanged(scene, `unknown element ${action.el}`);
      if (target.highlighted.includes(el) === action.on) return unchanged(scene);
      const highlighted = action.on
        ? [...target.highlighted, el]
        : target.highlighted.filter((other) => other !== el);
      return changed(scene, { items: put(scene.items, { ...target, highlighted }) });
    }

    case 'board.pulse': {
      const target = drawingOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      const el = pieceOf(target, action.el);
      if (el === null) return unchanged(scene, `unknown element ${action.el}`);
      if (!isRevealed(target, el)) return unchanged(scene, `not shown ${el}`);
      return unchanged(scene, null, [{ type: 'pulse', item: target.id, el }]);
    }

    case 'board.note': {
      const near = action.near ?? null;
      const anchor = near ? nearOf(scene, near, action.item) : null;
      const note: NoteItem = {
        kind: 'note',
        id: action.item,
        text: action.text,
        near: anchor && typeof anchor !== 'string' ? anchor : null,
      };
      const problem = typeof anchor === 'string' ? anchor : null;
      return changed(scene, { items: put(scene.items, note) }, problem);
    }

    case 'board.trace': {
      const problems = checkAutomaton(action.spec);
      if (problems.length > 0) return unchanged(scene, `bad spec: ${problems.join('; ')}`);
      const run = runAutomaton(action.spec, action.input);
      let items = scene.items;
      let on: string | null = null;
      let problem: string | null = null;
      if (action.on !== undefined) {
        // It can't be on itself: the trace is about to take that id.
        const target = action.on === action.item ? undefined : automatonOf(scene, action.on);
        if (target) {
          on = target.id;
          items = put(items, { ...target, current: startOf(run) });
        } else {
          problem = `unknown item ${action.on}`;
        }
      }
      const trace: TraceItem = {
        kind: 'trace',
        id: action.item,
        title: action.title ?? null,
        spec: action.spec,
        input: action.input,
        run,
        shown: 0,
        subject: action.subject ?? 'tutor',
        on,
        verdict: null,
      };
      // The camera frames the whole board while she traces (focus null: everything placed), so
      // the automaton the token moves on, the tape and her notes all stay in view; framing the
      // card alone would cut the automaton off. The steps change nothing here, so they keep it.
      return changed(scene, { items: put(items, trace), focus: null }, problem);
    }

    case 'board.traceStep': {
      const target = traceOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      const shown = Math.min(Math.max(action.step ?? target.shown + 1, 0), target.run.steps.length);
      if (shown === target.shown) return unchanged(scene);
      let items = put(scene.items, { ...target, shown });
      const effects: BoardEffect[] = [];
      const automaton = target.on === null ? undefined : automatonOf(scene, target.on);
      if (automaton) {
        const step = shown > 0 ? target.run.steps[shown - 1] : undefined;
        items = put(items, { ...automaton, current: step ? step.to : startOf(target.run) });
        if (step && step.edges.length > 0) {
          effects.push({ type: 'glide', item: automaton.id, edges: step.edges });
        }
      }
      return changed(scene, { items }, null, effects);
    }

    case 'board.verdict': {
      const target = traceOf(scene, action.item);
      if (!target) return unchanged(scene, `unknown item ${action.item}`);
      const verdict = {
        got: action.got,
        expected: action.expected ?? null,
        note: action.note ?? null,
      };
      const same =
        target.verdict?.got === verdict.got &&
        target.verdict.expected === verdict.expected &&
        target.verdict.note === verdict.note;
      return same
        ? unchanged(scene)
        : changed(scene, { items: put(scene.items, { ...target, verdict }) });
    }

    case 'board.focus': {
      const focus = action.item ?? null;
      if (focus !== null && !scene.items.some((i) => i.id === focus)) {
        return unchanged(scene, `unknown item ${focus}`);
      }
      return focus === scene.focus ? unchanged(scene) : changed(scene, { focus });
    }

    case 'board.clear': {
      if (action.item === undefined) {
        return scene.items.length === 0 && scene.focus === null
          ? unchanged(scene)
          : changed(scene, { items: [], focus: null });
      }
      const cleared = action.item;
      if (!scene.items.some((i) => i.id === cleared)) {
        return unchanged(scene, `unknown item ${cleared}`);
      }
      const gone = (i: BoardItem) =>
        i.id === cleared || (i.kind === 'note' && i.near?.item === cleared);
      const focused = scene.items.find((i) => i.id === scene.focus);
      return changed(scene, {
        items: scene.items.filter((i) => !gone(i)),
        focus: focused && gone(focused) ? null : scene.focus,
      });
    }

    default:
      return unchanged(scene, `unknown action ${(action as { kind?: unknown }).kind}`);
  }
}

/** Every piece of an automaton: 'start', then its states, then its merged edges. */
export function elementsOf(spec: AutomatonSpec): ElementRef[] {
  return [
    'start',
    ...spec.states.map(({ id }): ElementRef => `state:${id}`),
    ...mergedEdges(spec).map(({ from, to }) => edgeRef(from, to)),
  ];
}

export function isRevealed(item: Drawing, el: ElementRef): boolean {
  return item.revealed === 'all' || item.revealed.includes(el);
}

/** `el` as `item` names it (diagram.ts's diagramRef for a diagram), or null if it has no such piece. */
export function pieceOf(item: Drawing, el: ElementRef): ElementRef | null {
  if (item.kind === 'diagram') return diagramRef(item.spec, el);
  return elementsOf(item.spec).includes(el) ? el : null;
}

function unchanged(
  scene: BoardScene,
  problem: string | null = null,
  effects: BoardEffect[] = [],
): BoardResult {
  return { scene, effects, problem };
}

/** The scene with `changes`, one rev on. */
function changed(
  scene: BoardScene,
  changes: Partial<Pick<BoardScene, 'items' | 'focus'>>,
  problem: string | null = null,
  effects: BoardEffect[] = [],
): BoardResult {
  return { scene: { ...scene, ...changes, rev: scene.rev + 1 }, effects, problem };
}

/** `items` with `item` in place of the one with its id, or at the end. */
function put(items: BoardItem[], item: BoardItem): BoardItem[] {
  const at = items.findIndex((i) => i.id === item.id);
  return at < 0 ? [...items, item] : items.map((i, n) => (n === at ? item : i));
}

function automatonOf(scene: BoardScene, id: string): AutomatonItem | undefined {
  return scene.items.find((i): i is AutomatonItem => i.kind === 'automaton' && i.id === id);
}

function drawingOf(scene: BoardScene, id: string): Drawing | undefined {
  return scene.items.find(
    (i): i is Drawing => (i.kind === 'automaton' || i.kind === 'diagram') && i.id === id,
  );
}

function traceOf(scene: BoardScene, id: string): TraceItem | undefined {
  return scene.items.find((i): i is TraceItem => i.kind === 'trace' && i.id === id);
}

/**
 * Where a note sits by `near`, its element as the item names it, or why it can't. It sits by an
 * element of an automaton, a diagram or a trace card, never by a note or by itself (it's about to
 * take that id).
 */
function nearOf(
  scene: BoardScene,
  near: { item: string; el: ElementRef },
  noteId: string,
): { item: string; el: ElementRef } | string {
  const anchor = scene.items.find((i) => i.id === near.item);
  if (!anchor || anchor.kind === 'note' || anchor.id === noteId) return `unknown item ${near.item}`;
  const el =
    anchor.kind === 'trace'
      ? elementsOf(anchor.spec).includes(near.el)
        ? near.el
        : null
      : pieceOf(anchor, near.el);
  return el === null ? `unknown element ${near.el}` : { item: near.item, el };
}

/** The states a run starts in: the start state and what ε-moves reach from it. */
function startOf(run: AutomatonRun): StateId[] {
  return run.steps[0]?.from ?? run.final;
}

/**
 * `target` with `spec` (checked first: a problem changes nothing) and `els` revealed when its
 * revealed is a list.
 */
function withSpec(
  scene: BoardScene,
  target: AutomatonItem,
  spec: AutomatonSpec,
  els: ElementRef[],
): BoardResult {
  const problems = checkAutomaton(spec);
  if (problems.length > 0) return unchanged(scene, problems.join('; '));
  return changed(scene, {
    items: put(scene.items, { ...target, spec, revealed: reveal({ ...target, spec }, els) }),
  });
}

/**
 * `item`'s revealed with `els` added, each after what it needs: an edge's two states, the start
 * state for 'start'. The same list when nothing is new, and 'all' stays 'all'.
 */
function reveal(item: Drawing, els: ElementRef[]): Drawing['revealed'] {
  if (item.revealed === 'all') return 'all';
  const added = new Set(item.revealed);
  const needs = (el: ElementRef) =>
    item.kind === 'diagram' ? diagramNeeds(item.spec, el) : withNeeds(item.spec, el);
  for (const el of els.flatMap(needs)) added.add(el);
  return added.size === item.revealed.length ? item.revealed : [...added];
}

function withNeeds(spec: AutomatonSpec, el: ElementRef): ElementRef[] {
  if (el === 'start') return [`state:${spec.start}`, 'start'];
  if (el.startsWith('edge:')) {
    const [from, to] = el.slice('edge:'.length).split('>');
    return [`state:${from}`, `state:${to}`, el];
  }
  return [el];
}
