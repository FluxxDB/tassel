// @vitest-environment jsdom
import { createApiClient } from '@tassel/shared/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import { AvatarCustomizer } from '../../src/renderer/src/avatar/AvatarCustomizer';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';

async function setup(conflict = false) {
  let memory = { enabled: true, content: 'Use visual explanations.', revision: 1 };
  const updates: unknown[] = [];
  const send = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method === 'PATCH') {
      const body = await request.json();
      updates.push(body);
      if (conflict) return Response.json({ detail: 'conflict' }, { status: 409 });
      memory = { ...body, revision: memory.revision + 1 };
    }
    return Response.json(memory);
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
        <AvatarCustomizer open onOpenChange={vi.fn()} />
      </ApiProvider>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Memory' }));
  await screen.findByDisplayValue('Use visual explanations.');
  return { updates };
}

it('keeps saved notes when memory is disabled and deletes them only on clear', async () => {
  const { updates } = await setup();
  fireEvent.click(screen.getByRole('switch', { name: 'Remember across sessions' }));
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
  expect(screen.getByRole('textbox')).toHaveValue('Use visual explanations.');
  expect(updates[0]).toEqual({ enabled: false, content: 'Use visual explanations.', revision: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Clear memory' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  expect(updates[1]).toEqual({ enabled: false, content: '', revision: 2 });
});

it('saves edited notes with the current revision', async () => {
  const { updates } = await setup();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'One hint at a time.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Saved');
  expect(updates[0]).toEqual({ enabled: true, content: 'One hint at a time.', revision: 1 });
});

it('keeps a draft when a concurrent update conflicts', async () => {
  await setup(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my edit.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/Memory changed since you opened it/);
  expect(screen.getByRole('textbox')).toHaveValue('Keep my edit.');
});
