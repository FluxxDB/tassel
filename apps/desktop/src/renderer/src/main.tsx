// The renderer's entry: read the launch config through the bridge, set up i18n and the API
// client, then render the app.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './app/App';
import { initI18n } from './i18n';
import { apiClientFromBridge } from './lib/api';
import { setPaperConfig } from './paper/paper-config';
import { createTutorClient } from './tutor/create-client';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

async function boot(container: HTMLElement): Promise<void> {
  const [config, paperConfig] = await Promise.all([
    window.tassel.getConfig(),
    window.tassel.paper.getConfig(),
  ]);
  // Before the first render, so render-time code (the new session sheet, the paper panel) reads
  // the paper config synchronously.
  setPaperConfig(paperConfig);
  const i18n = await initI18n(config.uiLanguage);
  const api = apiClientFromBridge(config.serverUrl);
  createRoot(container).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App
          api={api}
          tokenReset={config.tokenReset}
          createTutor={() => createTutorClient(config)}
        />
      </I18nextProvider>
    </StrictMode>,
  );
}

boot(root).catch((error: unknown) => {
  console.error('[tassel] The renderer failed to start:', error);
});
