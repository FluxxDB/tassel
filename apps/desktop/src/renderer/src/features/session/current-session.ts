// The session the session screen shows (R4): loaded from the server, and patched locally when
// the tutor names it, so the title strip updates at once. No query cache, just this store.
import { getSession, type Session } from '@tassel/shared/api';
import { useCallback } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useApi } from '../../lib/api';

interface CurrentSessionState {
  session: Session | null;
  failed: boolean;
}

const store = create<CurrentSessionState>()(() => ({ session: null, failed: false }));
/** Counts loads, so only the newest one's answer lands. */
let loads = 0;

export interface CurrentSession {
  /** The open session, or null until it loads (or if it couldn't be loaded). */
  session: Session | null;
  /** True when the last load failed: the session is gone, or the server can't be reached. */
  failed: boolean;
  /** Loads session `id`, starting from nothing, so another session's details never show. */
  load(id: string): Promise<void>;
  /** Changes the open session here only, such as a title the tutor just gave it. */
  patchLocal(changes: Partial<Session>): void;
}

export function useCurrentSession(): CurrentSession {
  const api = useApi();
  const { session, failed } = store(useShallow(({ session, failed }) => ({ session, failed })));
  const load = useCallback(
    async (id: string) => {
      const request = ++loads;
      store.setState({ session: null, failed: false });
      try {
        const loaded = await getSession(api, id);
        if (request === loads) store.setState({ session: loaded });
      } catch {
        if (request === loads) store.setState({ failed: true });
      }
    },
    [api],
  );
  const patchLocal = useCallback((changes: Partial<Session>) => {
    store.setState((state) => (state.session ? { session: { ...state.session, ...changes } } : {}));
  }, []);
  return { session, failed, load, patchLocal };
}
