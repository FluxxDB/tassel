// @vitest-environment jsdom
import type { ApiClient } from '@tassel/shared/api';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionScreen } from '../../../src/renderer/src/features/session/SessionScreen';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import type { TutorClient } from '../../../src/renderer/src/tutor/types';

const { useVoiceSession } = vi.hoisted(() => ({ useVoiceSession: vi.fn() }));
vi.mock('../../../src/renderer/src/features/voice/use-voice-session', () => ({ useVoiceSession }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it.each(['not-configured', 'unreachable'] as const)(
  'wires the live session and explains %s without a script',
  async (reason) => {
    vi.stubGlobal('tassel', { platform: 'darwin' });
    const client: TutorClient = {
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      on: () => () => {},
      sendText: vi.fn(),
    };
    useVoiceSession.mockReturnValue({ resources: null, client });
    const app = {
      serverUrl: 'http://localhost:8821',
      uiLanguage: 'en' as const,
      tutorMode: 'live' as const,
      fakeScript: 'dfa-opening',
      fakeSpeed: 1,
      tokenReset: false,
    };
    const config = { devTools: true, fakeMic: true, canOpenMicSettings: true };
    const api = {
      GET: vi.fn(async () => ({
        data: { id: 's', title: null, subject: null, language: 'ko', source: 'talk' },
        response: new Response(null),
      })),
    } as unknown as ApiClient;
    render(
      <I18nextProvider i18n={await initI18n('en')}>
        <ApiProvider client={api}>
          <SessionScreen sessionId="s" app={app} voiceConfig={config} />
        </ApiProvider>
      </I18nextProvider>,
    );
    await screen.findByRole('heading', { name: 'Untitled Session' });
    expect(useVoiceSession).toHaveBeenCalledWith({ sessionId: 's', lang: 'ko', app, config, api });
    expect(client.connect).toHaveBeenCalledWith('s');
    act(() => useStageStore.getState().setConnection('failed', reason));
    expect(screen.getByRole('status')).toHaveTextContent(
      reason === 'not-configured'
        ? 'Voice tutoring is not configured on the server.'
        : 'Cannot reach the voice server. Check your connection and try again.',
    );
    expect(useStageStore.getState().caption).toEqual({});
  },
);
