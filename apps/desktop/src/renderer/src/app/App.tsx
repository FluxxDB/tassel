// The app shell: the API client in context, and the screen for the current route.
import type { ApiClient } from '@tassel/shared/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { LibraryScreen } from '../features/library/LibraryScreen';
import { ApiProvider } from '../lib/api';
import { AppFrame } from './AppFrame';
import { useRoute } from './route-store';

export interface AppProps {
  api: ApiClient;
  /** AppConfig.tokenReset: this launch started a fresh library, which the library says once. */
  tokenReset?: boolean;
}

export function App({ api, tokenReset = false }: AppProps) {
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
          <SessionHome />
        )}
      </div>
    </ApiProvider>
  );
}

// The session screen arrives in Task 13; this holds its place.
function SessionHome() {
  const { t } = useTranslation();
  const goLibrary = useRoute((state) => state.goLibrary);
  return (
    <>
      <AppFrame>
        <Button variant="ghost" size="sm" onClick={goLibrary}>
          {t('common.back')}
        </Button>
      </AppFrame>
      <main className="px-8 pt-6">
        <h1 className="text-3xl font-w520">{t('session.untitled')}</h1>
      </main>
    </>
  );
}
