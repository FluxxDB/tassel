import type { Lang } from '@tassel/shared/i18n';
import type { ClientMetrics, RouteEvent, TurnMetrics } from '@tassel/shared/voice';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { VoiceDebugEvent } from '../../tutor/types';

interface VoiceDebug {
  route: RouteEvent | null;
  turns: TurnMetrics[];
  client: ClientMetrics[];
  backchannels: number;
  connections: number;
  micOpenedAt: number | null;
  /** Preserve event order and language: client metrics have no turn ID in the wire contract. */
  firstAudio: { ms: number | null; source: 'client' | 'server'; lang: Lang } | null;
  push(e: VoiceDebugEvent): void;
  setMicOpenedAt(t: number | null): void;
  reset(): void;
}
const initial = () => ({
  route: null,
  turns: [],
  client: [],
  backchannels: 0,
  connections: 0,
  micOpenedAt: null,
  firstAudio: null,
});
/** Session-only debug data. Never persist transcripts, timing histories or device timestamps. */
export const useVoiceDebug: UseBoundStore<StoreApi<VoiceDebug>> = create<VoiceDebug>()((set) => ({
  ...initial(),
  push: (e) =>
    set((state) => {
      switch (e.kind) {
        case 'route':
          return { route: e, connections: state.connections + 1 };
        case 'backchannel':
          return { backchannels: state.backchannels + 1 };
        case 'turn-metrics':
          return {
            turns: [...state.turns, e.metrics],
            ...(e.metrics.input === 'typed'
              ? {
                  firstAudio: {
                    ms: e.metrics.server_ttfa_ms,
                    source: 'server' as const,
                    lang: e.metrics.lang,
                  },
                }
              : {}),
          };
        case 'client-metrics': {
          const { kind: _, ...metrics } = e;
          return {
            client: [...state.client, metrics],
            ...(e.ttfa_ms !== null
              ? {
                  firstAudio: {
                    ms: e.ttfa_ms,
                    source: 'client' as const,
                    lang: state.route?.lang ?? 'en',
                  },
                }
              : {}),
          };
        }
      }
    }),
  setMicOpenedAt: (micOpenedAt) => set({ micOpenedAt }),
  reset: () => set(initial()),
}));
