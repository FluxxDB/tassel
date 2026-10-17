// Live by default; the script is selected only by the explicit fake launch flag.
import type { ApiClient } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { ICE_SERVERS_PATH, type OfferRequestData } from '@tassel/shared/voice';
import type { AppConfig, TasselBridge } from '../../../shared/bridge';
import type { VoiceSessionResources } from '../features/voice/use-voice-session';
import { FakeTutorClient } from './fake-client';
import { LiveTutorClient } from './live/live-client';
import type { MicOptions } from './live/mic';
import { VoiceConnectionError } from './live/voice-error';
import dfaOpening from './scripts/dfa-opening.json';
import type { FakeScript, TutorClient } from './types';

/** The fake tutor's scripts, by their TASSEL_FAKE_SCRIPT name. */
const SCRIPTS: Record<string, FakeScript> = {
  'dfa-opening': dfaOpening as FakeScript,
};

export interface LiveDeps {
  api: ApiClient;
  bridge: Pick<TasselBridge, 'getToken'>;
  voice: VoiceSessionResources;
  micOptions(): MicOptions;
  offerData(): OfferRequestData;
  lang(): Lang;
}

// Task 8's generated route has not landed. Keep the temporary REST signature at
// this one boundary, using the SAME authenticated API client (including 401 refresh).
// Replace this signature with the generated GET overload after Team S merges.
type VoiceApi = {
  GET(path: typeof ICE_SERVERS_PATH): Promise<{
    data?: {
      ice_servers: Array<{
        urls: string | string[];
        username?: string | null;
        credential?: string | null;
      }>;
    };
    response: Response;
  }>;
};

export function createTutorClient(cfg: AppConfig, deps?: LiveDeps): TutorClient {
  if (cfg.tutorMode !== 'fake') {
    if (!deps) throw new Error('Live tutor requires deps');
    return new LiveTutorClient({
      serverUrl: cfg.serverUrl,
      getToken: () => deps.bridge.getToken(),
      getIceServers: async () => {
        const { data, response } = await (deps.api as unknown as VoiceApi).GET(ICE_SERVERS_PATH);
        if (!response.ok || !data) {
          throw new VoiceConnectionError(
            response.status === 404 || response.status === 503 ? 'not-configured' : 'unreachable',
          );
        }
        return data.ice_servers.map(({ urls, username, credential }) => ({
          urls,
          ...(username != null && { username }),
          ...(credential != null && { credential }),
        }));
      },
      mic: deps.voice.mic,
      audio: deps.voice.audio,
      micOptions: deps.micOptions,
      offerData: deps.offerData,
      lang: deps.lang,
    });
  }
  const script = SCRIPTS[cfg.fakeScript];
  if (!script) throw new Error(`Unknown fake tutor script "${cfg.fakeScript}"`);
  return new FakeTutorClient(script, { speed: cfg.fakeSpeed, lang: cfg.uiLanguage });
}
