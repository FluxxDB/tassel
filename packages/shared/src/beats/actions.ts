// What Ada does with her board, the student's paper and the stage: the actions that arrive in an
// `actions` event (now) or a beat's markers (as her words are heard), and their parser. Every
// action is checked field by field before anything applies it, so a bad one from a live tutor
// is dropped instead of half-drawn.
import {
  type AutomatonSpec,
  checkAutomaton,
  type ElementRef,
  isStateId,
  isSymbol,
  parseElementRef,
  type StateId,
} from './automaton';

export interface Pt {
  x: number;
  y: number;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StageView = 'paper' | 'board' | 'split';

export type BoardAction =
  | {
      kind: 'board.automaton';
      item: string;
      spec: AutomatonSpec;
      title?: string;
      reveal?: 'all' | 'none';
    }
  | { kind: 'board.addState'; item: string; id: StateId; accept?: boolean }
  | { kind: 'board.addTransition'; item: string; from: StateId; to: StateId; symbols: string[] }
  /** Without `els`, everything in the item. */
  | { kind: 'board.reveal'; item: string; els?: ElementRef[] }
  | { kind: 'board.highlight'; item: string; el: ElementRef; on: boolean }
  | { kind: 'board.pulse'; item: string; el: ElementRef }
  | { kind: 'board.note'; item: string; text: string; near?: { item: string; el: ElementRef } }
  | {
      kind: 'board.trace';
      item: string;
      spec: AutomatonSpec;
      /** At most 64 symbols, one character each. */
      input: string;
      subject?: 'student' | 'tutor';
      on?: string;
      title?: string;
    }
  | { kind: 'board.traceStep'; item: string; step?: number }
  | {
      kind: 'board.verdict';
      item: string;
      got: 'accept' | 'reject';
      expected?: 'accept' | 'reject';
      note?: string;
    }
  | { kind: 'board.focus'; item?: string }
  | { kind: 'board.clear'; item?: string };

/** Where a paper mark points, in page coordinates (P5-R10). */
export type PaperTarget = { el: ElementRef | DetectedId } | { at: Pt } | { box: NormRect };

export type PaperMark =
  | { type: 'circle'; id: string; target: PaperTarget; wash?: boolean }
  | { type: 'arrow'; id: string; from: PaperTarget; to: PaperTarget }
  | { type: 'step'; id: string; n: number; target: PaperTarget }
  /** `text` is at most 280 characters. */
  | { type: 'callout'; id: string; target: PaperTarget; text: string }
  | { type: 'strike'; id: string; target: PaperTarget }
  | { type: 'check'; id: string; target: PaperTarget };

export type FrameRef =
  | { kind: 'frame'; id: string }
  | { kind: 'paper'; id: string; capturedAt: string }
  | { kind: 'latest' }
  | { kind: 'live' }
  | { kind: 'fixture'; name: 'dfa-wrong' };

/** Numbered visual candidates, independent of semantic automaton ids. */
export type DetectedId = `m${number}`;
export interface DetectedElement {
  id: DetectedId;
  kind: 'circle' | 'label';
  /** Flattened-page pixels, not normalized page coordinates. */
  box: NormRect;
}
export interface DetectedElements {
  width: number;
  height: number;
  items: DetectedElement[];
}

/** Automaton geometry uses page coordinates; detected items use flattened-page pixels. */
export interface PaperElements {
  detected?: DetectedElements;
  /** `r` in page-width units. */
  states: Record<StateId, { center: Pt; r: number }>;
  /** A self-loop's path runs around its state. */
  edges: Record<string, { path: Pt[]; label?: Pt }>;
  start?: { path: Pt[] };
}

export type PaperAction =
  | { kind: 'paper.freeze'; frame: FrameRef; elements?: PaperElements; spec?: AutomatonSpec }
  | { kind: 'paper.mark'; mark: PaperMark }
  | { kind: 'paper.unmark'; id: string }
  /** `input` is at most 64 symbols, one character each. */
  | { kind: 'paper.trace'; input: string }
  | { kind: 'paper.traceStep'; step?: number }
  | { kind: 'paper.clear' }
  | { kind: 'paper.live' };

export type StageAction = { kind: 'stage'; view: StageView };

export type BeatAction = BoardAction | PaperAction | StageAction;

/**
 * The action in `data`, or null if any field is wrong. The rules, which the server's mirror
 * holds to as well:
 * - An object has exactly its fields: an unknown one rejects it. An optional field that is null
 *   reads as absent (Pydantic may send one), and the result leaves it out.
 * - Item and mark ids match /^[A-Za-z0-9_-]{1,64}$/; state ids, symbols and element refs are
 *   automaton.ts's; every spec passes checkAutomaton.
 * - Titles, notes and callouts are 1–280 characters (code points); a step's `n` is 0–99, and a
 *   trace step is a whole number from 0. Coordinates are finite, and a box's size isn't negative.
 * - A trace's `input`, on the board or the paper, is at most 64 symbols of one character (code
 *   point) each; it may be empty.
 * - A paper target has exactly one of `el`, `at` and `box`; an edge path has at least 2 points.
 */
export function parseAction(data: unknown): BeatAction | null {
  try {
    return readAction(data);
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEXT_MAX = 280;
/** A trace's longest input, so the tape and its steps stay bounded. */
const INPUT_MAX = 64;

class Invalid extends Error {}

function invalid(): never {
  throw new Invalid('invalid action');
}

type Fields = Record<string, unknown>;

function isFields(data: unknown): data is Fields {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

/** `data` as an object with all of `required` and nothing beyond `optional`. */
function fields(data: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!isFields(data)) invalid();
  for (const key of Object.keys(data)) {
    if (!required.includes(key) && !optional.includes(key)) invalid();
  }
  for (const key of required) {
    if (!Object.hasOwn(data, key) || data[key] === undefined) invalid();
  }
  return data;
}

/** An optional field: undefined when absent or null, else what `read` makes of it. */
function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined || value === null ? undefined : read(value);
}

/** A copy of `value` without its undefined fields, so absent options stay absent. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function id(value: unknown): string {
  return typeof value === 'string' && ID.test(value) ? value : invalid();
}

function stateId(value: unknown): StateId {
  return isStateId(value) ? value : invalid();
}

function elementRef(value: unknown): ElementRef {
  return typeof value === 'string' && parseElementRef(value) ? (value as ElementRef) : invalid();
}

function text(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const length = [...value].length;
  return length >= 1 && length <= TEXT_MAX ? value : invalid();
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

function traceInput(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return [...value].length <= INPUT_MAX ? value : invalid();
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}

function oneOf<const T extends string>(values: readonly T[]) {
  return (value: unknown): T => (values.includes(value as T) ? (value as T) : invalid());
}

function whole(min: number, max = Number.MAX_SAFE_INTEGER) {
  return (value: unknown): number =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max
      ? (value as number)
      : invalid();
}

function finite(value: unknown): number {
  return Number.isFinite(value) ? (value as number) : invalid();
}

function list<T>(value: unknown, read: (item: unknown) => T, min = 0): T[] {
  if (!Array.isArray(value) || value.length < min) invalid();
  return value.map(read);
}

function pt(value: unknown): Pt {
  const f = fields(value, ['x', 'y']);
  return { x: finite(f.x), y: finite(f.y) };
}

function normRect(value: unknown): NormRect {
  const f = fields(value, ['x', 'y', 'w', 'h']);
  const size = (v: unknown) => (finite(v) >= 0 ? (v as number) : invalid());
  return { x: finite(f.x), y: finite(f.y), w: size(f.w), h: size(f.h) };
}

function spec(value: unknown, board = false): AutomatonSpec {
  const f = fields(value, ['kind', 'states', 'start', 'transitions']);
  const parsed: AutomatonSpec = {
    kind: oneOf(['dfa', 'nfa'] as const)(f.kind),
    states: list(f.states, (s) => {
      const state = fields(s, ['id'], ['accept']);
      return compact({ id: string(state.id), accept: optional(state.accept, bool) });
    }),
    start: string(f.start),
    transitions: list(f.transitions, (t) => {
      const move = fields(t, ['from', 'to', 'symbols']);
      return { from: string(move.from), to: string(move.to), symbols: symbols(move.symbols) };
    }),
  };
  if (board && parsed.kind === 'dfa') {
    const seen = new Map<string, string>();
    parsed.transitions = parsed.transitions.flatMap((move) => {
      const kept = move.symbols.filter((symbol) => {
        const key = JSON.stringify([move.from, symbol]);
        if (seen.has(key) && seen.get(key) !== move.to) {
          console.info(
            `Board tag trimmed: dropped ${move.from}-${symbol}-${move.to}; kept ${seen.get(key)}`,
          );
          return false;
        }
        seen.set(key, move.to);
        return true;
      });
      return kept.length ? [{ ...move, symbols: kept }] : [];
    });
  }
  return checkAutomaton(parsed).length === 0 ? parsed : invalid();
}

function symbols(value: unknown): string[] {
  return list(value, (s) => (isSymbol(s) ? s : invalid()), 1);
}

function target(value: unknown): PaperTarget {
  if (!isFields(value)) invalid();
  if ('el' in value) {
    const el = fields(value, ['el']).el;
    return { el: isDetectedId(el) ? el : elementRef(el) };
  }
  if ('at' in value) return { at: pt(fields(value, ['at']).at) };
  if ('box' in value) return { box: normRect(fields(value, ['box']).box) };
  return invalid();
}

function frame(value: unknown): FrameRef {
  const kind = isFields(value) ? value.kind : undefined;
  switch (kind) {
    case 'paper': {
      const f = fields(value, ['kind', 'id', 'capturedAt']);
      const docId = (v: unknown) => {
        const s = string(v);
        return [...s].length >= 1 && [...s].length <= 64 ? s : invalid();
      };
      return { kind, id: docId(f.id), capturedAt: docId(f.capturedAt) };
    }
    case 'frame': {
      const f = fields(value, ['kind', 'id']);
      const frameId = string(f.id);
      return frameId.length >= 1 && [...frameId].length <= 64 ? { kind, id: frameId } : invalid();
    }
    case 'latest':
    case 'live':
      fields(value, ['kind']);
      return { kind };
    case 'fixture':
      return { kind, name: oneOf(['dfa-wrong'] as const)(fields(value, ['kind', 'name']).name) };
    default:
      return invalid();
  }
}

export function isDetectedId(value: unknown): value is DetectedId {
  return typeof value === 'string' && /^m[1-9][0-9]{0,2}$/.test(value) && !value.endsWith('\n');
}

function detected(value: unknown): DetectedElements {
  const f = fields(value, ['width', 'height', 'items']);
  const positive = (v: unknown) => {
    const n = finite(v);
    return n > 0 ? n : invalid();
  };
  const width = positive(f.width),
    height = positive(f.height);
  const seen = new Set<string>();
  const items = list(f.items, (v): DetectedElement => {
    const el = fields(v, ['id', 'kind', 'box']);
    if (!isDetectedId(el.id) || seen.has(el.id)) return invalid();
    seen.add(el.id);
    const box = normRect(el.box);
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.w <= 0 ||
      box.h <= 0 ||
      box.x + box.w > width ||
      box.y + box.h > height
    )
      return invalid();
    return { id: el.id, kind: oneOf(['circle', 'label'] as const)(el.kind), box };
  });
  if (items.length > 40) return invalid();
  return { width, height, items };
}

function elements(value: unknown): PaperElements {
  const f = fields(value, ['states', 'edges'], ['start', 'detected']);
  const record = (v: unknown) => (isFields(v) ? Object.entries(v) : invalid());
  const path = (v: unknown) => list(v, pt, 2);
  return compact({
    states: Object.fromEntries(
      record(f.states).map(([key, v]) => {
        const state = fields(v, ['center', 'r']);
        const r = finite(state.r);
        return [stateId(key), { center: pt(state.center), r: r > 0 ? r : invalid() }];
      }),
    ),
    edges: Object.fromEntries(
      record(f.edges).map(([key, v]) => {
        if (parseElementRef(`edge:${key}`) === null) invalid();
        const edge = fields(v, ['path'], ['label']);
        return [key, compact({ path: path(edge.path), label: optional(edge.label, pt) })];
      }),
    ),
    start: optional(f.start, (v) => ({ path: path(fields(v, ['path']).path) })),
    detected: optional(f.detected, detected),
  });
}

function mark(value: unknown): PaperMark {
  const type = isFields(value) ? value.type : undefined;
  switch (type) {
    case 'circle': {
      const f = fields(value, ['type', 'id', 'target'], ['wash']);
      return compact({
        type,
        id: id(f.id),
        target: target(f.target),
        wash: optional(f.wash, bool),
      });
    }
    case 'arrow': {
      const f = fields(value, ['type', 'id', 'from', 'to']);
      return { type, id: id(f.id), from: target(f.from), to: target(f.to) };
    }
    case 'step': {
      const f = fields(value, ['type', 'id', 'n', 'target']);
      return { type, id: id(f.id), n: whole(0, 99)(f.n), target: target(f.target) };
    }
    case 'callout': {
      const f = fields(value, ['type', 'id', 'target', 'text']);
      return { type, id: id(f.id), target: target(f.target), text: text(f.text) };
    }
    case 'strike':
    case 'check': {
      const f = fields(value, ['type', 'id', 'target']);
      return { type, id: id(f.id), target: target(f.target) };
    }
    default:
      return invalid();
  }
}

const verdict = oneOf(['accept', 'reject'] as const);

function readAction(data: unknown): BeatAction {
  const kind = isFields(data) ? data.kind : undefined;
  switch (kind) {
    case 'board.automaton': {
      const f = fields(data, ['kind', 'item', 'spec'], ['title', 'reveal']);
      return compact({
        kind,
        item: id(f.item),
        spec: spec(f.spec, true),
        title: optional(f.title, text),
        reveal: optional(f.reveal, oneOf(['all', 'none'] as const)),
      });
    }
    case 'board.addState': {
      const f = fields(data, ['kind', 'item', 'id'], ['accept']);
      return compact({
        kind,
        item: id(f.item),
        id: stateId(f.id),
        accept: optional(f.accept, bool),
      });
    }
    case 'board.addTransition': {
      const f = fields(data, ['kind', 'item', 'from', 'to', 'symbols']);
      return {
        kind,
        item: id(f.item),
        from: stateId(f.from),
        to: stateId(f.to),
        symbols: symbols(f.symbols),
      };
    }
    case 'board.reveal': {
      const f = fields(data, ['kind', 'item'], ['els']);
      return compact({
        kind,
        item: id(f.item),
        els: optional(f.els, (v) => list(v, elementRef)),
      });
    }
    case 'board.highlight': {
      const f = fields(data, ['kind', 'item', 'el', 'on']);
      return { kind, item: id(f.item), el: elementRef(f.el), on: bool(f.on) };
    }
    case 'board.pulse': {
      const f = fields(data, ['kind', 'item', 'el']);
      return { kind, item: id(f.item), el: elementRef(f.el) };
    }
    case 'board.note': {
      const f = fields(data, ['kind', 'item', 'text'], ['near']);
      return compact({
        kind,
        item: id(f.item),
        text: text(f.text),
        near: optional(f.near, (v) => {
          const near = fields(v, ['item', 'el']);
          return { item: id(near.item), el: elementRef(near.el) };
        }),
      });
    }
    case 'board.trace': {
      const f = fields(data, ['kind', 'item', 'spec', 'input'], ['subject', 'on', 'title']);
      return compact({
        kind,
        item: id(f.item),
        spec: spec(f.spec),
        input: traceInput(f.input),
        subject: optional(f.subject, oneOf(['student', 'tutor'] as const)),
        on: optional(f.on, id),
        title: optional(f.title, text),
      });
    }
    case 'board.traceStep': {
      const f = fields(data, ['kind', 'item'], ['step']);
      return compact({ kind, item: id(f.item), step: optional(f.step, whole(0)) });
    }
    case 'board.verdict': {
      const f = fields(data, ['kind', 'item', 'got'], ['expected', 'note']);
      return compact({
        kind,
        item: id(f.item),
        got: verdict(f.got),
        expected: optional(f.expected, verdict),
        note: optional(f.note, text),
      });
    }
    case 'board.focus':
    case 'board.clear': {
      const f = fields(data, ['kind'], ['item']);
      return compact({ kind, item: optional(f.item, id) });
    }
    case 'paper.freeze': {
      const f = fields(data, ['kind', 'frame'], ['elements', 'spec']);
      return compact({
        kind,
        frame: frame(f.frame),
        elements: optional(f.elements, elements),
        spec: optional(f.spec, spec),
      });
    }
    case 'paper.mark':
      return { kind, mark: mark(fields(data, ['kind', 'mark']).mark) };
    case 'paper.unmark':
      return { kind, id: id(fields(data, ['kind', 'id']).id) };
    case 'paper.trace':
      return { kind, input: traceInput(fields(data, ['kind', 'input']).input) };
    case 'paper.traceStep': {
      const f = fields(data, ['kind'], ['step']);
      return compact({ kind, step: optional(f.step, whole(0)) });
    }
    case 'paper.clear':
    case 'paper.live':
      fields(data, ['kind']);
      return { kind };
    case 'stage':
      return {
        kind,
        view: oneOf(['paper', 'board', 'split'] as const)(fields(data, ['kind', 'view']).view),
      };
    default:
      return invalid();
  }
}
