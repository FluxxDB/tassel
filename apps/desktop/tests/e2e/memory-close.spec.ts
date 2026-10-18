import { expect, test } from '@playwright/test';
import { launchApp, settle } from './fixtures';

for (const close of ['escape', 'scrim'] as const) {
  test(`memory panel stays stable while closing with ${close}`, async () => {
    const { app, page } = await launchApp();
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: 'Tutor settings', exact: true }).click();
      await page.getByRole('radio', { name: 'Personalization & memory', exact: true }).click();
      const notes = page.getByRole('textbox', { name: 'What your tutor remembers' });
      await expect(notes).toBeEnabled();
      await notes.focus();
      await settle(page);
      const before = await page
        .getByRole('dialog')
        .evaluate((dialog) => (dialog as HTMLElement).offsetHeight);
      const exitFrame = page.evaluate(
        () =>
          new Promise<{ frames: { memory: boolean; height: number }[] }>((resolve, reject) => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return reject(new Error('No dialog'));
            const frames: { memory: boolean; height: number }[] = [];
            const timeout = setTimeout(() => reject(new Error('No close animation')), 3000);
            dialog.addEventListener('animationstart', (event) => {
              if (
                (event as AnimationEvent).animationName !== 'sheet-out' ||
                event.target !== dialog
              )
                return;
              const sample = () => {
                if (!dialog.isConnected) {
                  clearTimeout(timeout);
                  resolve({ frames });
                  return;
                }
                frames.push({
                  memory: !!dialog.querySelector('textarea'),
                  height: (dialog as HTMLElement).offsetHeight,
                });
                requestAnimationFrame(sample);
              };
              sample();
            });
          }),
      );
      if (close === 'escape') await page.keyboard.press('Escape');
      else await page.getByTestId('sheet-scrim').click({ position: { x: 4, y: 4 }, force: true });
      const exit = await exitFrame;
      expect(exit.frames.length).toBeGreaterThan(0);
      expect(exit.frames.every((frame) => frame.memory)).toBe(true);
      expect(exit.frames.every((frame) => frame.height === before)).toBe(true);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Tutor settings', exact: true }).click();
      await expect(notes).toBeVisible();
    } finally {
      await app.close();
    }
  });
}

test('a pending memory load cannot resize the panel during its closing animation', async () => {
  const { app, page } = await launchApp();
  let releaseResponse!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/v1/learner/memory', async (route) => {
      await release;
      await route.fulfill({ json: { enabled: true, content: 'Use short hints.', revision: 1 } });
    });
    await page.getByRole('button', { name: 'Tutor settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Personalization & memory', exact: true }).click();
    await expect(page.getByPlaceholder('Loading memory…')).toBeVisible();
    await settle(page);
    const closing = page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return reject(new Error('Missing memory dialog'));
          dialog.addEventListener('animationstart', (event) => {
            if ((event as AnimationEvent).animationName !== 'sheet-out' || event.target !== dialog)
              return;
            for (const animation of dialog.getAnimations()) animation.pause();
            resolve((dialog as HTMLElement).offsetHeight);
          });
        }),
    );
    await page.keyboard.press('Escape');
    const height = await closing;
    const response = page.waitForResponse('**/v1/learner/memory');
    releaseResponse();
    await response;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(page.getByPlaceholder('Loading memory…')).toBeVisible();
    expect(
      await page.getByRole('dialog').evaluate((dialog) => (dialog as HTMLElement).offsetHeight),
    ).toBe(height);
    await page.getByRole('dialog').evaluate((dialog) => {
      for (const animation of dialog.getAnimations()) animation.play();
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    releaseResponse();
    await app.close();
  }
});

test('opening memory reserves the full form height while notes load', async () => {
  const { app, page } = await launchApp();
  let releaseResponse!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  try {
    await page.route('**/v1/learner/memory', async (route) => {
      await release;
      await route.fulfill({ json: { enabled: true, content: 'Use short hints.', revision: 1 } });
    });
    await page.getByRole('button', { name: 'Tutor settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Personalization & memory', exact: true }).click();
    const notes = page.getByRole('textbox', { name: 'What your tutor remembers' });
    await expect(notes).toBeVisible();
    await expect(notes).toBeDisabled();
    const height = await page
      .getByRole('dialog')
      .evaluate((dialog) => (dialog as HTMLElement).offsetHeight);
    releaseResponse();
    await expect(notes).toHaveValue('Use short hints.');
    await expect(notes).toBeEnabled();
    expect(
      await page.getByRole('dialog').evaluate((dialog) => (dialog as HTMLElement).offsetHeight),
    ).toBe(height);
  } finally {
    releaseResponse();
    await app.close();
  }
});

test('ideal tutor persists independently of saved memories and its enable switch', async () => {
  const { app, page } = await launchApp();
  try {
    const openSettings = async () => {
      await page.getByRole('button', { name: 'Tutor settings', exact: true }).click();
      await page.getByRole('radio', { name: 'Personalization & memory', exact: true }).click();
    };
    await openSettings();
    const style = page.getByRole('textbox', { name: 'Describe your ideal tutor' });
    const notes = page.getByRole('textbox', { name: 'What your tutor remembers' });
    await expect(style).toBeEnabled();
    await style.fill(
      'Be calm and casual, like a patient older sister. Explain one small step at a time.',
    );
    await page.getByRole('button', { name: 'Save tutor style', exact: true }).click();
    await expect(page.getByText('Tutor style saved', { exact: true })).toBeVisible();
    await expect(notes).toBeEnabled();
    await notes.fill('Working on algebra.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('switch', { name: 'Remember across sessions' }).click();
    await expect(page.getByRole('switch', { name: 'Remember across sessions' })).not.toBeChecked();
    await page.getByRole('switch', { name: 'Use tutor personalization' }).click();
    await expect(page.getByRole('switch', { name: 'Use tutor personalization' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Clear memory', exact: true }).click();
    await expect(notes).toHaveValue('');
    await page.reload();
    await openSettings();
    await expect(style).toHaveValue(
      'Be calm and casual, like a patient older sister. Explain one small step at a time.',
    );
    await expect(page.getByRole('switch', { name: 'Use tutor personalization' })).not.toBeChecked();
    await expect(notes).toHaveValue('');
    await expect(page.getByRole('switch', { name: 'Remember across sessions' })).not.toBeChecked();
    await page.getByRole('dialog').evaluate((dialog) => {
      dialog.scrollTop = 0;
    });
    await page.screenshot({ path: 'test-results/screens/tutor-personality-settings.png' });
  } finally {
    await app.close();
  }
});
