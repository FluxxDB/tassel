// P2 Task 18: a whole conversation with the live voice tutor, on the fake mic and the server's
// fake providers. Typed student lines go in through the chat sidebar's composer, as
// `student-message` events; they show in the chat log, not the captions.
import { expect, type Page, test } from '@playwright/test';
import { callApi, launchVoice, settle, setWindowSize, snap, startVoiceSession } from './fixtures';

const GREETING = "Hi, I'm Ada. What are we working on today?";
const FIRST = "Hi Ada, I'm working on a DFA for binary strings that start with 010.";
const FIRST_REPLY = "Great, draw it on paper and talk me through it. I'll watch.";
const SECOND = "I think that's it. If it starts with a 1, I just wait on q0 until I see a 0.";

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Records Ada's tile's text, every peer connection and every captured track, from page load. */
async function watchVoice(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      tileTexts: string[];
      peers: RTCPeerConnection[];
      tracks: MediaStreamTrack[];
    };
    w.tileTexts = [];
    w.peers = [];
    w.tracks = [];
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        w.peers.push(this);
      }
    } as typeof RTCPeerConnection;
    const media = navigator.mediaDevices;
    const getUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      w.tracks.push(...stream.getTracks());
      return stream;
    };
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="tutor-tile"]')?.textContent ?? '';
      if (text && w.tileTexts.at(-1) !== text) w.tileTexts.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  // Include the first load, as voice-bundle.spec.ts does.
  await page.reload();
}

test('a conversation with Ada: captions, audio, HUD, split, and End stops her (R37)', async () => {
  const { app, page } = await launchVoice({ env: { TASSEL_CHAT_SIDEBAR: 'open' } });
  try {
    await watchVoice(page);
    const id = await startVoiceSession(page, { language: 'en' });
    const tile = page.getByTestId('tutor-tile');
    const captions = page.getByTestId('captions');
    const sidebar = page.getByTestId('chat-sidebar');
    const lines = sidebar.locator('[data-testid="chat-log"] li');
    const composer = sidebar.getByRole('textbox', { name: 'Message to Ada' });

    // Connecting, then Speaking: her greeting, two sentences in one caption.
    await expect(tile).toContainText('Speaking', { timeout: 20_000 });
    const tileTexts = await page.evaluate(
      () => (window as unknown as { tileTexts: string[] }).tileTexts,
    );
    expect(tileTexts.some((text) => text.includes('Connecting to Ada'))).toBe(true);
    await expect(captions.locator('[aria-live="polite"]')).toContainText(GREETING, {
      timeout: 15_000,
    });

    // The chat composer types her first line; it shows as hers in the log, and Ada's spoken
    // reply is captioned.
    await composer.fill(FIRST);
    await composer.press('Enter');
    await expect(lines.filter({ hasText: FIRST })).toHaveAttribute('data-role', 'student');
    await expect(captions.locator('[aria-live="polite"]')).toContainText(FIRST_REPLY, {
      timeout: 15_000,
    });

    // Ada's audio plays: a live track, and time moving.
    const audio = page.locator('audio[data-testid="tutor-audio"]');
    const playing = () =>
      audio.evaluate((el: HTMLAudioElement) => ({
        live:
          el.srcObject instanceof MediaStream &&
          el.srcObject.getAudioTracks().some((t) => t.readyState === 'live'),
        time: el.currentTime,
      }));
    const before = await playing();
    expect(before.live).toBe(true);
    await expect.poll(async () => (await playing()).time).toBeGreaterThan(before.time);

    // The HUD: the route the server reports.
    await page.keyboard.press('ControlOrMeta+Shift+L');
    const hud = page.getByRole('region', { name: 'Latency' });
    await expect(hud.getByTestId('hud-route')).toHaveText('EN · FAKE · FAKE · FAKE');
    // The server's per-turn timings (first audio within budget) arrive with P2 Task 10.
    await expect(hud.getByTestId('hud-first-audio')).toContainText('Budget 1200 ms');

    // Her second line: Ada asks for paper and board, and a trace of 1010.
    await composer.fill(SECOND);
    await composer.press('Enter');
    await expect(lines.filter({ hasText: SECOND })).toHaveAttribute('data-role', 'student');
    await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(captions).toContainText('1010', { timeout: 15_000 });
    await settle(page);
    await snap(page, 'p2-voice-conversation');

    // At 1024×680 nothing covers anything else: the chat sidebar overlays the stage there, and
    // the tile, captions, dock and HUD keep clear of it.
    await setWindowSize(app, page, 1024, 680);
    await settle(page);
    const boxes: Record<string, Box> = {};
    for (const [name, locator] of [
      ['dock', page.getByTestId('dock')],
      ['captions', captions],
      ['tile', tile],
      ['hud', hud],
      ['chat', sidebar],
    ] as const) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`${name} isn't on screen`);
      boxes[name] = box;
    }
    const names = Object.keys(boxes);
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        expect(intersects(boxes[a] as Box, boxes[b] as Box), `${a} and ${b} overlap`).toBe(false);
      }
    }
    await snap(page, 'p2-voice-1024');

    // End session: the live client stops (R37). AI titles wait for P2 Task 9 (server titles),
    // which this branch doesn't have yet, so the card and the server keep no title.
    await page.getByRole('button', { name: 'End session' }).click();
    await page
      .getByRole('dialog', { name: 'End this session?' })
      .getByRole('button', { name: 'End session' })
      .click();
    const card = page.getByRole('list', { name: 'Your sessions' }).getByRole('listitem');
    await expect(card).toHaveCount(1);
    await expect(page.locator('audio[data-testid="tutor-audio"]')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const w = window as unknown as {
            peers: RTCPeerConnection[];
            tracks: MediaStreamTrack[];
          };
          return {
            peers: w.peers.length > 0 && w.peers.every((p) => p.connectionState === 'closed'),
            tracks: w.tracks.length > 0 && w.tracks.every((t) => t.readyState === 'ended'),
          };
        }),
      )
      .toEqual({ peers: true, tracks: true });
    const saved = (await (await callApi(page, `/v1/sessions/${id}`)).json()) as Record<
      string,
      unknown
    >;
    expect(saved).toMatchObject({ id, language: 'en', source: 'talk' });
    await settle(page);
    await snap(page, 'p2-library-after-voice');
  } finally {
    await app.close();
  }
});
