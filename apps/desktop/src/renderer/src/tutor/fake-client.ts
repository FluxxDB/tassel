// The scripted tutor P1 runs on: it plays a FakeScript's events at their times after connect,
// `speed` times faster, so the session screen can be driven, shown and tested without a voice
// loop. sendText stands in for the student speaking. With `chat`, as the app runs it, it also plays
// the chat sidebar's side of the server: each scripted final line becomes a spoken chat line, and
// a typed message is echoed back and answered (aloud, or in text only), with an action row.
import type { Lang } from '@tassel/shared/i18n';
import type { ChatMessage } from '@tassel/shared/voice';
import { systemClock } from './clock';
import type { Clock, FakeScript, OutgoingMessage, TutorClient, TutorEvent } from './types';

/** Ada's scripted answers to a typed message, in two parts: the first, then the whole line. */
export const FAKE_REPLY = {
  voice: ['Good question.', "Good question. Let's sketch it on the board, one state at a time."],
  text: ['Here it is in writing:', 'Here it is in writing: start at q0 and follow each symbol.'],
} as const;
/** When each part of the answer comes, in ms after the message at speed 1. */
export const REPLY_MS = { first: 900, whole: 1800, action: 2200 } as const;

export class FakeTutorClient implements TutorClient {
  private readonly steps: FakeScript['steps'];
  private readonly clock: Clock;
  private readonly speed: number;
  private readonly lang: Lang;
  private readonly chat: boolean;
  private readonly tutorName?: () => string;
  private readonly listeners = new Set<(event: TutorEvent) => void>();
  private timer: unknown = null;
  private readonly replies = new Set<unknown>();
  private connected = false;
  private lines = 0;

  /**
   * @param opts.speed how many times faster than the script's own times (TASSEL_FAKE_SPEED).
   * @param opts.lang the language of lines sent with sendText; English by default.
   * @param opts.chat also play the chat sidebar's messages (off by default).
   */
  constructor(
    script: FakeScript,
    opts: {
      clock?: Clock;
      speed?: number;
      lang?: Lang;
      chat?: boolean;
      tutorName?: () => string;
    } = {},
  ) {
    // A stable sort, so steps at the same time keep the script's order.
    this.steps = [...script.steps].sort((a, b) => a.at - b.at);
    this.clock = opts.clock ?? systemClock;
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.lang = opts.lang ?? 'en';
    this.chat = opts.chat ?? false;
    this.tutorName = opts.tutorName;
  }

  /** Starts the script from its beginning, also after an earlier connect. */
  async connect(_sessionId: string): Promise<void> {
    this.stop();
    this.connected = true;
    this.schedule(0, this.clock.now());
  }

  async disconnect(): Promise<void> {
    this.stop();
  }

  on(listener: (event: TutorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  interrupt(_epoch: number): void {
    this.stop();
    this.connected = true;
    this.emit({ type: 'state', state: 'listening' });
  }

  sendText(text: string): void {
    this.emit({ type: 'caption', speaker: 'student', text, lang: this.lang, final: true });
  }

  /** Echoes the message as the server would, then answers it, aloud or in text only. */
  sendMessage({ clientId, text, attachmentIds, voice }: OutgoingMessage): boolean {
    if (!this.connected) return false;
    this.emitLine({
      client_id: clientId,
      role: 'student',
      source: 'typed',
      text,
      attachments: attachmentIds.map((id) => ({ id, w: 0, h: 0 })),
    });
    const id = this.nextId();
    const [first, whole] = voice ? FAKE_REPLY.voice : FAKE_REPLY.text;
    const tutor = { id, role: 'tutor' as const, source: 'typed' as const };
    this.later(REPLY_MS.first, () => {
      if (voice) this.emit({ type: 'state', state: 'speaking' });
      this.emitLine({ ...tutor, text: first, final: false });
    });
    this.later(REPLY_MS.whole, () => {
      // A text-only answer is never spoken, so it never captions.
      if (voice) {
        this.emit({ type: 'caption', speaker: 'tutor', text: whole, lang: this.lang, final: true });
        this.emit({ type: 'state', state: 'listening' });
      }
      this.emitLine({ ...tutor, text: whole });
    });
    this.later(REPLY_MS.action, () =>
      this.emitLine({
        role: 'action',
        action: { kind: 'draw', side: 'board', item: null, attachment_id: null },
      }),
    );
    return true;
  }

  /**
   * One timer at a time, each aimed at its step's time from `start`: late timers don't push the
   * later steps back, and steps due together fire in the script's order.
   */
  private schedule(index: number, start: number): void {
    const step = this.steps[index];
    if (!step) return;
    const delay = Math.max(0, start + step.at / this.speed - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      const event =
        step.event.type === 'caption' && this.tutorName
          ? { ...step.event, text: step.event.text.replaceAll('Ada', this.tutorName()) }
          : step.event;
      this.emit(event);
      // A scripted line is a spoken one: the chat shows it once it's final.
      if (this.chat && event.type === 'caption' && event.final)
        this.emitLine({ role: event.speaker, source: 'voice', text: event.text });
      if (this.connected) this.schedule(index + 1, start);
    }, delay);
  }

  private stop(): void {
    this.connected = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    for (const reply of this.replies) this.clock.clearTimeout(reply);
    this.replies.clear();
  }

  private nextId(): string {
    this.lines += 1;
    return `fake-line-${this.lines}`;
  }

  /** A chat line: final, whole and with no attachments unless `line` says otherwise. */
  private emitLine(line: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): void {
    if (!this.chat) return;
    this.emit({
      type: 'message',
      message: {
        id: this.nextId(),
        client_id: null,
        source: null,
        text: '',
        final: true,
        interrupted: false,
        attachments: [],
        action: null,
        ...line,
      },
    });
  }

  private later(ms: number, fn: () => void): void {
    const timer = this.clock.setTimeout(() => {
      this.replies.delete(timer);
      fn();
    }, ms / this.speed);
    this.replies.add(timer);
  }

  private emit(event: TutorEvent): void {
    if (!this.connected) return;
    for (const listener of [...this.listeners]) listener(event);
  }
}
