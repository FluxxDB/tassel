// The app shell: the API client in context, and the screen for the current route.
import type { ApiClient } from '@tassel/shared/api';
import { useState } from 'react';
import { LibraryScreen } from '../features/library/LibraryScreen';
import { SessionScreen } from '../features/session/SessionScreen';
import { ApiProvider } from '../lib/api';
import type { TutorClient } from '../tutor/types';
import { useRoute } from './route-store';

export interface AppProps {
  api: ApiClient;
  /** AppConfig.tokenReset: this launch started a fresh library, which the library says once. */
  tokenReset?: boolean;
  /** Makes a session's tutor; see SessionScreen. */
  createTutor?: () => TutorClient;
}

export function App({ api, tokenReset = false, createTutor }: AppProps) {
  const route = useRoute((state) => state.route);
  // Here rather than in the library, so the notice stays dismissed across visits to a session.
  const [tokenNotice, setTokenNotice] = useState(tokenReset);
  return (
    <ApiProvider client={api}>
      <div className="flex h-full flex-col">
        {route.name === 'library' ? (
          <LibraryScreen
            tokenNotice={tokenNotice}
            onDismissTokenNotice={() => setTokenNotice(false)}
          />
        ) : (
          // Keyed by session, so another session gets a fresh screen and timer.
          <SessionScreen
            key={route.sessionId}
            sessionId={route.sessionId}
            createTutor={createTutor}
          />
        )}
      </div>
    </ApiProvider>
  );
}
