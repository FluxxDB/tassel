// The voice event contract between the server's voice bot and the desktop app, beside RTVI's own
// messages. services/server/src/tassel/voice/messages.py mirrors it, and ./fixtures.json holds
// the examples both sides' tests check, with the scripted student lines the fakes speak.
// Wire keys are snake_case, like the REST API's.
import { type BeatAction, type BeatDoc, parseAction, parseBeatDoc } from '../beats';
import type { Lang } from '../i18n';

/**
 * The envelope key. Server events travel as RTVI server messages whose data is
 * `{ tassel: ServerEvent }`; the app sends `sendClientMessage('tassel', ClientEvent)`.
 */
export const ENVELOPE = 'tassel';

/** How readily the student's speech interrupts Ada, shown as Fewer · Normal · Instant. */
export type Sensitivity = 'low' | 'normal' | 'high';
export type SttKind = 'flux' | 'nova-3' | 'fake';

/** The providers serving this connection, sent once it's up. */
export type RouteEvent = {
  kind: 'route';
  lang: Lang;
  stt: SttKind;
  llm: 'openrouter' | 'openai' | 'fake';
  tts: 'elevenlabs' | 'fake';
};

/** One turn's server-side timings, in whole milliseconds; null where the turn had no such step. */
export interface TurnMetrics {
  turn: number;
  lang: Lang;
  input: 'voice' | 'typed';
  stt_ms: number | null;
  llm_ttfb_ms: number | null;
  tts_ttfb_ms: number | null;
  server_ttfa_ms: number | null;
  interrupted: boolean;
  budget_ms: number;
}
export type TurnMetricsEvent = { kind: 'turn-metrics'; metrics: TurnMetrics };
/** A short reply ("uh-huh", "네") heard while Ada spoke, which didn't interrupt her. */
export type BackchannelEvent = { kind: 'backchannel'; text: string };

/** An image the student sent (`POST /v1/sessions/{id}/attachments`), in pixels. */
export interface MessageAttachment {
  id: string;
  w: number;
  h: number;
}
/**
 * What Ada did on the stage, a row in the chat that moves the stage there. `item` names what she
 * drew, cleared or marked when there is one; `attachment_id` is the image when `side` is image.
 */
export interface MessageAction {
  kind: 'draw' | 'clear' | 'undo' | 'redo' | 'mark' | 'view';
  side: 'board' | 'paper' | 'image';
  item: string | null;
  attachment_id: string | null;
}
/**
 * One line of the conversation, for the chat sidebar. A tutor line updates in place by `id`
 * while Ada speaks it (`final` false), then once more when it ends; `interrupted` when she was
 * cut off. `client_id` echoes the app's id for a typed student message. `source` is null for an
 * action row; `action` is set exactly when `role` is action.
 */
export interface ChatMessage {
  id: string;
  client_id: string | null;
  role: 'student' | 'tutor' | 'action';
  source: 'voice' | 'typed' | null;
  text: string;
  final: boolean;
  interrupted: boolean;
  attachments: MessageAttachment[];
  action: MessageAction | null;
}
export type ChatMessageEvent = { kind: 'message' } & ChatMessage;

export type ServerEvent =
  | { kind: 'beat'; beat: BeatDoc }
  | ChatMessageEvent
  | { kind: 'board-snapshot' }
  | { kind: 'actions'; actions: BeatAction[] }
  | RouteEvent
  | TurnMetricsEvent
  | BackchannelEvent
  | { kind: 'title'; title: string; subject: string | null }
  /** `pinned`: the student's own spoken view request, which the app pins (Ada's leave it out). */
  | { kind: 'stage'; view: 'paper' | 'board' | 'split'; pinned?: true }
  /** Ada drew on a hidden side: pulse that control once; keep the pinned view. */
  | { kind: 'stage-hint'; side: 'paper' | 'board' }
  | { kind: 'language'; lang: Lang }
  | { kind: 'vad'; speaking: boolean }
  /** Her turn began: the app uploads her paper as it is now (trigger "turn"). */
  | { kind: 'paper-frame' };

/**
 * What the app measured, in milliseconds: Ada's first audio after a turn, or how soon she yielded
 * and fell silent when the student talked over her; null where it wasn't measured. `sensitivity`
 * is the setting it was measured at, which picks the silence budget. The server rounds fractional
 * times to whole milliseconds.
 */
export interface ClientMetrics {
  ttfa_ms: number | null;
  barge_in_ms: number | null;
  yield_ms: number | null;
  sensitivity: Sensitivity;
}
export interface StageState {
  /** Omitted by older clients; the server treats omission as null. */
  pinned?: 'paper' | 'board' | 'split' | null;
  view: 'paper' | 'board' | 'split';
  frozen: boolean;
  page_revision: number;
}
export const MESSAGE_MAX_CHARS = 4000;
export const MESSAGE_MAX_ATTACHMENTS = 4;
/**
 * A message the student typed in the chat, with up to four uploaded images. Like speaking over
 * Ada, it interrupts her; `voice` false asks for a text-only reply. Text or an image, or both.
 */
export interface StudentMessage {
  client_id: string;
  text: string;
  attachment_ids: string[];
  voice: boolean;
}
export type ClientEvent =
  | ({ kind: 'student-message' } & StudentMessage)
  | ({ kind: 'stage-state' } & StageState)
  | { kind: 'ptt'; enabled: boolean; held: boolean }
  | { kind: 'sensitivity'; level: Sensitivity }
  | ({ kind: 'client-metrics' } & ClientMetrics);

/** The RTVI `requestData` of a voice offer. */
export interface OfferRequestData {
  /** The fake LLM's scenario; the server's default when absent. */
  scenario?: string;
  sensitivity: Sensitivity;
  ptt: boolean;
}

/**
 * The latency budgets (spec §2, P2-R5): Ada's first audio after the student stops talking, per
 * language; and on barge-in, from her speech onset, how soon Ada yields (ducks) and how soon she
 * is silent, on Normal and Fewer, and on Instant.
 */
export const VOICE_BUDGETS: {
  ttfa_ms: Record<Lang, number>;
  yield_ms: number;
  silence_ms: number;
  silence_instant_ms: number;
} = {
  ttfa_ms: { en: 1200, es: 1200, ko: 1400 },
  yield_ms: 300,
  silence_ms: 600,
  silence_instant_ms: 300,
};

/** How soon Ada must be silent after the student talks over her, at this sensitivity. */
export function silenceBudget(s: Sensitivity): number {
  return s === 'high' ? VOICE_BUDGETS.silence_instant_ms : VOICE_BUDGETS.silence_ms;
}

/** The voice offer endpoint for a session, relative to the server's origin. */
export function voiceOfferPath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/voice/offer`;
}

export const ICE_SERVERS_PATH = '/v1/voice/ice-servers';

/**
 * Reads an RTVI server message's data: the ServerEvent under `tassel`, or null when it isn't one.
 * Every declared field must be present with its declared type; fields the contract doesn't
 * declare are left out of the result, so a newer server can add one.
 */
export function parseServerEvent(data: unknown): ServerEvent | null {
  if (!isRecord(data)) return null;
  const event = data[ENVELOPE];
  if (!isRecord(event) || typeof event.kind !== 'string') return null;
  // Own keys only, so a kind like "constructor" never reaches Object.prototype.
  if (!Object.hasOwn(SERVER_EVENT_READERS, event.kind)) return null;
  return SERVER_EVENT_READERS[event.kind as ServerEvent['kind']](event);
}

type Fields = Record<string, unknown>;
type Guard<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || isNumber(value);
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || isString(value);

/** A guard for one of `values`' keys. The record type makes the compiler list every member. */
function oneOf<T extends string>(values: Record<T, true>): Guard<T> {
  return (value): value is T => typeof value === 'string' && Object.hasOwn(values, value);
}

const isLang = oneOf<Lang>({ en: true, es: true, ko: true });
const isSttKind = oneOf<SttKind>({ flux: true, 'nova-3': true, fake: true });
const isLlmKind = oneOf<RouteEvent['llm']>({ openrouter: true, openai: true, fake: true });
const isTtsKind = oneOf<RouteEvent['tts']>({ elevenlabs: true, fake: true });
const isInput = oneOf<TurnMetrics['input']>({ voice: true, typed: true });
const isView = oneOf<Extract<ServerEvent, { kind: 'stage' }>['view']>({
  paper: true,
  board: true,
  split: true,
});

function readTurnMetrics(m: unknown): TurnMetrics | null {
  if (!isRecord(m)) return null;
  return isNumber(m.turn) &&
    isLang(m.lang) &&
    isInput(m.input) &&
    isNumberOrNull(m.stt_ms) &&
    isNumberOrNull(m.llm_ttfb_ms) &&
    isNumberOrNull(m.tts_ttfb_ms) &&
    isNumberOrNull(m.server_ttfa_ms) &&
    isBoolean(m.interrupted) &&
    isNumber(m.budget_ms)
    ? {
        turn: m.turn,
        lang: m.lang,
        input: m.input,
        stt_ms: m.stt_ms,
        llm_ttfb_ms: m.llm_ttfb_ms,
        tts_ttfb_ms: m.tts_ttfb_ms,
        server_ttfa_ms: m.server_ttfa_ms,
        interrupted: m.interrupted,
        budget_ms: m.budget_ms,
      }
    : null;
}

const isRole = oneOf<ChatMessage['role']>({ student: true, tutor: true, action: true });
const isSource = oneOf<'voice' | 'typed'>({ voice: true, typed: true });
const isActionKind = oneOf<MessageAction['kind']>({
  draw: true,
  clear: true,
  undo: true,
  redo: true,
  mark: true,
  view: true,
});
const isActionSide = oneOf<MessageAction['side']>({ board: true, paper: true, image: true });

function readAttachment(value: unknown): MessageAttachment | null {
  if (!isRecord(value)) return null;
  const { id, w, h } = value;
  return isString(id) && isNumber(w) && isNumber(h) && w > 0 && h > 0 ? { id, w, h } : null;
}

function readAction(value: unknown): MessageAction | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { kind, side, item, attachment_id } = value;
  return isActionKind(kind) &&
    isActionSide(side) &&
    isStringOrNull(item) &&
    isStringOrNull(attachment_id)
    ? { kind, side, item, attachment_id }
    : undefined;
}

function readMessage(e: Fields): ChatMessageEvent | null {
  const { id, client_id, role, source, text, final, interrupted } = e;
  if (!isString(id) || !isStringOrNull(client_id) || !isRole(role)) return null;
  if (!(source === null || isSource(source)) || !isString(text)) return null;
  if (!isBoolean(final) || !isBoolean(interrupted) || !Array.isArray(e.attachments)) return null;
  const attachments = e.attachments.map(readAttachment);
  if (attachments.some((attachment) => attachment === null)) return null;
  const action = readAction(e.action);
  if (action === undefined || (role === 'action') !== (action !== null)) return null;
  return {
    kind: 'message',
    id,
    client_id,
    role,
    source,
    text,
    final,
    interrupted,
    attachments: attachments as MessageAttachment[],
    action,
  };
}

/** One reader per kind; the mapped type makes the compiler insist on each. */
const SERVER_EVENT_READERS: {
  [K in ServerEvent['kind']]: (e: Fields) => Extract<ServerEvent, { kind: K }> | null;
} = {
  message: readMessage,
  beat: (e) => {
    const { doc: beat } = parseBeatDoc(e.beat);
    return beat ? { kind: 'beat', beat } : null;
  },
  route: (e) =>
    isLang(e.lang) && isSttKind(e.stt) && isLlmKind(e.llm) && isTtsKind(e.tts)
      ? { kind: 'route', lang: e.lang, stt: e.stt, llm: e.llm, tts: e.tts }
      : null,
  'turn-metrics': (e) => {
    const metrics = readTurnMetrics(e.metrics);
    return metrics ? { kind: 'turn-metrics', metrics } : null;
  },
  backchannel: (e) => (isString(e.text) ? { kind: 'backchannel', text: e.text } : null),
  title: (e) =>
    isString(e.title) && isStringOrNull(e.subject)
      ? { kind: 'title', title: e.title, subject: e.subject }
      : null,
  stage: (e) =>
    isView(e.view)
      ? { kind: 'stage', view: e.view, ...(e.pinned === true && { pinned: true as const }) }
      : null,
  'stage-hint': (e) =>
    e.side === 'paper' || e.side === 'board' ? { kind: 'stage-hint', side: e.side } : null,
  language: (e) => (isLang(e.lang) ? { kind: 'language', lang: e.lang } : null),
  vad: (e) => (isBoolean(e.speaking) ? { kind: 'vad', speaking: e.speaking } : null),
  'paper-frame': () => ({ kind: 'paper-frame' }),
  'board-snapshot': () => ({ kind: 'board-snapshot' }),
  actions: (e) => {
    if (!Array.isArray(e.actions)) return null;
    const actions = e.actions.map(parseAction);
    if (actions.some((action) => action === null)) return null;
    return { kind: 'actions', actions: actions as BeatAction[] };
  },
};
