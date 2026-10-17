// The app shell: the API client in context, and the screen for the current route.
import type { ApiClient } from '@tassel/shared/api';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Wordmark } from '../components/Wordmark';
import { ApiProvider } from '../lib/api';
import { AppFrame } from './AppFrame';
import { useRoute } from './route-store';

export function App({ api }: { api: ApiClient }) {
  const route = useRoute((state) => state.route);
  return (
    <ApiProvider client={api}>
      <div className="flex h-full flex-col">
        {route.name === 'library' ? <LibraryHome /> : <SessionHome />}
      </div>
    </ApiProvider>
  );
}

// The library and the session screen arrive in Tasks 11 and 13; these hold their places.
function LibraryHome() {
  const { t } = useTranslation();
  return (
    <>
      <AppFrame>
        <Wordmark />
      </AppFrame>
      <main className="px-8 pt-6">
        <h1 className="text-3xl font-w520">{t('library.title')}</h1>
      </main>
    </>
  );
}

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
