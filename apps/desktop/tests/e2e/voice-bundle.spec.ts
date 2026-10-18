import { expect, test } from '@playwright/test';
import { launchVoice, snap, startVoiceSession } from './fixtures';

test('live voice bundle reaches Speaking under the real CSP', async () => {
  const { app, page } = await launchVoice();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text()))
      errors.push(message.text());
  });
  try {
    await page.addInitScript(() => {
      Object.assign(window, { voiceCspViolations: [] as string[] });
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { voiceCspViolations: string[] }).voiceCspViolations.push(
          event.violatedDirective,
        );
      });
    });
    // Include initial bundle evaluation in the CSP check, not just session navigation.
    await page.reload();
    await startVoiceSession(page, { language: 'en' });
    await expect(page.getByTestId('tutor-tile')).toContainText('Speaking', { timeout: 20000 });
    expect(
      await page.evaluate(
        () => (window as unknown as { voiceCspViolations: string[] }).voiceCspViolations,
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await snap(page, 'voice-bundle-speaking');
  } finally {
    await app.close();
  }
});
