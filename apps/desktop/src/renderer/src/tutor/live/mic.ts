import type { MicStatus } from '../types';

export interface MicOptions {
  deviceId: string | null;
  processing: boolean;
}
export interface MicDeps {
  media: Pick<
    MediaDevices,
    'getUserMedia' | 'enumerateDevices' | 'addEventListener' | 'removeEventListener'
  >;
  createContext(): AudioContext;
}
export type MicChange =
  | { type: 'status'; status: MicStatus }
  | { type: 'device-lost'; deviceId: string };

/** Capture is connected only by open(); the WebRTC destination exists beforehand, in silence. */
export class Mic {
  private context: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private inputMeter: AnalyserNode | null = null;
  private outputMeter: AnalyserNode | null = null;
  private mute: GainNode | null = null;
  private gate: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: MediaStream | null = null;
  private enabled = true;
  private gateOpen = true;
  private options: MicOptions = { deviceId: null, processing: true };
  private revision = 0;
  private listening = false;
  private listeners = new Set<(e: MicChange) => void>();
  private _status: MicStatus = 'off';
  private _deviceId: string | null = null;
  private _openedAt: number | null = null;
  constructor(private readonly deps: MicDeps) {}
  get isEnabled() {
    return this.enabled;
  }
  get status() {
    return this._status;
  }
  get deviceId() {
    return this._deviceId;
  }
  get openedAt() {
    return this._openedAt;
  }

  sendTrack(): MediaStreamTrack {
    if (!this.context) {
      this.context = this.deps.createContext();
      this.inputMeter = this.context.createAnalyser();
      this.mute = this.context.createGain();
      this.gate = this.context.createGain();
      this.outputMeter = this.context.createAnalyser();
      this.inputMeter.connect(this.mute).connect(this.gate).connect(this.outputMeter);
      this.setEnabled(this.enabled);
      this.setGate(this.gateOpen);
    }
    if (!this.destination || this.destination.stream.getAudioTracks()[0]?.readyState === 'ended') {
      this.outputMeter?.disconnect();
      this.destination = this.context.createMediaStreamDestination();
      this.outputMeter?.connect(this.destination);
    }
    // A MediaStreamAudioDestinationNode always creates exactly one audio track.
    return this.destination.stream.getAudioTracks()[0] as MediaStreamTrack;
  }

  async open(opts: MicOptions): Promise<MicStatus> {
    this.options = { ...opts };
    const revision = ++this.revision;
    this.sendTrack();
    if (!this.listening) {
      this.deps.media.addEventListener('devicechange', this.deviceChanged);
      this.listening = true;
    }
    let id = opts.deviceId;
    for (;;) {
      let stream: MediaStream;
      try {
        stream = await this.deps.media.getUserMedia({
          audio: {
            deviceId: id ? { exact: id } : undefined,
            echoCancellation: opts.processing,
            noiseSuppression: opts.processing,
            autoGainControl: opts.processing,
            channelCount: 1,
          },
        });
      } catch (error) {
        if (revision !== this.revision) return this.status;
        const name =
          typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
        if (id && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
          id = null;
          continue;
        }
        this.stopCapture();
        return this.setStatus(name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
      if (revision !== this.revision) {
        for (const track of stream.getTracks()) track.stop();
        return this.status;
      }
      this.stopCapture();
      this.capture = stream;
      try {
        const context = this.context as AudioContext;
        this.source = context.createMediaStreamSource(stream);
        this.source.connect(this.inputMeter as AnalyserNode);
        await context.resume();
        if (revision !== this.revision) return this.status;
        this._deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? id;
        this.options.deviceId = id;
        this._openedAt = performance.now();
        return this.setStatus('live');
      } catch {
        if (revision !== this.revision) return this.status;
        this.stopCapture();
        return this.setStatus('unavailable');
      }
    }
  }
  setDevice(deviceId: string | null): Promise<MicStatus> {
    this.options.deviceId = deviceId;
    return this.status === 'off' ? Promise.resolve(this.status) : this.open(this.options);
  }
  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.mute) this.mute.gain.value = on ? 1 : 0;
  }
  setGate(open: boolean) {
    this.gateOpen = open;
    if (this.gate) this.gate.gain.value = open ? 1 : 0;
  }
  level() {
    return this.capture ? rms(this.inputMeter) : 0;
  }
  sentLevel() {
    return this.capture && this.enabled && this.gateOpen ? rms(this.outputMeter) : 0;
  }
  /** Device enumeration is shared with the transport adapter, without opening capture. */
  devices() {
    return this.deps.media.enumerateDevices();
  }
  on(listener: (e: MicChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  close() {
    ++this.revision;
    this.deps.media.removeEventListener('devicechange', this.deviceChanged);
    this.listening = false;
    this.stopCapture();
    for (const track of this.destination?.stream.getTracks() ?? []) track.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.destination = null;
    this.inputMeter = null;
    this.outputMeter = null;
    this.mute = null;
    this.gate = null;
    this.setStatus('off');
  }
  private stopCapture() {
    this.source?.disconnect();
    this.source = null;
    for (const track of this.capture?.getTracks() ?? []) track.stop();
    this.capture = null;
    this._deviceId = null;
    this._openedAt = null;
  }
  private setStatus(status: MicStatus) {
    this._status = status;
    for (const listener of this.listeners) listener({ type: 'status', status });
    return status;
  }
  private deviceChanged = async () => {
    const id = this.deviceId;
    const revision = this.revision;
    if (!id || this.status !== 'live') return;
    try {
      const devices = await this.devices();
      if (
        revision !== this.revision ||
        devices.some((d) => d.kind === 'audioinput' && d.deviceId === id)
      )
        return;
      await this.open({ ...this.options, deviceId: null });
      for (const listener of this.listeners) listener({ type: 'device-lost', deviceId: id });
    } catch {
      /* Enumeration can be denied independently of an existing stream. */
    }
  };
}

export function rms(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  return Math.min(
    1,
    Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length),
  );
}
