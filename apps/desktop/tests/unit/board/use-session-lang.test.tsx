// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import { act, renderHook } from '@testing-library/react';
import type { i18n as I18n } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionLang } from '../../../src/renderer/src/board/use-session-lang';
import {
  forgetCurrentSession,
  useCurrentSession,
} from '../../../src/renderer/src/features/session/current-session';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';

// A Korean session.
const SESSION: Session = {
  id: '9d4e2b1a-7c3f-4a5b-8e6d-0f1a2b3c4d5e',
  title: null,
  title_source: null,
  subject: null,
  type: 'studying',
  language: 'ko',
  source: 'paper',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};

function renderLang(i18n: I18n) {
  const GET = vi.fn(async () => ({ data: SESSION, response: new Response(null) }));
  const api = { GET } as unknown as ApiClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>{children}</ApiProvider>
    </I18nextProvider>
  );
  return renderHook(() => ({ session: useCurrentSession(), lang: useSessionLang() }), { wrapper });
}

afterEach(() => forgetCurrentSession());

describe('useSessionLang', () => {
  it('is the UI language until the session loads', async () => {
    const { result } = renderLang(await initI18n('es'));
    expect(result.current.lang).toBe('es');
  });

  it("is the open session's language once it loads, whatever the UI's", async () => {
    const { result } = renderLang(await initI18n('en'));
    await act(() => result.current.session.load(SESSION.id));
    expect(result.current.lang).toBe('ko');
  });

  it('falls back to English for a UI language Tassel does not have', async () => {
    const i18n = await initI18n('en');
    await i18n.changeLanguage('fr');
    const { result } = renderLang(i18n);
    expect(result.current.lang).toBe('en');
  });
});
