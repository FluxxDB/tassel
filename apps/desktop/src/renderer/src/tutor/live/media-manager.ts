import type { MediaSupport, PipecatClientOptions, Tracks } from '@pipecat-ai/client-js';
import type { Mic } from './mic';

/** Public shape from transport-lib's mediaManager.ts, bundled in SmallWebRTC 1.11.0. */
export interface MediaManagerShape {
  setUserAudioCallback(callback: (data: ArrayBuffer) => void): void;
  setClientOptions(options: PipecatClientOptions, override?: boolean): void;
  initialize(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  interruptBotAudio(): Promise<unknown>;
  bufferBotAudio(data: ArrayBuffer | Int16Array, id?: string): Int16Array | undefined;
  getAllMics(): Promise<MediaDeviceInfo[]>;
  getAllCams(): Promise<MediaDeviceInfo[]>;
  getAllSpeakers(): Promise<MediaDeviceInfo[]>;
  updateMic(id: string): void;
  updateCam(id: string): void;
  updateSpeaker(id: string): void;
  readonly selectedMic: MediaDeviceInfo | Record<string, never>;
  readonly selectedCam: MediaDeviceInfo | Record<string, never>;
  readonly selectedSpeaker: MediaDeviceInfo | Record<string, never>;
  enableMic(enable: boolean): void;
  enableCam(enable: boolean): void;
  enableScreenShare(enable: boolean): void;
  readonly isCamEnabled: boolean;
  readonly isMicEnabled: boolean;
  readonly isSharingScreen: boolean;
  readonly supportsScreenShare: boolean;
  readonly mediaSupport: MediaSupport;
  tracks(): Tracks;
}
export interface TutorAudioLike {
  setSinks(s: { primary: string | null; presenter: string | null }): Promise<unknown>;
  readonly presenterSinkId: string | null;
  interrupt?(on: boolean): void;
}
export class TasselMediaManager implements MediaManagerShape {
  private options: PipecatClientOptions | null = null;
  private devices: MediaDeviceInfo[] = [];
  private speakerId: string | null = null;
  constructor(
    private readonly mic: Mic,
    private readonly audio: TutorAudioLike,
  ) {}
  setClientOptions(options: PipecatClientOptions, override = false) {
    if (this.options && !override) return;
    this.options = options;
    // SDK enableMic=true establishes capability; it must not undo the caller's mute on reconnect.
    if (override || options.enableMic === false) this.enableMic(options.enableMic ?? true);
  }
  // SmallWebRTC sends tracks, not PCM; these three hooks are unused by that transport.
  setUserAudioCallback(_callback: (data: ArrayBuffer) => void) {}
  async interruptBotAudio() {
    this.audio.interrupt?.(true);
  }
  bufferBotAudio(_data: ArrayBuffer | Int16Array, _id?: string) {
    return undefined;
  }
  async initialize() {
    this.mic.sendTrack();
  }
  async connect() {
    this.mic.sendTrack();
  }
  // The caller owns Mic and TutorAudio; transport.stop() stops only the outbound track.
  async disconnect() {}
  tracks(): Tracks {
    return { local: { audio: this.mic.sendTrack() } };
  }
  async getAllMics() {
    this.devices = await this.mic.devices();
    return this.devices.filter((d) => d.kind === 'audioinput');
  }
  async getAllCams() {
    return [];
  }
  async getAllSpeakers() {
    this.devices = await this.mic.devices();
    return this.devices.filter((d) => d.kind === 'audiooutput');
  }
  async updateMic(id: string) {
    await this.mic.setDevice(id || null);
    await this.getAllMics();
    const selected = this.selectedMic;
    if (selected.deviceId) this.options?.callbacks?.onMicUpdated?.(selected as MediaDeviceInfo);
  }
  updateCam(_id: string) {}
  async updateSpeaker(id: string) {
    const result = await this.audio.setSinks({
      primary: id || null,
      presenter: this.audio.presenterSinkId,
    });
    this.speakerId =
      typeof result === 'object' &&
      result !== null &&
      'primary' in result &&
      result.primary === 'fallback'
        ? null
        : id;
  }
  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    return (
      this.devices.find((d) => d.kind === 'audioinput' && d.deviceId === this.mic.deviceId) ?? {}
    );
  }
  get selectedCam() {
    return {};
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return (
      this.devices.find(
        (d) => d.kind === 'audiooutput' && d.deviceId === (this.speakerId ?? 'default'),
      ) ?? {}
    );
  }
  enableMic(enable: boolean) {
    this.mic.setEnabled(enable);
  }
  enableCam(_enable: boolean) {}
  enableScreenShare(_enable: boolean) {}
  get isMicEnabled() {
    return this.mic.isEnabled;
  }
  get isCamEnabled() {
    return false;
  }
  get isSharingScreen() {
    return false;
  }
  get supportsScreenShare() {
    return false;
  }
  get mediaSupport() {
    return { mic: true, cam: false, screenShare: false };
  }
}
/**
 * P2-R3: the SDK's MediaManager class has protected members and its transport-lib type is not
 * exported by SmallWebRTC. It is nominally incompatible despite this complete public shape.
 * Keep the escape hatch here; the call site narrows unknown to the constructor's option type.
 */
export function asTransportMediaManager(manager: TasselMediaManager): unknown {
  return manager;
}
