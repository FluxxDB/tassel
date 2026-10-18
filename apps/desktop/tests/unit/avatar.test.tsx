// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { AvatarCustomizer } from '../../src/renderer/src/avatar/AvatarCustomizer';
import { cycle, DEFAULT_AVATAR, HAIR, readAvatar } from '../../src/renderer/src/avatar/catalog';
import { useAvatar } from '../../src/renderer/src/avatar/store';
import { initI18n } from '../../src/renderer/src/i18n';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  useAvatar.setState({ profile: { ...DEFAULT_AVATAR } });
});
it('validates persisted IDs and names, and wraps choices', () => {
  expect(readAvatar({ hair: 'unknown', skin: '<script>', name: '  Nova  ' })).toEqual({
    ...DEFAULT_AVATAR,
    name: 'Nova',
  });
  expect(cycle(HAIR, HAIR[0], -1)).toBe(HAIR.at(-1));
  expect(cycle(HAIR, HAIR[HAIR.length - 1], 1)).toBe(HAIR[0]);
});
async function open(onClose = vi.fn()) {
  const i18n = await initI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <AvatarCustomizer open onOpenChange={onClose} />
    </I18nextProvider>,
  );
  return onClose;
}
it('edits a draft, switches to the palette, and cancels without saving', async () => {
  const close = await open();
  fireEvent.change(screen.getByLabelText('Tutor name'), { target: { value: 'Nova' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next Hair style' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Body' }));
  expect(screen.queryByRole('button', { name: 'Next Hair style' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Skin tone 8' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledWith(false);
  expect(useAvatar.getState().profile).toEqual(DEFAULT_AVATAR);
});
it('persists before celebrating and closes only after the celebration', async () => {
  const close = await open();
  fireEvent.change(screen.getByLabelText('Tutor name'), { target: { value: 'Nova' } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(useAvatar.getState().profile.name).toBe('Nova');
  expect(JSON.parse(localStorage.getItem('tassel.avatar') || '{}').profile.name).toBe('Nova');
  expect(screen.getByTestId('avatar-celebration')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1300);
  });
  expect(close).toHaveBeenCalledWith(false);
});
it('keeps the draft and dialog open when persistence fails', async () => {
  const close = await open();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('supports tab arrow keys and reduced-motion save feedback', async () => {
  const close = await open();
  const style = screen.getByRole('tab', { name: 'Style' });
  fireEvent.keyDown(style, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Body' })).toHaveFocus();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  act(() => {
    vi.advanceTimersByTime(450);
  });
  expect(close).toHaveBeenCalledWith(false);
  vi.unstubAllGlobals();
});

it('offers a dress and keeps real voices off by default in the Body tab', async () => {
  await open();
  expect(screen.queryByLabelText('English voice')).not.toBeInTheDocument();
  for (let step = 0; step < 4; step++)
    fireEvent.click(screen.getByRole('button', { name: /^Next Outfit$/ }));
  expect(screen.getByTestId('avatar-preview').querySelector('svg')).toHaveAttribute(
    'data-outfit',
    'dress',
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Body' }));
  expect(screen.getByLabelText('English voice')).toHaveValue('off');
  expect(screen.getByLabelText('Spanish voice')).toHaveValue('off');
  expect(screen.getByLabelText('Korean voice')).toHaveValue('off');
  expect(
    screen.getByText(
      'ElevenLabs is off. These choices are saved for later and will not generate audio.',
    ),
  ).toBeInTheDocument();
});
it('migrates placeholder voices without discarding appearance or enabling speech', () => {
  const saved = readAvatar({ hair: 'bob', voice: 'gentle', voiceEn: 'unknown-provider-id' });
  expect(saved.hair).toBe('bob');
  expect(saved.voiceEn).toBe('off');
  expect(saved.voiceEs).toBe('off');
  expect(saved.voiceKo).toBe('off');
});
