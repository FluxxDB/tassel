export type PreviewState = { id: string; status: 'loading' | 'playing' | 'error' } | null;

/** Only existing public preview files; never a synthesis endpoint or an authenticated request. */
export function publicPreviewUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const storage =
      url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/eleven-public-prod/');
    const api =
      url.hostname === 'api.us.elevenlabs.io' &&
      /^\/v1\/voices\/[a-zA-Z0-9]+\/previews\/audio$/.test(url.pathname);
    return storage || api ? url.href : null;
  } catch {
    return null;
  }
}

export class VoicePreviewPlayer {
  private audio: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly onState: (state: PreviewState) => void) {}
  stop(notify = true) {
    clearTimeout(this.timer);
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (notify) this.onState(null);
  }
  dispose() {
    this.stop(false);
  }
  async play(id: string, source: string | null) {
    this.stop();
    const url = publicPreviewUrl(source);
    if (!url) {
      this.onState({ id, status: 'error' });
      return;
    }
    const audio = new Audio(url);
    audio.preload = 'none';
    this.audio = audio;
    const fail = () => {
      if (this.audio !== audio) return;
      this.stop(false);
      this.onState({ id, status: 'error' });
    };
    audio.onended = () => {
      if (this.audio === audio) this.stop();
    };
    audio.onerror = fail;
    this.onState({ id, status: 'loading' });
    this.timer = setTimeout(fail, 10000);
    try {
      await audio.play();
      if (this.audio !== audio) return;
      clearTimeout(this.timer);
      this.onState({ id, status: 'playing' });
      this.timer = setTimeout(() => this.stop(), 8000);
    } catch {
      fail();
    }
  }
}
