// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TitleStrip } from '../../src/renderer/src/features/session/TitleStrip';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';

const SESSION: Session = {
  id: 's-1',
  title: 'Strings that start with 010',
  title_source: 'ai',
  subject: 'Automata · DFA',
  type: 'homework',
  language: 'en',
  source: 'paper',
  created_at: new Date().toISOString(),
  last_activity_at: new Date().toISOString(),
};

beforeEach(() => vi.stubGlobal('tassel', { platform: 'darwin' }));
afterEach(() => vi.unstubAllGlobals());

async function renderStrip() {
  const PATCH = vi.fn(async (_path: string, init: { body: Partial<Session> }) => ({
    data: { ...SESSION, ...init.body },
    response: new Response(null),
  }));
  const api = { PATCH } as unknown as ApiClient;
  const i18n = await initI18n('en');
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <TitleStrip session={SESSION} failed={false} startedAt={new Date()} />
      </ApiProvider>
    </I18nextProvider>,
  );
  return { user, PATCH };
}

it('renames on a double click: Enter saves her title through patchSession', async () => {
  const { user, PATCH } = await renderStrip();
  expect(screen.getByRole('heading', { level: 1, name: SESSION.title ?? '' })).toBeInTheDocument();
  await user.dblClick(screen.getByRole('button', { name: SESSION.title ?? '' }));
  const field = screen.getByRole('textbox', { name: 'Session title' });
  expect(field).toHaveFocus();
  await user.clear(field);
  await user.type(field, 'My DFA{Enter}');
  await waitFor(() => expect(PATCH).toHaveBeenCalledTimes(1));
  expect(PATCH.mock.calls[0][1]).toMatchObject({ body: { title: 'My DFA' } });
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Session title' })).not.toBeInTheDocument(),
  );
});

it('renames from Enter on the focused title, and Escape cancels without saving', async () => {
  const { user, PATCH } = await renderStrip();
  screen.getByRole('button', { name: SESSION.title ?? '' }).focus();
  await user.keyboard('{Enter}');
  const field = screen.getByRole('textbox', { name: 'Session title' });
  await user.type(field, ' changed');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('textbox', { name: 'Session title' })).not.toBeInTheDocument();
  expect(PATCH).not.toHaveBeenCalled();
});

it("moves the type into the title's menu, which saves a new one", async () => {
  const { user, PATCH } = await renderStrip();
  // One subject chip; the type isn't a chip any more.
  expect(screen.getByText('Automata · DFA')).toBeInTheDocument();
  expect(screen.queryByText('Homework')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Session options' }));
  expect(await screen.findByRole('menuitemradio', { name: 'Homework' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(screen.getByRole('menuitemradio', { name: 'Studying' }));
  await waitFor(() => expect(PATCH).toHaveBeenCalledTimes(1));
  expect(PATCH.mock.calls[0][1]).toMatchObject({ body: { type: 'studying' } });
});

it('shows the source and the timer in one status pill, beside the gear', async () => {
  await renderStrip();
  const timer = screen.getByRole('timer');
  expect(timer.parentElement).toHaveTextContent(/^Desk View·00:0\d$/);
  expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
});
