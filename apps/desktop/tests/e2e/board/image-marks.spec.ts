// Ada marks the student's own image, end to end on the server's fake providers: the student's
// image (a synthetic box drawn on a canvas, never a camera frame) is uploaded to the session,
// she asks "Circle the box in my picture." in the developer console, the director sends it to
// the thinker as mark_image, the scripted brief circles m1, and the app loads the image with
// its Set-of-Mark from the elements route: the circle sits on the box the server numbered m1.
import { expect, type Page, test } from '@playwright/test';
import { callApi, launchVoice, settle, snap, startVoiceSession } from '../fixtures';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Elements {
  width: number;
  height: number;
  items: Array<{ id: string; kind: string; box: { x: number; y: number; w: number; h: number } }>;
}

/** Draws her picture (one box on white) and uploads it as hers: the attachment's id and size. */
async function uploadPicture(page: Page, sessionId: string): Promise<{ id: string; w: number }> {
  return page.evaluate(async (session) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas for the picture');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    ctx.strokeStyle = '#1f2a36';
    ctx.lineWidth = 4;
    ctx.strokeRect(200, 150, 400, 300);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No PNG'))), 'image/png'),
    );
    const { serverUrl } = await window.tassel.getConfig();
    const token = await window.tassel.getToken();
    const form = new FormData();
    form.append('image', blob, 'picture.png');
    const response = await fetch(`${serverUrl}/v1/sessions/${session}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (response.status !== 201) throw new Error(`Upload failed: ${response.status}`);
    return (await response.json()) as { id: string; w: number };
  }, sessionId);
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const locator = page.getByTestId(testId).first();
  await expect(locator).toBeAttached();
  return locator.evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
}

test("Ada circles the box in the student's picture, on the box the server numbered", async () => {
  const { app, page } = await launchVoice({ env: { TASSEL_FAKE_SCRIPT: 'image-marks' } });
  try {
    const sessionId = await startVoiceSession(page, { language: 'en' });
    const captions = page.getByTestId('captions');
    await expect(captions.locator('[aria-live="polite"]')).toContainText(
      "Hi, I'm Ada. Send me what you're working on.",
      { timeout: 20_000 },
    );
    const picture = await uploadPicture(page, sessionId);
    const response = await callApi(
      page,
      `/v1/sessions/${sessionId}/attachments/${picture.id}/elements`,
    );
    expect(response.ok).toBe(true);
    const elements = (await response.json()) as Elements;
    const m1 = elements.items.find((item) => item.id === 'm1');
    if (!m1) throw new Error('The server numbered no m1 on her picture');

    const input = page.getByRole('textbox', { name: 'Student message' });
    await input.fill('Circle the box in my picture.');
    await input.press('Enter');

    // Her picture takes the paper panel, and Ada's circle lands on it.
    const image = page.getByTestId('stage-image');
    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBe(picture.w);
    await expect(page.getByRole('region', { name: 'Your image' })).toBeVisible();
    const ring = page.locator('[data-testid^="mark-circle-"]');
    await expect(ring).toHaveCount(1, { timeout: 20_000 });
    await expect(captions.locator('[aria-live="polite"]')).toContainText(
      'This box is the one to look at.',
      { timeout: 15_000 },
    );
    await settle(page);

    // The circle holds m1's box, projected through the image's fit on screen.
    const shown = await boxOf(page, 'stage-image');
    const scale = shown.width / elements.width;
    const ink = {
      x: shown.x + m1.box.x * scale,
      y: shown.y + m1.box.y * scale,
      width: m1.box.w * scale,
      height: m1.box.h * scale,
    };
    const circle = await ring.evaluate((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    });
    expect(circle.x).toBeLessThanOrEqual(ink.x + 1);
    expect(circle.y).toBeLessThanOrEqual(ink.y + 1);
    expect(circle.x + circle.width).toBeGreaterThanOrEqual(ink.x + ink.width - 1);
    expect(circle.y + circle.height).toBeGreaterThanOrEqual(ink.y + ink.height - 1);
    // And it is near that box, not around the whole image.
    expect(circle.width).toBeLessThan(ink.width * 1.6);
    expect(circle.height).toBeLessThan(ink.height * 1.6);
    await snap(page, 'chat-image-marks-1440');
  } finally {
    await app.close();
  }
});
