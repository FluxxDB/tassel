// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AUDIO_PREFS,
  useAudioPrefs,
} from '../../../src/renderer/src/features/voice/audio-prefs';

beforeEach(() => {
  localStorage.clear();
  useAudioPrefs.getState().reset();
});
describe('audio preferences', () => {
  it('defaults to system devices, open mic and normal interruptions', () => {
    expect(DEFAULT_AUDIO_PREFS).toEqual({
      inputId: null,
      outputId: null,
      presenter: false,
      presenterOutputId: null,
      pushToTalk: false,
      sensitivity: 'normal',
    });
  });
  it('presenter mode turns on push-to-talk and fewer interruptions', () => {
    useAudioPrefs.getState().setPresenter(true, 'room');
    expect(useAudioPrefs.getState()).toMatchObject({
      presenter: true,
      presenterOutputId: 'room',
      pushToTalk: true,
      sensitivity: 'low',
    });
  });
  it('turning presenter off leaves push-to-talk and other choices as she set them', () => {
    useAudioPrefs.getState().setPresenter(true, 'room');
    useAudioPrefs.getState().set({ pushToTalk: false, sensitivity: 'high' });
    useAudioPrefs.getState().setPresenter(false, 'ignored');
    expect(useAudioPrefs.getState()).toMatchObject({
      presenter: false,
      presenterOutputId: 'room',
      pushToTalk: false,
      sensitivity: 'high',
    });
    useAudioPrefs.getState().setPresenter(true);
    expect(useAudioPrefs.getState().presenterOutputId).toBe('room');
  });
  it('persists device choices across a fresh module and rehydration', async () => {
    useAudioPrefs.getState().set({ inputId: 'mac-mic', outputId: 'headphones', pushToTalk: true });
    const saved = JSON.parse(localStorage.getItem('tassel.audio-prefs') ?? '{}');
    expect(saved).toEqual({
      state: {
        ...DEFAULT_AUDIO_PREFS,
        inputId: 'mac-mic',
        outputId: 'headphones',
        pushToTalk: true,
      },
      version: 1,
    });
    vi.resetModules();
    const { useAudioPrefs: reloaded } = await import(
      '../../../src/renderer/src/features/voice/audio-prefs'
    );
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({
      inputId: 'mac-mic',
      outputId: 'headphones',
      pushToTalk: true,
    });
  });
  it('rehydration rejects corrupt values and cannot replace actions', async () => {
    localStorage.setItem(
      'tassel.audio-prefs',
      JSON.stringify({
        version: 1,
        state: { inputId: 42, outputId: 'mac', pushToTalk: 'yes', sensitivity: 'loud', set: 'bad' },
      }),
    );
    await useAudioPrefs.persist.rehydrate();
    expect(useAudioPrefs.getState()).toMatchObject({
      inputId: null,
      outputId: 'mac',
      pushToTalk: false,
      sensitivity: 'normal',
    });
    expect(typeof useAudioPrefs.getState().set).toBe('function');
  });
  it('reset persists the default choices', () => {
    useAudioPrefs.getState().set({ inputId: 'iphone', outputId: 'room' });
    useAudioPrefs.getState().reset();
    expect(JSON.parse(localStorage.getItem('tassel.audio-prefs') ?? '{}')).toEqual({
      state: DEFAULT_AUDIO_PREFS,
      version: 1,
    });
  });
});
