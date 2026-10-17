// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSettings } from '../../../src/renderer/src/features/voice/AudioSettings';
import { useAudioPrefs } from '../../../src/renderer/src/features/voice/audio-prefs';
import { initI18n } from '../../../src/renderer/src/i18n';
import { bindPushToTalk } from '../../../src/renderer/src/tutor/live/push-to-talk';
import { device } from './audio-fakes';

const mic = { ...device('mac-mic'), label: 'MacBook Microphone' };
const speaker = {
  ...device('mac-speaker', 'audiooutput'),
  label: 'MacBook Speakers',
  groupId: 'mac-group',
};
const room = { ...device('room', 'audiooutput'), label: 'Room speakers' };
let media: {
  enumerateDevices: ReturnType<typeof vi.fn>;
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
};
let events: EventTarget;
beforeEach(() => {
  localStorage.clear();
  useAudioPrefs.getState().reset();
  events = new EventTarget();
  media = {
    enumerateDevices: vi.fn(async () => [
      mic,
      { ...device('iphone'), label: '' },
      speaker,
      room,
      { ...device('unnamed', 'audiooutput'), label: '' },
    ]),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: media }));
  // Radix's browser APIs are absent in jsdom; these do not simulate device capture.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
async function panel(lang: 'en' | 'ko' = 'en', initiallyOpen = true) {
  const i18n = await initI18n(lang);
  function Wrapper() {
    const [open, setOpen] = useState(initiallyOpen);
    return (
      <AudioSettings
        open={open}
        onOpenChange={setOpen}
        trigger={<button type="button">Audio settings</button>}
      />
    );
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Wrapper />
    </I18nextProvider>,
  );
  return userEvent.setup();
}
async function openSelect(user: ReturnType<typeof userEvent.setup>, name: string) {
  const trigger = screen.getByRole('combobox', { name });
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  return screen.findByRole('listbox');
}
describe('AudioSettings', () => {
  it.each([
    ['Microphone', 'inputId'],
    ['Speaker', 'outputId'],
  ] as const)('choosing System default forgets an unplugged saved %s', async (label, key) => {
    useAudioPrefs.getState().set({ [key]: 'unwanted-iphone' });
    const user = await panel();
    await screen.findByText(`${label} was disconnected. Using the system default.`);
    await openSelect(user, label);
    await user.click(screen.getByRole('option', { name: 'System default' }));
    expect(useAudioPrefs.getState()[key]).toBeNull();
    media.enumerateDevices.mockResolvedValue([
      device('unwanted-iphone', key === 'inputId' ? 'audioinput' : 'audiooutput'),
    ]);
    act(() => {
      events.dispatchEvent(new Event('devicechange'));
    });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: label })).toHaveTextContent('System default'),
    );
    expect(useAudioPrefs.getState()[key]).toBeNull();
  });

  it('clears a remembered room output that now aliases the primary speaker', async () => {
    media.enumerateDevices.mockResolvedValue([
      { ...device('default', 'audiooutput'), groupId: 'mac-group' },
      speaker,
      room,
    ]);
    useAudioPrefs.getState().setPresenter(true, 'mac-speaker');
    await panel();
    await waitFor(() => expect(useAudioPrefs.getState().presenterOutputId).toBeNull());
    expect(screen.getByRole('combobox', { name: 'Room output' })).toHaveTextContent(
      'Choose a room output',
    );
  });
  it('a lost room output asks for another speaker instead of claiming duplicate default playback', async () => {
    useAudioPrefs.getState().setPresenter(true, 'gone');
    await panel();
    expect(
      await screen.findByText('Room output was disconnected. Choose another speaker.'),
    ).toBeInTheDocument();
    expect(useAudioPrefs.getState().presenterOutputId).toBe('gone');
  });

  it('lists inputs/outputs with fallback labels and system default, without opening capture', async () => {
    const user = await panel();
    await waitFor(() => expect(media.enumerateDevices).toHaveBeenCalled());
    let list = await openSelect(user, 'Microphone');
    expect(within(list).getByRole('option', { name: 'System default' })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: 'MacBook Microphone' })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: 'Microphone 2' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    list = await openSelect(user, 'Speaker');
    expect(within(list).getByRole('option', { name: 'Speaker 3' })).toBeInTheDocument();
  });
  it('choosing a microphone and speaker saves IDs; system default clears a saved ID', async () => {
    const user = await panel();
    await openSelect(user, 'Microphone');
    await user.click(screen.getByRole('option', { name: 'MacBook Microphone' }));
    expect(useAudioPrefs.getState().inputId).toBe('mac-mic');
    await openSelect(user, 'Speaker');
    await user.click(screen.getByRole('option', { name: 'Room speakers' }));
    expect(useAudioPrefs.getState().outputId).toBe('room');
    await openSelect(user, 'Speaker');
    await user.click(screen.getByRole('option', { name: 'System default' }));
    expect(useAudioPrefs.getState().outputId).toBeNull();
  });
  it('presenter mode configures PTT/interruptions and the room list excludes primary', async () => {
    useAudioPrefs.getState().set({ outputId: 'mac-speaker' });
    const user = await panel();
    await user.click(screen.getByRole('switch', { name: 'Presenter mode' }));
    expect(screen.getByRole('switch', { name: 'Push-to-talk' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Fewer' })).toBeChecked();
    const list = await openSelect(user, 'Room output');
    expect(
      within(list).queryByRole('option', { name: 'MacBook Speakers' }),
    ).not.toBeInTheDocument();
    await user.click(within(list).getByRole('option', { name: 'Room speakers' }));
    expect(useAudioPrefs.getState().presenterOutputId).toBe('room');
  });
  it('excludes the physical system-default speaker from room outputs when its group is known', async () => {
    media.enumerateDevices.mockResolvedValue([
      { ...device('default', 'audiooutput'), groupId: 'mac-group' },
      speaker,
      room,
    ]);
    useAudioPrefs.getState().setPresenter(true);
    const user = await panel();
    const list = await openSelect(user, 'Room output');
    expect(
      within(list).queryByRole('option', { name: 'MacBook Speakers' }),
    ).not.toBeInTheDocument();
    expect(within(list).getAllByRole('option')).toHaveLength(1);
  });
  it('sensitivity and push-to-talk save independently', async () => {
    const user = await panel();
    await user.click(screen.getByRole('radio', { name: 'Instant' }));
    await user.click(screen.getByRole('switch', { name: 'Push-to-talk' }));
    expect(useAudioPrefs.getState()).toMatchObject({ sensitivity: 'high', pushToTalk: true });
    expect(screen.getByText('Hold Space while you talk.')).toBeInTheDocument();
  });
  it('controls have accessible names and descriptions in Korean', async () => {
    await panel('ko');
    expect(screen.getByRole('dialog', { name: '오디오' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '마이크' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '스피커' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '발표 모드' })).toHaveAccessibleDescription();
    expect(screen.getByRole('switch', { name: '눌러서 말하기' })).toHaveAccessibleDescription();
    expect(screen.getByRole('radiogroup', { name: '말 끊기' })).toHaveAccessibleDescription();
  });
  it('shows the lost-device notice and retains the remembered choice when it returns', async () => {
    useAudioPrefs.getState().set({ inputId: 'gone' });
    await panel();
    expect(
      await screen.findByText('Microphone was disconnected. Using the system default.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveTextContent(
      'System default',
    );
    expect(useAudioPrefs.getState().inputId).toBe('gone');
    media.enumerateDevices.mockResolvedValue([{ ...device('gone'), label: 'Returned microphone' }]);
    act(() => {
      events.dispatchEvent(new Event('devicechange'));
    });
    await waitFor(() => expect(screen.queryByText(/was disconnected/)).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveTextContent(
      'Returned microphone',
    );
  });
  it('does not claim disconnection while enumeration is pending or denied', async () => {
    useAudioPrefs.getState().set({ inputId: 'mac-mic' });
    let reject!: (error: Error) => void;
    media.enumerateDevices.mockImplementation(
      () =>
        new Promise((_r, fail) => {
          reject = fail;
        }),
    );
    await panel();
    expect(screen.queryByText(/was disconnected/)).not.toBeInTheDocument();
    await act(async () => {
      reject(new Error('denied'));
    });
    expect(screen.queryByText(/was disconnected/)).not.toBeInTheDocument();
    expect(screen.getByText('Audio devices could not be listed. Try again.')).toBeInTheDocument();
  });
  it('Space toggles a settings switch while PTT is bound; Escape restores focus to the opener', async () => {
    const held = vi.fn();
    const unbind = bindPushToTalk(window, held);
    try {
      const user = await panel('en', false);
      const trigger = screen.getByRole('button', { name: 'Audio settings' });
      await user.click(trigger);
      screen.getByRole('switch', { name: 'Push-to-talk' }).focus();
      await user.keyboard(' ');
      expect(useAudioPrefs.getState().pushToTalk).toBe(true);
      expect(held).not.toHaveBeenCalled();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(trigger).toHaveFocus();
    } finally {
      unbind();
    }
  });
});
