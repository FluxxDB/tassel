// The scripted tutor P1 runs on: it plays a FakeScript's events at their times after connect,
// `speed` times faster, so the session screen can be driven, shown and tested without a voice
// loop. sendText stands in for the student speaking.
import type { Lang } from '@tassel/shared/i18n';
import { systemClock } from './clock';
import type { Clock, FakeScript, TutorClient, TutorEvent } from './types';

export class FakeTutorClient implements TutorClient {
  private readonly steps: FakeScript['steps'];
  private readonly clock: Clock;
  private readonly speed: number;
  private readonly lang: Lang;
  private readonly tutorName?: () => string;
  private readonly listeners = new Set<(event: TutorEvent) => void>();
  private timer: unknown = null;
  private connected = false;

  /**
   * @param opts.speed how many times faster than the script's own times (TASSEL_FAKE_SPEED).
   * @param opts.lang the language of lines sent with sendText; English by default.
   */
  constructor(
    script: FakeScript,
    opts: { clock?: Clock; speed?: number; lang?: Lang; tutorName?: () => string } = {},
  ) {
    // A stable sort, so steps at the same time keep the script's order.
    this.steps = [...script.steps].sort((a, b) => a.at - b.at);
    this.clock = opts.clock ?? systemClock;
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.lang = opts.lang ?? 'en';
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
      const event = step.event;
      this.emit(
        event.type === 'caption' && this.tutorName
          ? { ...event, text: event.text.replaceAll('Ada', this.tutorName()) }
          : event,
      );
      if (this.connected) this.schedule(index + 1, start);
    }, delay);
  }

  private stop(): void {
    this.connected = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(event: TutorEvent): void {
    if (!this.connected) return;
    for (const listener of [...this.listeners]) listener(event);
  }
}
