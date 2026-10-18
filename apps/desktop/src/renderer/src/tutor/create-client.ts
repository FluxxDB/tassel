// Live by default; the script is selected only by the explicit fake launch flag.
import type { ApiClient } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { ICE_SERVERS_PATH, type OfferRequestData } from '@tassel/shared/voice';
import type { AppConfig, TasselBridge } from '../../../shared/bridge';
import { fixtureSource, registerSnapshotSource } from '../board/marks/snapshot-sources';
import { compileScript } from '../board/script/compile';
import type { AuthoredScript } from '../board/script/types';
import type { VoiceSessionResources } from '../features/voice/use-voice-session';
import { FakeTutorClient } from './fake-client';
import { LiveTutorClient } from './live/live-client';
import type { MicOptions } from './live/mic';
import { VoiceConnectionError } from './live/voice-error';
import boardDemo from './scripts/board-demo.json';
import dfaOpening from './scripts/dfa-opening.json';
import diagramDemo from './scripts/diagram-demo.json';
import marksDemo from './scripts/marks-demo.json';
import type { FakeScript, TutorClient } from './types';

/**
 * The fake tutor's scripts, by their TASSEL_FAKE_SCRIPT name: FakeScripts, and authored scripts
 * that compile into one (P5), so Ada's beats keep time with her words.
 */
export const SCRIPTS: Record<string, AuthoredScript | FakeScript> = {
  'dfa-opening': dfaOpening as FakeScript,
  // P5: Ada's board (Task 5) and her marks on the paper (Tasks 7 and 8).
  'board-demo': boardDemo as FakeScript,
  'marks-demo': marksDemo as AuthoredScript,
  // A network on the board (board.diagram): three zones behind their routers, and a note.
  'diagram-demo': diagramDemo as FakeScript,
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
  const script = Object.hasOwn(SCRIPTS, cfg.fakeScript) ? SCRIPTS[cfg.fakeScript] : undefined;
  if (!script) throw new Error(`Unknown fake tutor script "${cfg.fakeScript}"`);
  // Compiled when it's chosen, so a script with a mistake fails only its own session.
  const Client = cfg.fakeScript === 'marks-demo' ? FixtureMarksTutor : FakeTutorClient;
  return new Client(compileScript(script, cfg.fakeScript), {
    speed: cfg.fakeSpeed,
    lang: cfg.uiLanguage,
  });
}

/** Only the explicit synthetic marks test script may load the fixture in a built app. */
class FixtureMarksTutor extends FakeTutorClient {
  private unregister?: () => void;

  override async connect(sessionId: string): Promise<void> {
    this.unregister?.();
    this.unregister = registerSnapshotSource('fixture', fixtureSource);
    await super.connect(sessionId);
  }

  override async disconnect(): Promise<void> {
    this.unregister?.();
    this.unregister = undefined;
    await super.disconnect();
  }
}
