import type { ClientMetrics } from '@tassel/shared/voice';
import type { Mic } from './mic';
import type { TutorAudio } from './tutor-audio';

export interface MeterThresholds {
  micOn: number;
  micOff: number;
  botOn: number;
  botOff: number;
  micOnMs: number;
  micOffMs: number;
  botOffMs: number;
}
const DEFAULTS: MeterThresholds = {
  micOn: 0.02,
  micOff: 0.01,
  botOn: 0.01,
  botOff: 0.005,
  micOnMs: 40,
  micOffMs: 300,
  botOffMs: 60,
};
type Measurement = Omit<ClientMetrics, 'sensitivity'>;

/** Debounces transitions but keeps the first sample's time, not the confirmation time. */
class Signal {
  active = false;
  startedAt: number | null = null;
  endedAt: number | null = null;
  private candidate: number | null = null;
  constructor(
    private on: number,
    private off: number,
    private onMs: number,
    private offMs: number,
  ) {}
  sample(at: number, rms: number): 'start' | 'end' | null {
    if (this.active ? rms < this.off : rms > this.on) {
      this.candidate ??= at;
      if (at - this.candidate >= (this.active ? this.offMs : this.onMs)) {
        this.active = !this.active;
        if (this.active) this.startedAt = this.candidate;
        else this.endedAt = this.candidate;
        this.candidate = null;
        return this.active ? 'start' : 'end';
      }
    } else this.candidate = null;
    return null;
  }
}

/** All times share the performance.now() clock used by Mic.openedAt and TutorAudio.onDuck. */
export class LatencyMeter {
  private mic: Signal;
  private bot: Signal;
  private speechEnd: number | null = null;
  private botPeriods: Array<{ start: number; end: number | null }> = [];
  private barge: {
    start: number;
    period: { start: number; end: number | null };
    duck: number | null;
  } | null = null;
  private recentDucks: number[] = [];
  private lookbackMs: number;

  constructor(t: Partial<MeterThresholds> = {}) {
    const thresholds = { ...DEFAULTS, ...t };
    this.lookbackMs = Math.max(thresholds.micOnMs, thresholds.micOffMs);
    this.mic = new Signal(
      thresholds.micOn,
      thresholds.micOff,
      thresholds.micOnMs,
      thresholds.micOffMs,
    );
    this.bot = new Signal(thresholds.botOn, thresholds.botOff, 0, thresholds.botOffMs);
  }
  markDuck(atMs: number): void {
    this.recentDucks.push(atMs);
    if (this.barge && atMs >= this.barge.start) this.barge.duck ??= atMs;
  }
  sample(atMs: number, micRms: number, botRms: number): Measurement | null {
    const micEvent = this.mic.sample(atMs, micRms);
    const botEvent = this.bot.sample(atMs, botRms);
    if (botEvent === 'start')
      this.botPeriods.push({ start: this.bot.startedAt as number, end: null });
    if (botEvent === 'end') {
      const last = this.botPeriods.at(-1);
      if (last) last.end = this.bot.endedAt;
    }
    // Keep enough history to classify events whose mic debounce hasn't completed yet.
    this.botPeriods = this.botPeriods.filter(
      (period) => period.end === null || period.end >= atMs - this.lookbackMs,
    );
    this.recentDucks = this.recentDucks.filter((at) => at >= atMs - this.lookbackMs);
    const playingAt = (at: number) =>
      this.botPeriods.find(
        (period) => period.start <= at && (period.end === null || period.end > at),
      );
    if (micEvent === 'start') {
      this.speechEnd = null;
      const start = this.mic.startedAt as number;
      const period = playingAt(start);
      this.barge = period
        ? { start, period, duck: this.recentDucks.find((at) => at >= start) ?? null }
        : null;
    }
    if (micEvent === 'end') {
      const end = this.mic.endedAt as number;
      this.speechEnd = playingAt(end) ? null : end;
    }
    if (this.barge?.period.end !== null && this.barge !== null) {
      const { start, period, duck } = this.barge;
      this.barge = null;
      const delay = (period.end as number) - start;
      if (delay >= 0 && delay <= 2000)
        return {
          ttfa_ms: null,
          barge_in_ms: delay,
          yield_ms: duck !== null ? duck - start : null,
        };
    }
    // The bot can answer inside the mic's 300 ms end debounce. Its retained onset still counts.
    const response =
      this.speechEnd === null
        ? undefined
        : this.botPeriods.find((period) => period.start >= (this.speechEnd as number));
    if (response && this.speechEnd !== null) {
      const delay = response.start - this.speechEnd;
      this.speechEnd = null;
      if (delay <= 10000) return { ttfa_ms: delay, barge_in_ms: null, yield_ms: null };
    }
    return null;
  }
}

/** Nearest rank; p is a percentage, e.g. 50 or 90. Does not reorder the caller's history. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.min(ordered.length, Math.ceil((p / 100) * ordered.length)));
  return ordered[rank - 1] ?? null;
}

export function startLatencySampler(o: {
  mic: Pick<Mic, 'sentLevel'>;
  audio: Pick<TutorAudio, 'level'>;
  meter: LatencyMeter;
  onMetrics(m: Measurement): void;
  intervalMs?: number;
  now?: () => number;
}): () => void {
  const now = o.now ?? (() => performance.now());
  const timer = setInterval(() => {
    const metrics = o.meter.sample(now(), o.mic.sentLevel(), o.audio.level());
    if (metrics) o.onMetrics(metrics);
  }, o.intervalMs ?? 20);
  return () => clearInterval(timer);
}
