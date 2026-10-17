import type { ClientMetrics } from '@tassel/shared/voice';
import type { Mic } from './mic';
import type { TutorAudio } from './tutor-audio';

type Metrics = Omit<ClientMetrics, 'sensitivity'>;
export interface MeterThresholds {
  micOn: number;
  micOff: number;
  botOn: number;
  botOff: number;
  micOnMs: number;
  micOffMs: number;
  botOffMs: number;
}
export class LatencyMeter {
  private t: MeterThresholds;
  private mic = false;
  private bot = false;
  private micStart: number | null = null;
  private micEnd: number | null = null;
  private botEnd: number | null = null;
  private awaitingAudio: number | null = null;
  private barge: number | null = null;
  private duck: number | null = null;
  constructor(t: Partial<MeterThresholds> = {}) {
    this.t = {
      micOn: 0.02,
      micOff: 0.01,
      botOn: 0.01,
      botOff: 0.005,
      micOnMs: 40,
      micOffMs: 300,
      botOffMs: 60,
      ...t,
    };
  }
  markDuck(atMs: number) {
    this.duck = atMs;
  }
  sample(at: number, micRms: number, botRms: number): Metrics | null {
    let result: Metrics | null = null;
    if (this.barge !== null && at - this.barge > 2000) this.barge = null;
    if (this.awaitingAudio !== null && at - this.awaitingAudio > 10000) this.awaitingAudio = null;
    if (!this.mic) {
      if (micRms >= this.t.micOn) {
        this.micStart ??= at;
        if (at - this.micStart >= this.t.micOnMs) {
          this.mic = true;
          this.awaitingAudio = null;
          if (this.bot) {
            this.barge = this.micStart;
            if (this.duck !== null && this.duck < this.barge) this.duck = null;
          }
        }
      } else this.micStart = null;
    } else if (micRms < this.t.micOff) {
      this.micEnd ??= at;
      if (at - this.micEnd >= this.t.micOffMs) {
        this.mic = false;
        this.micStart = null;
        if (!this.bot) this.awaitingAudio = this.micEnd;
        this.micEnd = null;
      }
    } else this.micEnd = null;
    if (!this.bot && botRms >= this.t.botOn) {
      this.bot = true;
      if (this.awaitingAudio !== null) {
        result = { ttfa_ms: at - this.awaitingAudio, barge_in_ms: null, yield_ms: null };
        this.awaitingAudio = null;
      }
    } else if (this.bot && botRms < this.t.botOff) {
      this.botEnd ??= at;
      if (at - this.botEnd >= this.t.botOffMs) {
        this.bot = false;
        if (this.barge !== null) {
          result = {
            ttfa_ms: null,
            barge_in_ms: Math.max(0, this.botEnd - this.barge),
            yield_ms: this.duck === null ? null : Math.max(0, this.duck - this.barge),
          };
          this.barge = null;
          this.duck = null;
        }
        this.botEnd = null;
      }
    } else this.botEnd = null;
    return result;
  }
}
export function startLatencySampler(o: {
  mic: Pick<Mic, 'sentLevel'>;
  audio: Pick<TutorAudio, 'level'>;
  meter: LatencyMeter;
  onMetrics(m: Metrics): void;
  intervalMs?: number;
  now?: () => number;
}): () => void {
  const timer = setInterval(() => {
    const result = o.meter.sample(
      o.now?.() ?? performance.now(),
      o.mic.sentLevel(),
      o.audio.level(),
    );
    if (result) o.onMetrics(result);
  }, o.intervalMs ?? 20);
  return () => clearInterval(timer);
}
