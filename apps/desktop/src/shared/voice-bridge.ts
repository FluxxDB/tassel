/** Voice-only IPC: no provider settings or secrets cross this bridge. */
export type MicAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
export interface VoiceConfig {
  devTools: boolean;
  fakeMic: boolean;
  devConsole: boolean;
  canOpenMicSettings: boolean;
}
export interface VoiceBridge {
  getConfig(): Promise<VoiceConfig>;
  micAccess(): Promise<MicAccess>;
  askMicAccess(): Promise<MicAccess>;
  openMicSettings(): Promise<void>;
}
export const VOICE_IPC = {
  getConfig: 'voice:getConfig',
  micAccess: 'voice:micAccess',
  askMicAccess: 'voice:askMicAccess',
  openMicSettings: 'voice:openMicSettings',
} as const;
