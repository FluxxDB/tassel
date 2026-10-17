import { expect, test } from '@playwright/test';
import { E2E_SERVER_URL, launchVoice, snap, startVoiceSession } from './fixtures';

test('fake mic and two fake outputs work, and the track survives noloop EOF', async () => {
  test.setTimeout(45_000);
  const { app, page } = await launchVoice({ mic: 'dfa-en' });
  try {
    const result = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const [track] = stream.getAudioTracks();
      const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audiooutput',
      );
      const first = outputs.find((d) => d.label.includes('Fake Audio Output 1'));
      const second = outputs.find((d) => d.label.includes('Fake Audio Output 2'));
      if (!first || !second) {
        track.stop();
        throw new Error('Missing fake audio outputs');
      }
      const audio = new Audio();
      const context = new AudioContext({ sinkId: second.deviceId } as AudioContextOptions);
      try {
        await audio.setSinkId(first.deviceId);
        await context.resume();
        const initial = track.readyState;
        const contextState = context.state;
        await new Promise((resolve) => setTimeout(resolve, 13_000));
        return {
          outputs: outputs.length,
          initial,
          after: track.readyState,
          contextState,
          access: await window.tassel.voice.micAccess(),
          config: await window.tassel.voice.getConfig(),
        };
      } finally {
        track.stop();
        await context.close();
      }
    });
    expect(result).toMatchObject({
      initial: 'live',
      after: 'live',
      contextState: 'running',
      access: 'granted',
      config: { fakeMic: true },
    });
    expect(result.outputs).toBeGreaterThanOrEqual(2);
    await snap(page, 'p2-fake-mic');
  } finally {
    await app.close();
  }
});

test('fake denied mic rejects capture but preserves output enumeration', async () => {
  const { app, page } = await launchVoice({ env: { TASSEL_FAKE_MIC_ACCESS: 'denied' } });
  try {
    const result = await page.evaluate(async () => {
      let error = '';
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch (failure) {
        error = (failure as DOMException).name;
      }
      const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audiooutput',
      );
      return { error, outputs: outputs.length, access: await window.tassel.voice.micAccess() };
    });
    expect(result.error).toBe('NotAllowedError');
    expect(result.access).toBe('denied');
    expect(result.outputs).toBeGreaterThanOrEqual(2);
    await snap(page, 'p2-fake-mic-denied');
  } finally {
    await app.close();
  }
});

test('voice session helper creates Just talk with the requested language and type', async () => {
  const { app, page } = await launchVoice();
  try {
    const id = await startVoiceSession(page, { language: 'ko', type: 'studying' });
    const token = await page.evaluate(() => window.tassel.getToken());
    const response = await fetch(`${E2E_SERVER_URL}/v1/sessions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({
      id,
      source: 'talk',
      language: 'ko',
      type: 'studying',
    });
  } finally {
    await app.close();
  }
});
