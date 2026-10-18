import { afterEach, expect, it, vi } from 'vitest';
import { publicPreviewUrl, VoicePreviewPlayer } from '../../src/renderer/src/avatar/voice-preview';

class AudioStub {
  src: string;
  preload = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = '';
  });
  constructor(src: string) {
    this.src = src;
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('only accepts public preview resources, never synthesis endpoints', () => {
  expect(
    publicPreviewUrl('https://storage.googleapis.com/eleven-public-prod/example.mp3'),
  ).toBeTruthy();
  expect(
    publicPreviewUrl('https://api.us.elevenlabs.io/v1/voices/abc/previews/audio?payload=x'),
  ).toBeTruthy();
  for (const url of [
    'https://api.us.elevenlabs.io/v1/text-to-speech/abc',
    'https://evil.example/voice.mp3',
    'http://storage.googleapis.com/eleven-public-prod/x',
    'https://storage.googleapis.com/private/x',
  ])
    expect(publicPreviewUrl(url)).toBeNull();
});
it('loads only on play, permits one clip at a time and stops after eight seconds', async () => {
  vi.useFakeTimers();
  const audios: AudioStub[] = [];
  vi.stubGlobal(
    'Audio',
    class extends AudioStub {
      constructor(src: string) {
        super(src);
        audios.push(this);
      }
    },
  );
  const state = vi.fn();
  const player = new VoicePreviewPlayer(state);
  expect(audios).toHaveLength(0);
  await player.play('a', 'https://storage.googleapis.com/eleven-public-prod/a.mp3');
  expect(state).toHaveBeenLastCalledWith({ id: 'a', status: 'playing' });
  await player.play('b', 'https://storage.googleapis.com/eleven-public-prod/b.mp3');
  expect(audios[0].pause).toHaveBeenCalled();
  vi.advanceTimersByTime(8000);
  expect(audios[1].pause).toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith(null);
});
it('reports unavailable previews without making a replacement generation request', async () => {
  vi.stubGlobal(
    'Audio',
    class extends AudioStub {
      play = vi.fn(async () => {
        throw new Error('expired');
      });
    },
  );
  const state = vi.fn();
  const player = new VoicePreviewPlayer(state);
  await player.play('a', 'https://storage.googleapis.com/eleven-public-prod/a.mp3');
  expect(state).toHaveBeenLastCalledWith({ id: 'a', status: 'error' });
  player.dispose();
});

it('cannot restart playback or publish stale state after disposal while loading', async () => {
  let resolve: () => void = () => {};
  vi.stubGlobal(
    'Audio',
    class extends AudioStub {
      play = vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
    },
  );
  const state = vi.fn();
  const player = new VoicePreviewPlayer(state);
  const pending = player.play('a', 'https://storage.googleapis.com/eleven-public-prod/a.mp3');
  player.dispose();
  state.mockClear();
  resolve();
  await pending;
  expect(state).not.toHaveBeenCalled();
});
