// @vitest-environment jsdom
import { createApiClient } from '@tassel/shared/api';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import { MemoryPanel } from '../../src/renderer/src/avatar/MemoryPanel';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';

async function setup(conflict = false) {
  let prefs = { enabled: true, lines: ['Shorter hints.', 'Explain in Spanish.'], revision: 1 };
  const updates: unknown[] = [];
  const deletes: string[] = [];
  const send = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe('/v1/learner/preferences');
    if (request.method === 'PATCH') {
      const body = await request.json();
      updates.push(body);
      if (conflict) return Response.json({ detail: 'conflict' }, { status: 409 });
      prefs = { ...body, revision: prefs.revision + 1 };
    }
    if (request.method === 'DELETE') {
      deletes.push(request.url);
      prefs = { ...prefs, lines: [], revision: prefs.revision + 1 };
      return new Response(null, { status: 204 });
    }
    return Response.json(prefs);
  });
  const api = createApiClient({
    baseUrl: 'http://localhost',
    getToken: async () => 'token',
    refreshToken: async () => 'token',
    fetch: send,
  });
  const i18n = await initI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <MemoryPanel open />
      </ApiProvider>
    </I18nextProvider>,
  );
  await screen.findByText('Shorter hints.');
  return { updates, deletes };
}

it('lists the preferences Ada keeps, one per line', async () => {
  await setup();
  const list = within(screen.getByRole('region', { name: 'Memory' })).getByRole('list');
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Shorter hints.', 'Explain in Spanish.']);
});

it('keeps the preferences when memory is turned off', async () => {
  const { updates } = await setup();
  fireEvent.click(screen.getByRole('switch', { name: 'Remember across sessions' }));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Remember across sessions' })).not.toBeChecked(),
  );
  expect(updates[0]).toEqual({
    enabled: false,
    lines: ['Shorter hints.', 'Explain in Spanish.'],
    revision: 1,
  });
  expect(screen.getByText('Shorter hints.')).toBeInTheDocument();
});

it('edits the lines and saves them with the current revision, dropping blanks', async () => {
  const { updates } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: /One preference per line/ }), {
    target: { value: 'One hint at a time.\n\n  Calm tone.  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect(updates[0]).toEqual({
    enabled: true,
    lines: ['One hint at a time.', 'Calm tone.'],
    revision: 1,
  });
  expect(screen.getByText('Calm tone.')).toBeInTheDocument();
});

it('keeps the edit open when another copy changed meanwhile', async () => {
  await setup(true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const field = screen.getByRole('textbox', { name: /One preference per line/ });
  fireEvent.change(field, { target: { value: 'Keep my edit.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(/changed since you opened it/);
  expect(field).toHaveValue('Keep my edit.');
});

it('deletes every preference only after a confirmation', async () => {
  const { deletes } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete everything Ada remembers?' });
  expect(deletes).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete all' }));
  await screen.findByText('Deleted everything Ada remembered.');
  expect(deletes).toHaveLength(1);
  expect(screen.queryByText('Shorter hints.')).not.toBeInTheDocument();
});
