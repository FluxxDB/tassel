import { rms } from './mic';

export interface Sinks {
  primary: string | null;
  presenter: string | null;
}
export interface TutorAudioDeps {
  createAudio(): HTMLAudioElement;
  createContext(opts?: { sinkId?: string }): AudioContext;
}
type SinkResult = { primary: 'ok' | 'fallback'; presenter: 'ok' | 'fallback' | 'off' };

/** The media element must keep playing for Chromium to deliver remote WebRTC audio to Web Audio. */
export class TutorAudio {
  readonly element: HTMLAudioElement;
  private stream: MediaStream | null = null;
  private meterContext: AudioContext | null = null;
  private meterSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private presenterContext: AudioContext | null = null;
  private presenterSource: MediaStreamAudioSourceNode | null = null;
  private presenterGain: GainNode | null = null;
  private presenterId: string | null = null;
  private ducked = false;
  private disposed = false;
  private sinkQueue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(on: boolean, atMs: number) => void>();
  constructor(private readonly deps: TutorAudioDeps) {
    this.element = deps.createAudio();
    this.element.hidden = true;
    this.element.autoplay = true;
    this.element.dataset.testid = 'tutor-audio';
    this.element.dataset.presenterSink = '';
    document.body.append(this.element);
  }
  get presenterSinkId() {
    return this.presenterId;
  }
  attach(track: MediaStreamTrack) {
    if (this.disposed) return;
    this.stream = new MediaStream([track]);
    this.element.srcObject = this.stream;
    // Autoplay can be denied until a user gesture. Keep the element available for an explicit play.
    void this.element.play().catch(() => {
      this.element.dataset.playbackBlocked = 'true';
    });
    if (!this.meterContext) {
      this.meterContext = this.deps.createContext();
      this.analyser = this.meterContext.createAnalyser();
      // Analyser output is deliberately unconnected: only the element plays the primary output.
    }
    this.meterSource?.disconnect();
    this.meterSource = this.meterContext.createMediaStreamSource(this.stream);
    this.meterSource.connect(this.analyser as AnalyserNode);
    void this.meterContext.resume().catch(() => {});
    this.attachPresenter();
  }
  setSinks(sinks: Sinks): Promise<SinkResult> {
    // Serialize asynchronous setSinkId calls so a stale selection cannot win a newer one.
    const result = this.sinkQueue.then(() => this.applySinks(sinks));
    this.sinkQueue = result.catch(() => {});
    return result;
  }
  private async applySinks(sinks: Sinks): Promise<SinkResult> {
    if (this.disposed) return { primary: 'fallback', presenter: 'off' };
    let primaryId = normalizeSink(sinks.primary);
    let primary: SinkResult['primary'] = 'ok';
    try {
      await this.element.setSinkId(primaryId);
    } catch {
      primaryId = '';
      primary = 'fallback';
      await this.element.setSinkId('');
    }
    if (this.disposed) return { primary, presenter: 'off' };
    const presenter = sinks.presenter === null ? null : normalizeSink(sinks.presenter);
    if (presenter === null || presenter === primaryId) {
      this.closePresenter();
      return { primary, presenter: 'off' };
    }
    if (this.presenterId === sinks.presenter && this.presenterContext)
      return { primary, presenter: 'ok' };
    this.closePresenter();
    try {
      this.presenterContext = this.deps.createContext({ sinkId: presenter });
      this.presenterGain = this.presenterContext.createGain();
      this.presenterGain.gain.value = this.ducked ? 0.25 : 1;
      this.presenterGain.connect(this.presenterContext.destination);
      await this.presenterContext.resume();
      if (this.disposed) {
        this.closePresenter();
        return { primary, presenter: 'off' };
      }
      this.presenterId = sinks.presenter;
      this.element.dataset.presenterSink = sinks.presenter ?? '';
      this.attachPresenter();
      return { primary, presenter: 'ok' };
    } catch {
      // Do not mirror into the default sink: it could double the primary at full volume.
      this.closePresenter();
      return { primary, presenter: 'fallback' };
    }
  }
  duck(on: boolean) {
    if (this.disposed || on === this.ducked) return;
    this.ducked = on;
    const value = on ? 0.25 : 1;
    this.element.volume = value;
    if (this.presenterGain && this.presenterContext) {
      const gain = this.presenterGain.gain;
      const now = this.presenterContext.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(value, now + 0.06);
    }
    const atMs = performance.now();
    for (const listener of this.listeners) listener(on, atMs);
  }
  onDuck(listener: (on: boolean, atMs: number) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  level() {
    return this.disposed ? 0 : rms(this.analyser);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.element.pause();
    this.element.srcObject = null;
    this.element.remove();
    this.meterSource?.disconnect();
    this.analyser?.disconnect();
    void this.meterContext?.close().catch(() => {});
    this.meterContext = null;
    this.meterSource = null;
    this.analyser = null;
    this.stream = null;
    this.closePresenter();
    this.listeners.clear();
  }
  private attachPresenter() {
    this.presenterSource?.disconnect();
    this.presenterSource = null;
    if (!this.stream || !this.presenterContext || !this.presenterGain) return;
    this.presenterSource = this.presenterContext.createMediaStreamSource(this.stream);
    this.presenterSource.connect(this.presenterGain);
  }
  private closePresenter() {
    this.presenterSource?.disconnect();
    this.presenterGain?.disconnect();
    void this.presenterContext?.close().catch(() => {});
    this.presenterContext = null;
    this.presenterSource = null;
    this.presenterGain = null;
    this.presenterId = null;
    this.element.dataset.presenterSink = '';
  }
}
function normalizeSink(id: string | null) {
  return id === null || id === 'default' ? '' : id;
}
