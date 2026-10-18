// Every launch the capture guard accepts runs with fake camera and microphone devices (the guard
// review's C1): TASSEL_REQUIRE_FAKE_CAPTURE=1 makes main append Chromium's fake-device switch
// whatever the paper source, so even a spec that calls getUserMedia itself gets synthetic tracks.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './fixtures';

const ACCEPTED: Array<[string, Record<string, string>]> = [
  ['fake-clip (the default)', {}],
  [
    'window-capture on self',
    { TASSEL_PAPER_SOURCE: 'window-capture', TASSEL_FAKE_DISPLAY: 'self' },
  ],
  ['screen on self', { TASSEL_PAPER_SOURCE: 'screen', TASSEL_FAKE_DISPLAY: 'self' }],
  [
    'the helper on its clip',
    {
      TASSEL_PAPER_SOURCE: 'deskview-helper',
      TASSEL_HELPER_CLIP: process.env.TASSEL_E2E_CLIP_DFA_SHORT ?? '',
    },
  ],
  [
    'the helper with access denied',
    { TASSEL_PAPER_SOURCE: 'deskview-helper', TASSEL_FAKE_CAMERA_ACCESS: 'denied' },
  ],
  [
    'a missing helper',
    {
      TASSEL_PAPER_SOURCE: 'deskview-helper',
      TASSEL_DESKVIEW_HELPER: join(tmpdir(), 'tassel-e2e-no-helper', 'deskview-helper'),
    },
  ],
];

for (const [name, env] of ACCEPTED) {
  test(`getUserMedia gets fake camera and microphone tracks: ${name}`, async () => {
    const { app, page } = await launchApp(env);
    const labels = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const found = stream.getTracks().map((track) => `${track.kind}: ${track.label}`);
      for (const track of stream.getTracks()) track.stop();
      return found;
    });
    expect(labels).toHaveLength(2);
    // Chromium names its fake devices "fake…", and a clip-backed fake camera by the clip's path.
    const clip = process.env.TASSEL_E2E_CLIP_DFA_SHORT ?? '';
    for (const label of labels) {
      expect(/fake/i.test(label) || label === `video: ${clip}`, label).toBe(true);
    }
    await app.close();
  });
}
