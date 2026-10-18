import { expect, test } from '@playwright/test';
import { launchApp, settle, snap } from './fixtures';

test('customizes the tutor, persists after reload, and uses it in a session', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByLabel('Tutor name', { exact: true }).fill('Nova');
    await page.getByRole('button', { name: 'Next Hair style', exact: true }).click();
    await page.getByRole('button', { name: 'Next Outfit', exact: true }).click();
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next Hair style', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Skin tone 7', exact: true }).click();
    await page.getByRole('button', { name: 'Next Face style', exact: true }).click();
    await snap(page, 'avatar-body');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByTestId('avatar-celebration')).toBeVisible();
    await snap(page, 'avatar-save');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await expect(page.getByLabel('Tutor name', { exact: true })).toHaveValue('Nova');
    await expect(page.getByTestId('avatar-preview').locator('svg')).toHaveAttribute(
      'data-hair',
      'bob',
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680),
    );
    await expect
      .poll(() => page.evaluate(() => Math.abs(window.innerWidth - 1024)))
      .toBeLessThanOrEqual(1);
    await settle(page);
    await snap(page, 'avatar-style-small');
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByLabel('Tutor name', { exact: true })).toHaveValue('Ada');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'New session', exact: true })
      .click();
    await page.getByRole('radio', { name: 'Just talk', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(page.getByTestId('tutor-tile')).toContainText('Nova');
    await expect(page.getByTestId('tutor-tile').locator('svg').first()).toHaveAttribute(
      'data-hair',
      'bob',
    );
  } finally {
    await app.close();
  }
});

test('outfits stay aligned and speaking animates only while the tutor speaks', async () => {
  const { app, page } = await launchApp({ TASSEL_FAKE_SPEED: '2' });
  try {
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await settle(page);
    for (const outfit of ['sweater', 'collar', 'hoodie', 'overalls', 'dress']) {
      await expect(page.getByTestId('avatar-preview').locator('svg')).toHaveAttribute(
        'data-outfit',
        outfit,
      );
      await snap(page, `avatar-outfit-${outfit}`);
      await page.getByRole('button', { name: 'Next Outfit', exact: true }).click();
    }
    for (let hair = 0; hair < 6; hair++) {
      for (let outfit = 0; outfit < 5; outfit++) {
        const preview = page.getByTestId('avatar-preview');
        const svg = preview.locator('svg');
        if ((await svg.getAttribute('data-outfit')) === 'dress') {
          await expect(svg).toHaveAttribute('viewBox', '0 0 200 220');
          await expect(preview.getByTestId('dress-layer')).toHaveCount(1);
        } else {
          const body = preview.locator('svg g[clip-path]');
          await expect(body).toHaveCount(1);
          await expect(body.locator('path').first()).toHaveAttribute('d', /Q102 168 117 150/);
        }
        await page.getByRole('button', { name: 'Next Outfit', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Next Hair style', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'New session', exact: true })
      .click();
    await page.getByRole('radio', { name: 'Just talk', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    const avatar = page.getByTestId('tutor-tile').locator('svg').first();
    await expect(avatar).toHaveAttribute('data-speaking', 'true', { timeout: 20000 });
    const mouths = avatar.locator('.avatar-mouth');
    await expect
      .poll(() => mouths.evaluateAll((nodes) => nodes.some((n) => n.getAnimations().length > 0)))
      .toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() => mouths.evaluateAll((nodes) => nodes.every((n) => n.getAnimations().length === 0)))
      .toBe(true);
    await expect(avatar.locator('.avatar-mouth-small')).toHaveCSS('display', 'block');
    await expect(avatar).toHaveAttribute('data-speaking', 'false', { timeout: 20000 });
    await expect(avatar.locator('.avatar-mouth-rest')).toHaveCSS('display', 'inline');
  } finally {
    await app.close();
  }
});

test('save keeps the full editor visible throughout the closing animation', async () => {
  const { app, page } = await launchApp();
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await settle(page);
    const before = await page
      .getByRole('dialog')
      .evaluate((dialog) => dialog.getBoundingClientRect().height);
    const exitFrame = page.evaluate(
      () =>
        new Promise<{ editorPresent: boolean; height: number }>((resolve, reject) => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return reject(new Error('Missing editor dialog'));
          const timeout = setTimeout(
            () => reject(new Error('No closing animation observed')),
            6000,
          );
          dialog.addEventListener('animationstart', (event) => {
            if ((event as AnimationEvent).animationName !== 'sheet-out' || event.target !== dialog)
              return;
            clearTimeout(timeout);
            resolve({
              editorPresent: !!dialog.querySelector('[data-testid="avatar-celebration"]'),
              height: dialog.getBoundingClientRect().height,
            });
          });
        }),
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const exit = await exitFrame;
    expect(exit.editorPresent).toBe(true);
    expect(Math.abs(exit.height - before)).toBeLessThan(3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await expect(page.getByTestId('avatar-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('dress, material contrast and real voice choices stay offline', async () => {
  const { app, page } = await launchApp();
  const audioRequests: string[] = [];
  page.on('request', (request) => {
    if (/api\.elevenlabs\.io/.test(request.url()) || request.resourceType() === 'media')
      audioRequests.push(request.url());
  });
  try {
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await expect(page.getByLabel('English voice', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await expect(page.getByLabel('English voice', { exact: true })).toHaveValue('off');
    await page.getByRole('button', { name: 'Skin tone 7', exact: true }).click();
    const voice = await page
      .getByLabel('English voice', { exact: true })
      .locator('option')
      .nth(1)
      .getAttribute('value');
    expect(voice).toBeTruthy();
    await page.getByLabel('English voice', { exact: true }).selectOption(voice || 'off');
    await snap(page, 'avatar-material-boundaries');
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    for (let step = 0; step < 3; step++) {
      await page.getByRole('button', { name: 'Next Outfit', exact: true }).click();
      await page.getByRole('button', { name: 'Next Outfit color', exact: true }).click();
    }
    await snap(page, 'avatar-navy-overalls');
    await page.getByRole('button', { name: 'Next Outfit', exact: true }).click();
    await page.getByRole('button', { name: 'Previous Hat', exact: true }).click();
    await expect(page.getByTestId('dress-layer')).toBeVisible();
    await snap(page, 'avatar-headscarf-dress');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await expect(page.getByTestId('avatar-preview').locator('svg')).toHaveAttribute(
      'data-outfit',
      'dress',
    );
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await expect(page.getByLabel('English voice', { exact: true })).toHaveValue(voice || 'off');
    expect(audioRequests).toEqual([]);
  } finally {
    await app.close();
  }
});

test('hats and centered sideways eyes persist, and previews play only public samples', async () => {
  const { app, page } = await launchApp();
  const requests: string[] = [];
  // Twenty seconds of generated silence, served instead of external audio. Never call a provider.
  const wav = Buffer.alloc(44 + 16000 * 2 * 20);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const serve = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    requests.push(request.url());
    expect(request.method()).toBe('GET');
    expect(request.url()).not.toContain('text-to-speech');
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
  };
  await page.route('https://api.us.elevenlabs.io/**', serve);
  await page.route('https://storage.googleapis.com/eleven-public-prod/**', serve);
  try {
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    for (const hat of ['cap', 'beanie', 'headscarf']) {
      await page.getByRole('button', { name: 'Next Hat', exact: true }).click();
      await expect(page.getByTestId('avatar-preview').locator('svg')).toHaveAttribute(
        'data-hat',
        hat,
      );
      await snap(page, `avatar-hat-${hat}`);
    }
    await page.getByRole('button', { name: 'Next Hat', exact: true }).click();
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await page.getByRole('button', { name: 'Next Face style', exact: true }).click();
    await page.getByRole('button', { name: 'Next Face style', exact: true }).click();
    const eyes = await page
      .getByTestId('avatar-preview')
      .getByTestId('avatar-eyes')
      .evaluate((node) => {
        const box = (node as unknown as SVGGraphicsElement).getBBox();
        return { centerX: box.x + box.width / 2, centerY: box.y + box.height / 2 };
      });
    expect(eyes).toEqual({ centerX: 102, centerY: 98.5 });
    await snap(page, 'avatar-sideways-centered');
    const voice = await page
      .getByLabel('English voice', { exact: true })
      .locator('option')
      .nth(1)
      .getAttribute('value');
    await page.getByLabel('English voice', { exact: true }).selectOption(voice || 'off');
    expect(requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Preview English voice', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Stop preview English voice', exact: true }),
    ).toBeVisible();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect(
      page.getByRole('button', { name: 'Preview English voice', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Preview English voice', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Stop preview English voice', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    await page.getByRole('button', { name: 'Next Hat', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Tutor settings' }).click();
    await expect(page.getByTestId('avatar-preview').locator('svg')).toHaveAttribute(
      'data-hat',
      'cap',
    );
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Preview English voice', exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
