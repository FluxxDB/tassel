// The vision contract between the server and the desktop app: how Ada read the student's
// automaton, what the verifier found, and the vision events. The server's
// services/server/src/tassel/domains/dfa/contract.py and vision/messages.py mirror it, and
// ./fixtures.json holds the examples both sides' tests check. Wire keys are snake_case, like the
// REST API's. Page coordinates run from 0 to 1 across the flattened page, except where a field
// says pixels.

/** The symbol of an ε-move. */
export const EPSILON = 'ε';
/** The implicit dead state, in traces: where a missing move goes. */
export const DEAD = '∅';

export type MachineKind = 'dfa' | 'nfa';

export interface Pt {
  x: number;
  y: number;
}

export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReadState {
  id: string;
  /** What she wrote inside the circle. */
  label: string;
  start: boolean;
  accept: boolean;
  center: Pt;
  /** The radius, as a fraction of the page width (P5-R10). */
  r: number;
  box: NormBox;
  /** The Set-of-Mark number it was snapped to. */
  mark: number | null;
  snapped: boolean;
  confidence: number;
}

export interface ReadTransition {
  id: string;
  source: string;
  target: string;
  /** EPSILON for an ε-move. */
  symbols: string[];
  label_box: NormBox | null;
  mark: number | null;
  snapped: boolean;
  confidence: number;
}

/** The flattened page's size in pixels, and the page's quad (TL, TR, BR, BL) in JPEG pixels. */
export interface PageGeometry {
  width: number;
  height: number;
  quad: Pt[] | null;
}

export interface LanguageGuess {
  regex: string | null;
  confidence: number;
}

export interface DfaReading {
  version: 1;
  /** The frame's UUID. */
  frame_id: string | null;
  source: 'paper' | 'board' | 'fixture';
  kind: MachineKind;
  alphabet: string[];
  states: ReadState[];
  transitions: ReadTransition[];
  page: PageGeometry | null;
  problem: string | null;
  problem_kind: MachineKind | null;
  language: LanguageGuess | null;
  /** The ids of the states and transitions she should check. */
  uncertain: string[];
}

export type IssueKind =
  | 'implicit_dead_state'
  | 'nondeterminism'
  | 'epsilon_in_dfa'
  | 'missing_start'
  | 'multiple_starts'
  | 'no_accept'
  | 'unreachable'
  | 'unknown_symbol'
  | 'unlabeled_transition'
  | 'dangling_transition';

export interface Issue {
  kind: IssueKind;
  states: string[];
  symbols: string[];
}

/** The first step of the counterexample where her machine leaves the right track. */
export interface Blame {
  step: number;
  kind: 'transition' | 'missing_transition' | 'accept_flag';
  state: string;
  symbol: string | null;
  target: string | null;
  /** The input read before this step. */
  prefix: string;
}

export interface Counterexample {
  input: string;
  direction: 'false_accept' | 'false_reject';
  /** One sorted state set per step, start included (singletons for a DFA); [DEAD] after a missing move. */
  student_trace: string[][];
  reference_trace: string[];
  blame: Blame | null;
}

export interface Fix {
  kind: 'flip_accept' | 'redirect' | 'add_transition' | 'remove_transition';
  state: string;
  symbol: string | null;
  target: string | null;
}

/** A complete DFA: every state has a move on every symbol. */
export interface MachineSpec {
  states: string[];
  alphabet: string[];
  start: string;
  accepts: string[];
  transitions: Record<string, Record<string, string>>;
}

export interface ReferenceInfo {
  id: string;
  source: 'catalog' | 'llm-checked' | 'llm-unchecked';
  trusted: boolean;
  regex: string | null;
  title: string | null;
  machine: MachineSpec | null;
}

export type VerdictStatus = 'correct' | 'wrong' | 'unsure' | 'unknown' | 'unreadable';

export interface DfaVerdict {
  status: VerdictStatus;
  /** An exact check against a trusted reference. */
  computed: boolean;
  counterexample: Counterexample | null;
  issues: Issue[];
  fixes: Fix[];
  reference: ReferenceInfo | null;
}

/** The escalation ladder, in order. It never jumps to the solution unprompted. */
export type Rung = 'hint' | 'guiding_question' | 'counterexample' | 'walkthrough' | 'solution';

/** The decision gate's four questions, always asked in English. */
export type Predicate =
  | 'diagram_attempt_complete'
  | 'new_work_worth_checking'
  | 'student_seems_stuck'
  | 'not_schoolwork';

export const PREDICATES: readonly Predicate[] = [
  'diagram_attempt_complete',
  'new_work_worth_checking',
  'student_seems_stuck',
  'not_schoolwork',
];

export type GateReason = 'frame' | 'speech' | 'stall' | 'board';

export interface GateDebug {
  stage: 'gate';
  reason: GateReason;
  probs: Partial<Record<Predicate, number>>;
  ms: number;
  provider: string;
}

export interface CheckDebug {
  stage: 'check';
  status: VerdictStatus | 'failed' | 'refused' | 'timeout';
  /** The counterexample's input. */
  witness: string | null;
  /** The blamed step as text, such as "q0 -1-> q0". */
  blame: string | null;
  ms: number;
}

export interface PolicyDebug {
  stage: 'policy';
  action: 'hold' | 'speak' | 'drop' | 'holding-line';
  rung: Rung | null;
  why: string;
}

/** One stage of the vision loop, for the HUD. */
export type VisionDebug = GateDebug | CheckDebug | PolicyDebug;

/** Server to app. Both null clear the board's reading (a new page or a new problem). */
export interface ReadbackEvent {
  kind: 'readback';
  reading: DfaReading | null;
  verdict: DfaVerdict | null;
}

/** Server to app, for the HUD. */
export interface VisionDebugEvent {
  kind: 'vision-debug';
  debug: VisionDebug;
}

/** App to server: whether her pen is moving on the page. */
export interface PenEvent {
  kind: 'pen';
  busy: boolean;
}

// The guards. Each checks every declared field, with its type; fields the contract doesn't
// declare are allowed, so a newer server can add one.

type Fields = Record<string, unknown>;
type Guard<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isInt = (value: unknown): value is number => Number.isInteger(value);

function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

/** A guard for one of `values`' keys. The record type makes the compiler list every member. */
function oneOf<T extends string>(values: Record<T, true>): Guard<T> {
  return (value): value is T => typeof value === 'string' && Object.hasOwn(values, value);
}

const isStrings = arrayOf(isString);
const isStringOrNull = nullable(isString);
const isMachineKind = oneOf<MachineKind>({ dfa: true, nfa: true });

function isPt(value: unknown): value is Pt {
  return isRecord(value) && isNumber(value.x) && isNumber(value.y);
}

function isNormBox(value: unknown): value is NormBox {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.w) &&
    isNumber(value.h)
  );
}

function isReadState(value: unknown): value is ReadState {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.label) &&
    isBoolean(value.start) &&
    isBoolean(value.accept) &&
    isPt(value.center) &&
    isNumber(value.r) &&
    isNormBox(value.box) &&
    nullable(isInt)(value.mark) &&
    isBoolean(value.snapped) &&
    isNumber(value.confidence)
  );
}

function isReadTransition(value: unknown): value is ReadTransition {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.source) &&
    isString(value.target) &&
    isStrings(value.symbols) &&
    nullable(isNormBox)(value.label_box) &&
    nullable(isInt)(value.mark) &&
    isBoolean(value.snapped) &&
    isNumber(value.confidence)
  );
}

function isPageGeometry(value: unknown): value is PageGeometry {
  return (
    isRecord(value) &&
    isInt(value.width) &&
    isInt(value.height) &&
    nullable(arrayOf(isPt))(value.quad)
  );
}

function isLanguageGuess(value: unknown): value is LanguageGuess {
  return isRecord(value) && isStringOrNull(value.regex) && isNumber(value.confidence);
}

const isSource = oneOf<DfaReading['source']>({ paper: true, board: true, fixture: true });

export function isDfaReading(x: unknown): x is DfaReading {
  return (
    isRecord(x) &&
    x.version === 1 &&
    isStringOrNull(x.frame_id) &&
    isSource(x.source) &&
    isMachineKind(x.kind) &&
    isStrings(x.alphabet) &&
    arrayOf(isReadState)(x.states) &&
    arrayOf(isReadTransition)(x.transitions) &&
    nullable(isPageGeometry)(x.page) &&
    isStringOrNull(x.problem) &&
    nullable(isMachineKind)(x.problem_kind) &&
    nullable(isLanguageGuess)(x.language) &&
    isStrings(x.uncertain)
  );
}

const isIssueKind = oneOf<IssueKind>({
  implicit_dead_state: true,
  nondeterminism: true,
  epsilon_in_dfa: true,
  missing_start: true,
  multiple_starts: true,
  no_accept: true,
  unreachable: true,
  unknown_symbol: true,
  unlabeled_transition: true,
  dangling_transition: true,
});
const isBlameKind = oneOf<Blame['kind']>({
  transition: true,
  missing_transition: true,
  accept_flag: true,
});
const isDirection = oneOf<Counterexample['direction']>({ false_accept: true, false_reject: true });
const isFixKind = oneOf<Fix['kind']>({
  flip_accept: true,
  redirect: true,
  add_transition: true,
  remove_transition: true,
});
const isReferenceSource = oneOf<ReferenceInfo['source']>({
  catalog: true,
  'llm-checked': true,
  'llm-unchecked': true,
});
const isVerdictStatus = oneOf<VerdictStatus>({
  correct: true,
  wrong: true,
  unsure: true,
  unknown: true,
  unreadable: true,
});

function isIssue(value: unknown): value is Issue {
  return (
    isRecord(value) &&
    isIssueKind(value.kind) &&
    isStrings(value.states) &&
    isStrings(value.symbols)
  );
}

function isBlame(value: unknown): value is Blame {
  return (
    isRecord(value) &&
    isInt(value.step) &&
    isBlameKind(value.kind) &&
    isString(value.state) &&
    isStringOrNull(value.symbol) &&
    isStringOrNull(value.target) &&
    isString(value.prefix)
  );
}

function isCounterexample(value: unknown): value is Counterexample {
  return (
    isRecord(value) &&
    isString(value.input) &&
    isDirection(value.direction) &&
    arrayOf(isStrings)(value.student_trace) &&
    isStrings(value.reference_trace) &&
    nullable(isBlame)(value.blame)
  );
}

function isFix(value: unknown): value is Fix {
  return (
    isRecord(value) &&
    isFixKind(value.kind) &&
    isString(value.state) &&
    isStringOrNull(value.symbol) &&
    isStringOrNull(value.target)
  );
}

function isMoves(value: unknown): value is Record<string, Record<string, string>> {
  return (
    isRecord(value) &&
    Object.values(value).every((row) => isRecord(row) && Object.values(row).every(isString))
  );
}

function isMachineSpec(value: unknown): value is MachineSpec {
  return (
    isRecord(value) &&
    isStrings(value.states) &&
    isStrings(value.alphabet) &&
    isString(value.start) &&
    isStrings(value.accepts) &&
    isMoves(value.transitions)
  );
}

function isReferenceInfo(value: unknown): value is ReferenceInfo {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isReferenceSource(value.source) &&
    isBoolean(value.trusted) &&
    isStringOrNull(value.regex) &&
    isStringOrNull(value.title) &&
    nullable(isMachineSpec)(value.machine)
  );
}

export function isDfaVerdict(x: unknown): x is DfaVerdict {
  return (
    isRecord(x) &&
    isVerdictStatus(x.status) &&
    isBoolean(x.computed) &&
    nullable(isCounterexample)(x.counterexample) &&
    arrayOf(isIssue)(x.issues) &&
    arrayOf(isFix)(x.fixes) &&
    nullable(isReferenceInfo)(x.reference)
  );
}

const isPredicate = oneOf<Predicate>({
  diagram_attempt_complete: true,
  new_work_worth_checking: true,
  student_seems_stuck: true,
  not_schoolwork: true,
});
const isGateReason = oneOf<GateReason>({ frame: true, speech: true, stall: true, board: true });
const isCheckStatus = oneOf<CheckDebug['status']>({
  correct: true,
  wrong: true,
  unsure: true,
  unknown: true,
  unreadable: true,
  failed: true,
  refused: true,
  timeout: true,
});
const isAction = oneOf<PolicyDebug['action']>({
  hold: true,
  speak: true,
  drop: true,
  'holding-line': true,
});
const isRung = oneOf<Rung>({
  hint: true,
  guiding_question: true,
  counterexample: true,
  walkthrough: true,
  solution: true,
});

function isProbs(value: unknown): value is GateDebug['probs'] {
  return (
    isRecord(value) &&
    Object.entries(value).every(([predicate, p]) => isPredicate(predicate) && isNumber(p))
  );
}

/** One checker per stage; the mapped type makes the compiler insist on each. */
const DEBUG_CHECKS: { [S in VisionDebug['stage']]: (d: Fields) => boolean } = {
  gate: (d) => isGateReason(d.reason) && isProbs(d.probs) && isInt(d.ms) && isString(d.provider),
  check: (d) =>
    isCheckStatus(d.status) && isStringOrNull(d.witness) && isStringOrNull(d.blame) && isInt(d.ms),
  policy: (d) => isAction(d.action) && nullable(isRung)(d.rung) && isString(d.why),
};

export function isVisionDebug(x: unknown): x is VisionDebug {
  // Own keys only, so a stage like "constructor" never reaches Object.prototype.
  if (!isRecord(x) || typeof x.stage !== 'string' || !Object.hasOwn(DEBUG_CHECKS, x.stage)) {
    return false;
  }
  return DEBUG_CHECKS[x.stage as VisionDebug['stage']](x);
}
