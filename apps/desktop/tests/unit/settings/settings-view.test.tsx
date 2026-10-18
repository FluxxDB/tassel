// @vitest-environment jsdom
import type { ApiClient } from '@tassel/shared/api';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSessionSheet } from '../../../src/renderer/src/features/new-session/NewSessionSheet';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { useAppSettings } from '../../../src/renderer/src/features/settings/app-settings';
import {
  SettingsButton,
  SettingsView,
} from '../../../src/renderer/src/features/settings/SettingsView';
import { useSessionDefaults } from '../../../src/renderer/src/features/settings/session-defaults';
import { useSettingsView } from '../../../src/renderer/src/features/settings/settings';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';

const bridge = {
  get: vi.fn(async () => ({})),
  set: vi.fn(async (patch: object) => patch),
};

beforeEach(() => {
  vi.stubGlobal('tassel', { platform: 'darwin', settings: bridge });
});

afterEach(() => {
  vi.unstubAllGlobals();
  bridge.get.mockClear();
  bridge.set.mockClear();
  localStorage.clear();
  useSettingsView.setState({ open: false, section: 'tutor' });
  useSessionDefaults.setState({ language: null, source: null, captions: true });
  useAppSettings.setState({ saved: {}, launchPaperSource: null });
});

async function renderSettings(lang: 'en' | 'ko' = 'en') {
  const i18n = await initI18n(lang);
  const api = {
    GET: vi.fn(async () => ({ data: undefined, response: new Response(null, { status: 503 }) })),
  } as unknown as ApiClient;
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <SettingsButton />
        <SettingsView config={{ serverUrl: 'http://127.0.0.1:8787' } as never} />
      </ApiProvider>
    </I18nextProvider>,
  );
  return { user, i18n };
}

describe('SettingsView', () => {
  it('opens from the gear on the Tutor section, lists every section, and closes on Escape', async () => {
    const { user } = await renderSettings();
    const gear = screen.getByRole('button', { name: 'Settings' });
    await user.click(gear);
    const view = await screen.findByRole('dialog', { name: 'Settings' });
    const rail = within(view).getByRole('tablist', { name: 'Settings sections' });
    expect(rail).toHaveAttribute('aria-orientation', 'vertical');
    expect(
      within(rail)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual([
      'Tutor',
      'Personality',
      'Memory',
      'Voice & audio',
      'Session defaults',
      'Language',
      'Camera & paper',
      'Privacy',
      'About',
    ]);
    const tutor = within(rail).getByRole('tab', { name: 'Tutor' });
    expect(tutor).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tutor).toHaveFocus());
    expect(within(view).getByRole('tabpanel', { name: 'Tutor' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Focus goes back to the gear that opened it.
    expect(gear).toHaveFocus();
  });

  it('moves between sections with the arrow keys', async () => {
    const { user } = await renderSettings();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const view = await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(within(view).getByRole('tab', { name: 'Tutor' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(within(view).getByRole('tab', { name: 'Personality' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(useSettingsView.getState().section).toBe('personality');
  });

  it('changes the app language at once and saves it for the main process', async () => {
    const { user, i18n } = await renderSettings();
    useSettingsView.getState().openSettings('language');
    const view = await screen.findByRole('dialog', { name: 'Settings' });
    await user.click(within(view).getByRole('radio', { name: '한국어' }));
    await waitFor(() => expect(i18n.language).toBe('ko'));
    expect(bridge.set).toHaveBeenCalledWith({ uiLanguage: 'ko' });
    expect(await screen.findByRole('dialog', { name: '설정' })).toBeInTheDocument();
  });

  it('saves session defaults that the new session sheet and the stage start from', async () => {
    const { user, i18n } = await renderSettings();
    useSettingsView.getState().openSettings('defaults');
    const view = await screen.findByRole('dialog', { name: 'Settings' });
    await user.click(within(view).getByRole('radio', { name: 'Español' }));
    await user.click(within(view).getByRole('radio', { name: 'Just talk' }));
    await user.click(within(view).getByRole('switch', { name: 'Captions on' }));
    expect(useSessionDefaults.getState()).toMatchObject({
      language: 'es',
      source: 'talk',
      captions: false,
    });
    expect(JSON.parse(localStorage.getItem('tassel.session-defaults') ?? '{}').state).toEqual({
      language: 'es',
      source: 'talk',
      captions: false,
    });
    // A new session's stage opens with captions off.
    useStageStore.getState().reset();
    expect(useStageStore.getState().captionsOn).toBe(false);

    useSettingsView.getState().close();
    render(
      <I18nextProvider i18n={i18n}>
        <ApiProvider client={{} as ApiClient}>
          <NewSessionSheet open onOpenChange={() => {}} platform="darwin" paperFakeClip={false} />
        </ApiProvider>
      </I18nextProvider>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'New session' });
    expect(within(sheet).getByRole('radio', { name: 'Español' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(sheet).getByRole('radio', { name: 'Just talk' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('saves the paper source for the next launch and says when it applies', async () => {
    const { user } = await renderSettings();
    useAppSettings.setState({ launchPaperSource: 'auto' });
    useSettingsView.getState().openSettings('camera');
    const view = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(view).getByRole('radio', { name: 'Automatic' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(view).getByRole('radio', { name: 'Camera' }));
    expect(bridge.set).toHaveBeenCalledWith({ paperSource: 'webcam' });
    expect(
      await within(view).findByText('Applies the next time you open Tassel.'),
    ).toBeInTheDocument();
  });
});
