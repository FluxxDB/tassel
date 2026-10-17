import { app, type SystemPreferences } from 'electron';
import type { MicAccess } from '../../shared/voice-bridge';
import { voiceSwitches } from './switches';

export function micSettingsUrl(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin')
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
  if (platform === 'win32') return 'ms-settings:privacy-microphone';
  return null;
}

type FakeAccess = 'granted' | 'denied' | 'not-determined';
export function createMicAccess(deps: {
  platform: NodeJS.Platform;
  prefs: Pick<SystemPreferences, 'getMediaAccessStatus' | 'askForMediaAccess'>;
  fake?: FakeAccess;
  open(url: string): Promise<void>;
}): { status(): MicAccess; ask(): Promise<MicAccess>; openSettings(): Promise<void> } {
  const fake = app.isPackaged ? undefined : (deps.fake ?? fakeAccess(process.env));
  const status = (): MicAccess => {
    if (fake) return fake;
    if (deps.platform !== 'darwin' && deps.platform !== 'win32') return 'unknown';
    return deps.prefs.getMediaAccessStatus('microphone');
  };
  return {
    status,
    async ask() {
      if (fake) return fake;
      if (deps.platform !== 'darwin') return status();
      return (await deps.prefs.askForMediaAccess('microphone')) ? 'granted' : 'denied';
    },
    async openSettings() {
      const url = micSettingsUrl(deps.platform);
      if (url) await deps.open(url);
    },
  };
}

function fakeAccess(env: NodeJS.ProcessEnv): FakeAccess | undefined {
  const override = env.TASSEL_FAKE_MIC_ACCESS;
  if (override === 'granted' || override === 'denied' || override === 'not-determined')
    return override;
  return voiceSwitches(env, false).length ? 'granted' : undefined;
}
