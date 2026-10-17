// The learner's sessions for one sort and search, from the server.
import { listSessions, type Session, type SessionSort } from '@tassel/shared/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../lib/api';

export const SEARCH_DEBOUNCE_MS = 250;

export interface SessionsState {
  status: 'loading' | 'error' | 'ready';
  items: Session[];
  /**
   * Why the last request failed. Anything can land here: an ApiError, an UnauthorizedError, or
   * the bridge's own error when the device couldn't register with the server at all.
   */
  error?: unknown;
  /**
   * The trimmed search that `items` answer ('' for none). It trails the typed text until the
   * results for it arrive, which tells "no matches" apart from an empty library.
   */
  query: string;
  refetch(): void;
}

/**
 * Loads the sessions for `sort` and the search text `q`, which waits for a 250 ms pause in
 * typing (clearing it applies at once). A newer request always wins over an older one. While a
 * new sort or search loads, the last results stay up; after a failure, a new request shows
 * 'loading' again.
 */
export function useSessions(sort: SessionSort, q: string): SessionsState {
  const api = useApi();
  const search = useSettledSearch(q.trim());
  const [state, setState] = useState<Omit<SessionsState, 'refetch'>>({
    status: 'loading',
    items: [],
    query: search,
  });
  const latest = useRef(0);

  const load = useCallback(
    (forSort: SessionSort, forSearch: string) => {
      const request = ++latest.current;
      setState((previous) =>
        previous.status === 'error' ? { status: 'loading', items: [], query: forSearch } : previous,
      );
      listSessions(api, forSort, forSearch || undefined).then(
        (items) => {
          if (request === latest.current) setState({ status: 'ready', items, query: forSearch });
        },
        (error: unknown) => {
          if (request === latest.current) {
            setState({ status: 'error', items: [], error, query: forSearch });
          }
        },
      );
    },
    [api],
  );

  useEffect(() => load(sort, search), [load, sort, search]);
  // Nothing lands after unmount.
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  const refetch = useCallback(() => load(sort, search), [load, sort, search]);
  return { ...state, refetch };
}

/** The search text once typing pauses for SEARCH_DEBOUNCE_MS; an emptied search applies at once. */
function useSettledSearch(text: string): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (text === '') {
      setSettled('');
      return;
    }
    const timer = setTimeout(() => setSettled(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return settled;
}
