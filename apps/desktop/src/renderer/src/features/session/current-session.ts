// The session the session screen shows (R4): loaded from the server, and named locally when the
// tutor names it, so the title strip updates at once. No query cache, just this store.
import { getSession, type Session } from '@tassel/shared/api';
import { useCallback } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useApi } from '../../lib/api';

interface CurrentSessionState {
  session: Session | null;
  failed: boolean;
  /** Changes that arrived before the session loaded, such as an early title from the tutor. */
  pending: Partial<Session>;
}

const store = create<CurrentSessionState>()(() => ({ session: null, failed: false, pending: {} }));
/** Counts loads, so only the newest one's answer lands. */
let loads = 0;

/**
 * Forgets the open session, so the next session screen starts clean instead of rendering this
 * one's details until its own load runs. The session screen calls it when it goes away.
 */
export function forgetCurrentSession(): void {
  loads += 1;
  store.setState({ session: null, failed: false, pending: {} });
}

/** The open session as it is now, outside React: read when it's needed, never stale. */
export function currentSession(): Session | null {
  return store.getState().session;
}

export interface CurrentSession {
  /** The open session, or null until it loads (or if it couldn't be loaded). */
  session: Session | null;
  /** True when the last load failed: the session is gone, or the server can't be reached. */
  failed: boolean;
  /** Loads session `id`, starting from nothing, so another session's details never show. */
  load(id: string): Promise<void>;
  /**
   * Changes the open session here only. Changes made before the session loads are kept and
   * applied when it does.
   */
  patchLocal(changes: Partial<Session>): void;
  /**
   * Names the open session with the tutor's title and subject if it has no title yet, and says
   * whether it did. Her title replaces the placeholder (spec §5.1): a session with a title keeps
   * it, and one that hasn't loaded gets nothing.
   */
  nameIfUntitled(name: { title: string; subject: string | null }): boolean;
}

export function useCurrentSession(): CurrentSession {
  const api = useApi();
  const { session, failed } = store(useShallow(({ session, failed }) => ({ session, failed })));
  const load = useCallback(
    async (id: string) => {
      const request = ++loads;
      store.setState({ session: null, failed: false, pending: {} });
      try {
        const loaded = await getSession(api, id);
        if (request === loads) {
          store.setState(({ pending }) => ({ session: { ...loaded, ...pending }, pending: {} }));
        }
      } catch {
        if (request === loads) store.setState({ failed: true });
      }
    },
    [api],
  );
  const patchLocal = useCallback((changes: Partial<Session>) => {
    store.setState((state) =>
      state.session
        ? { session: { ...state.session, ...changes } }
        : { pending: { ...state.pending, ...changes } },
    );
  }, []);
  const nameIfUntitled = useCallback((name: { title: string; subject: string | null }) => {
    const { session } = store.getState();
    if (session === null || session.title !== null) return false;
    store.setState({ session: { ...session, ...name } });
    return true;
  }, []);
  return { session, failed, load, patchLocal, nameIfUntitled };
}
