import type { ClientMetrics, RouteEvent, TurnMetrics } from '@tassel/shared/voice';
import { create } from 'zustand';
import type { VoiceDebugEvent } from '../../tutor/types';

interface VoiceDebug {
  route: RouteEvent | null;
  turns: TurnMetrics[];
  client: ClientMetrics[];
  backchannels: number;
  connections: number;
  micOpenedAt: number | null;
  push(e: VoiceDebugEvent): void;
  setMicOpenedAt(t: number | null): void;
  reset(): void;
}
const initial = {
  route: null,
  turns: [],
  client: [],
  backchannels: 0,
  connections: 0,
  micOpenedAt: null,
};
export const useVoiceDebug = create<VoiceDebug>()((set) => ({
  ...initial,
  push: (e) =>
    set((s) => {
      switch (e.kind) {
        case 'route':
          return { route: e, connections: s.connections + 1 };
        case 'turn-metrics':
          return { turns: [...s.turns.slice(-199), e.metrics] };
        case 'client-metrics':
          return { client: [...s.client.slice(-199), e] };
        case 'backchannel':
          return { backchannels: s.backchannels + 1 };
      }
    }),
  setMicOpenedAt: (micOpenedAt) => set({ micOpenedAt }),
  reset: () => set(initial),
}));
