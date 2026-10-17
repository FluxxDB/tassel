// A test-only entry: exercises the real session registration, source, store and marks layer.
import type { BeatAction } from '@tassel/shared/beats';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { SessionScreen } from '../../../src/renderer/src/features/session/SessionScreen';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider, apiClientFromBridge } from '../../../src/renderer/src/lib/api';
import { FakeTutorClient } from '../../../src/renderer/src/tutor/fake-client';

export async function showPaper(serverUrl: string, sessionId: string, freeze: BeatAction) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:999;background:#fff';
  document.body.append(host);
  const i18n = await initI18n('en');
  createRoot(host).render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={apiClientFromBridge(serverUrl)}>
        <SessionScreen
          sessionId={sessionId}
          createTutor={() =>
            new FakeTutorClient({
              steps: [
                {
                  at: 0,
                  event: {
                    type: 'actions',
                    actions: [
                      freeze,
                      {
                        kind: 'paper.mark',
                        mark: { type: 'circle', id: 'real-paper', target: { el: 'm1' } },
                      },
                    ],
                  },
                },
              ],
            })
          }
        />
      </ApiProvider>
    </I18nextProvider>,
  );
}
