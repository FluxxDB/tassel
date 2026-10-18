import { app, ipcMain } from 'electron';
import { VOICE_IPC, type VoiceConfig } from '../../shared/voice-bridge';
import { isTrustedUrl } from '../windows';
import { type createMicAccess, micSettingsUrl } from './mic-access';
import { voiceSwitches } from './switches';

export function readVoiceConfig(
  env: NodeJS.ProcessEnv = process.env,
  packaged = app.isPackaged,
  platform: NodeJS.Platform = process.platform,
): VoiceConfig {
  return {
    devTools: !packaged,
    fakeMic: voiceSwitches(env, packaged).length > 0,
    canOpenMicSettings: micSettingsUrl(platform) !== null,
  };
}

export function registerVoiceIpc(deps: {
  access: ReturnType<typeof createMicAccess>;
  config: VoiceConfig;
}): void {
  const handlers = {
    [VOICE_IPC.getConfig]: () => deps.config,
    [VOICE_IPC.micAccess]: () => deps.access.status(),
    [VOICE_IPC.askMicAccess]: () => deps.access.ask(),
    [VOICE_IPC.openMicSettings]: () => deps.access.openSettings(),
  };
  for (const [channel, respond] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event) => {
      if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) {
        throw new Error(`Refused ${channel} from an untrusted sender`);
      }
      return respond();
    });
  }
}
