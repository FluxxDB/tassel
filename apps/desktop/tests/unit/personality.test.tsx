// @vitest-environment jsdom
import { createApiClient } from '@tassel/shared/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import { AvatarCustomizer } from '../../src/renderer/src/avatar/AvatarCustomizer';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';

async function setup(conflict = false) {
  let style = { enabled: true, content: 'Be calm and casual.', revision: 1 };
  let memory = { enabled: true, content: 'Studying algebra.', revision: 1 };
  const writes: { path: string; body: unknown }[] = [];
  const api = createApiClient({
    baseUrl: 'http://localhost',
    getToken: async () => 'token',
    refreshToken: async () => 'token',
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === 'PATCH') {
        const body = await request.json();
        writes.push({ path, body });
        if (conflict) return Response.json({ detail: 'changed' }, { status: 409 });
        if (path.endsWith('/personalization')) style = { ...body, revision: style.revision + 1 };
        else memory = { ...body, revision: memory.revision + 1 };
      }
      return Response.json(path.endsWith('/personalization') ? style : memory);
    },
  });
  const i18n = await initI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <AvatarCustomizer open onOpenChange={vi.fn()} />
      </ApiProvider>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Personalization & memory' }));
  await screen.findByDisplayValue(style.content);
  await screen.findByDisplayValue(memory.content);
  return { writes, getStyle: () => style, getMemory: () => memory };
}

it('saves an authored tutor style without editing automatic memories', async () => {
  const state = await setup();
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe your ideal tutor' }), {
    target: { value: 'Be energetic and playful. Use gentle humor.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save tutor style' }));
  await screen.findByText('Tutor style saved');
  expect(state.getStyle().content).toBe('Be energetic and playful. Use gentle humor.');
  expect(state.getMemory().content).toBe('Studying algebra.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear memory' }));
  await waitFor(() => expect(state.getMemory().content).toBe(''));
  expect(state.getStyle().content).toBe('Be energetic and playful. Use gentle humor.');
});

it('disables personalization independently and keeps the saved description', async () => {
  const state = await setup();
  fireEvent.click(screen.getByRole('switch', { name: 'Use tutor personalization' }));
  await waitFor(() => expect(state.getStyle().enabled).toBe(false));
  expect(state.getStyle().content).toBe('Be calm and casual.');
  expect(state.getMemory().enabled).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Describe your ideal tutor' })).toHaveValue(
    'Be calm and casual.',
  );
});

it('keeps style edits when another device has updated the saved description', async () => {
  await setup(true);
  const field = screen.getByRole('textbox', { name: 'Describe your ideal tutor' });
  fireEvent.change(field, { target: { value: 'Keep my edit.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save tutor style' }));
  await screen.findByText(/Tutor style changed since you opened it/);
  expect(field).toHaveValue('Keep my edit.');
});
