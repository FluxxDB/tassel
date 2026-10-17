// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from '../../src/renderer/src/app/route-store';
import { defaultSource } from '../../src/renderer/src/features/new-session/defaults';
import { NewSessionSheet } from '../../src/renderer/src/features/new-session/NewSessionSheet';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';
import type { Platform } from '../../src/shared/bridge';

const CREATED: Session = {
  id: 'f6b8b0de-6f63-4a59-9c3e-0d6a1c0f2a11',
  title: null,
  title_source: null,
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'paper',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};

/** What openapi-fetch resolves to for a 201 from POST /v1/sessions. */
const created = (session: Session) => ({
  data: session,
  response: new Response(null, { status: 201 }),
});

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function renderSheet({
  lang = 'en',
  platform = 'darwin',
}: {
  lang?: Lang;
  platform?: Platform;
} = {}) {
  const i18n = await initI18n(lang);
  const POST = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={{ POST } as unknown as ApiClient}>
        <NewSessionSheet open onOpenChange={onOpenChange} platform={platform} />
      </ApiProvider>
    </I18nextProvider>,
  );
  return { POST, onOpenChange, user, sheet: screen.getByRole('dialog') };
}

beforeEach(() => useRoute.getState().goLibrary());
afterEach(() => vi.restoreAllMocks());

describe('defaultSource', () => {
  it('is screen share on Windows, which has no Desk View, and paper elsewhere', () => {
    expect(defaultSource('win32')).toBe('screen');
    expect(defaultSource('darwin')).toBe('paper');
    expect(defaultSource('linux')).toBe('paper');
  });
});

describe('NewSessionSheet', () => {
  it('submits chosen values', async () => {
    const { POST, onOpenChange, user } = await renderSheet();
    POST.mockResolvedValue(created(CREATED));
    // Move off each value and back, so the choice really flows through the controls.
    await user.click(screen.getByRole('radio', { name: 'Studying' }));
    await user.click(screen.getByRole('radio', { name: 'Homework' }));
    await user.click(screen.getByRole('radio', { name: 'Español' }));
    await user.click(screen.getByRole('radio', { name: 'English' }));
    await user.click(screen.getByRole('radio', { name: 'Just talk' }));
    await user.click(screen.getByRole('radio', { name: 'Paper · Desk View' }));

    await user.click(screen.getByRole('button', { name: 'Start session' }));

    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST).toHaveBeenCalledWith('/v1/sessions', {
      body: { type: 'homework', language: 'en', source: 'paper' },
    });
    await waitFor(() =>
      expect(useRoute.getState().route).toEqual({ name: 'session', sessionId: CREATED.id }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('defaults language to UI language', async () => {
    await renderSheet({ lang: 'ko' });
    expect(screen.getByRole('radio', { name: '한국어' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false');
    // Homework and, off Windows, Paper are the other defaults.
    expect(screen.getByRole('radio', { name: '숙제' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '종이 · Desk View' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('win32 disables paper and shows the notice', async () => {
    await renderSheet({ platform: 'win32' });
    const paper = screen.getByRole('radio', { name: 'Paper · Desk View' });
    expect(paper).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Screen share' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const notice = screen.getByText(
      "Desk View isn't available on Windows. Share your screen instead.",
    );
    expect(screen.getByRole('radiogroup', { name: "How you'll work" })).toHaveAttribute(
      'aria-describedby',
      notice.id,
    );
  });

  it('shows no Windows notice elsewhere, and keeps Paper available', async () => {
    await renderSheet({ platform: 'darwin' });
    expect(screen.getByRole('radio', { name: 'Paper · Desk View' })).toBeEnabled();
    expect(screen.queryByText(/isn't available on Windows/)).not.toBeInTheDocument();
  });

  it('is titled New session, and labels each choice as a group', async () => {
    const { sheet } = await renderSheet();
    expect(sheet).toHaveAccessibleName('New session');
    for (const name of ['Type', 'Language', "How you'll work"]) {
      expect(within(sheet).getByRole('group', { name })).toBeInTheDocument();
      expect(within(sheet).getByRole('radiogroup', { name })).toBeInTheDocument();
    }
  });

  it('creates one session however often Start is clicked, busy until the server answers', async () => {
    const { POST, user } = await renderSheet();
    const answer = pending<ReturnType<typeof created>>();
    POST.mockReturnValue(answer.promise);
    await user.dblClick(screen.getByRole('button', { name: 'Start session' }));
    const busy = screen.getByRole('button', { name: 'Starting…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(POST).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve(created(CREATED)));
    await waitFor(() => expect(useRoute.getState().route).toMatchObject({ name: 'session' }));
  });

  it('explains a failure inside the sheet, stays open, and lets her try again', async () => {
    const { POST, onOpenChange, user } = await renderSheet();
    // The bridge's own error when the device can't register: the server is unreachable.
    POST.mockRejectedValueOnce(new Error('Device registration failed: fetch failed'));
    POST.mockResolvedValueOnce({
      error: { detail: 'boom' },
      response: new Response(null, { status: 500 }),
    });
    POST.mockResolvedValueOnce(created(CREATED));
    const start = screen.getByRole('button', { name: 'Start session' });

    await user.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(useRoute.getState().route).toEqual({ name: 'library' });

    await user.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our end. Try again in a moment.',
    );

    await user.click(start);
    await waitFor(() => expect(useRoute.getState().route).toMatchObject({ name: 'session' }));
  });

  it('Cancel closes without creating a session', async () => {
    const { POST, onOpenChange, user } = await renderSheet();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(POST).not.toHaveBeenCalled();
  });

  it('marks each language by its own language', async () => {
    await renderSheet();
    expect(screen.getByRole('radio', { name: 'Español' })).toHaveAttribute('lang', 'es');
    expect(screen.getByRole('radio', { name: '한국어' })).toHaveAttribute('lang', 'ko');
  });
});
