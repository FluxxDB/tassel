// Ada's board in a live conversation (P5 Task 14): the live tutor on the E2E server's fake
// providers (tone TTS) plays the dfa-board scenario. Asked "Can you show me the answer?", her
// tagged reply defines `fix` hidden, splits the stage, and reveals q0 then q0 > q1 as her words
// are heard. The server strips the tags before TTS and sends each sentence's beat before its
// words (Task 13); the app keys every word to its beat by segment and index (P5-R7).
//
// The checks read the board store's description list, which needs no tldraw and holds past a
// build's license window (P5-R6), so they run with or without a key; the screenshot shows
// tldraw's drawing only when the build's key validates on app://tassel.
import { expect, test } from '@playwright/test';
import { launchVoice, settle, snap, startVoiceSession } from '../fixtures';

/** tldraw's license ping, answered here so no spec needs the network (Task 4). */
const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';

const described = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-testid="board-canvas"] ul[aria-label="What\'s on Ada\'s board"] li')
    .allTextContents();

test('Ada draws as she speaks: `fix` shows q0 and q1 on a split stage, no tag captioned', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchVoice({
    env: { TASSEL_FAKE_SCRIPT: 'dfa-board', TASSEL_DEV_CONSOLE: '1' },
  });
  await app.context().route(
    (url) => url.href.startsWith(LICENSE_PING),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
  );
  try {
    // Every caption line the app ever shows, so a tag that slips through is caught.
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { captionsSeen: seen });
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="captions"]')?.textContent;
        if (text) seen.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.reload();
    await startVoiceSession(page, { language: 'en' });
    // Her greeting first: the connection is up and she's back to listening.
    await expect(page.getByTestId('tutor-tile')).toContainText('Speaking', { timeout: 20_000 });
    await expect(page.getByTestId('tutor-tile')).toContainText('Listening', { timeout: 20_000 });

    const input = page.getByRole('textbox', { name: 'Student message' });
    await input.fill('Can you show me the answer?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    await expect
      .poll(() => described(page), { timeout: 15_000 })
      .toEqual(['States: q0, q1', 'Start: q0', 'q0 to q1 on 0']);
    // [[stage split]]: the board is beside the session's own view (Just talk has no paper).
    await expect(page.getByRole('region', { name: 'Just talk' })).toBeVisible();
    await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();

    const captionsSeen = () =>
      page.evaluate(() => (window as unknown as { captionsSeen: string[] }).captionsSeen);
    // q1's reveal fires on the sentence's first word; wait for the rest of it to be heard.
    await expect
      .poll(async () => (await captionsSeen()).join('\n'), { timeout: 15_000 })
      .toContain('A zero takes us to q one.');
    const seen = await captionsSeen();
    expect(seen.filter((line) => line.includes('[['))).toEqual([]);
    await settle(page);
    await snap(page, 'p5-live-board');
  } finally {
    await app.close();
  }
});
