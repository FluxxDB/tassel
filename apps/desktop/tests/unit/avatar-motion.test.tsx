// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, it } from 'vitest';
import { Avatar } from '../../src/renderer/src/avatar/Avatar';
import { DEFAULT_AVATAR } from '../../src/renderer/src/avatar/catalog';
import { useStageStore } from '../../src/renderer/src/features/session/stage-store';
import { TutorTile } from '../../src/renderer/src/features/session/TutorTile';
import { initI18n } from '../../src/renderer/src/i18n';

it('stops the mouth immediately at rest and lets celebration override speaking', () => {
  const { container, rerender } = render(<Avatar profile={DEFAULT_AVATAR} speaking />);
  expect(container.querySelector('svg')).toHaveAttribute('data-speaking', 'true');
  rerender(<Avatar profile={DEFAULT_AVATAR} speaking={false} />);
  expect(container.querySelector('svg')).toHaveAttribute('data-speaking', 'false');
  rerender(<Avatar profile={DEFAULT_AVATAR} speaking celebrating />);
  expect(container.querySelector('svg')).toHaveAttribute('data-speaking', 'false');
  expect(container.querySelector('svg')).toHaveAttribute('data-face', 'celebration');
});
it('uses the existing session speaking state without changing voice playback', async () => {
  const i18n = await initI18n('en');
  useStageStore.setState({ tutorState: 'speaking' });
  const { rerender } = render(
    <I18nextProvider i18n={i18n}>
      <TutorTile />
    </I18nextProvider>,
  );
  expect(screen.getByTestId('tutor-tile').querySelector('svg')).toHaveAttribute(
    'data-speaking',
    'true',
  );
  act(() => useStageStore.setState({ tutorState: 'listening' }));
  rerender(
    <I18nextProvider i18n={i18n}>
      <TutorTile />
    </I18nextProvider>,
  );
  expect(screen.getByTestId('tutor-tile').querySelector('svg')).toHaveAttribute(
    'data-speaking',
    'false',
  );
});
