import { expect, type Page, test } from '@playwright/test';
import { launchApp, settle, snap } from './fixtures';

// launchApp runs the fake tutor at TASSEL_FAKE_SPEED=20: the 33 s opening takes about 1.7 s.

/** Starts a new session from the library's empty state, through the sheet's defaults. */
async function startSession(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  await page
    .getByRole('dialog', { name: 'New session' })
    .getByRole('button', { name: 'Start session' })
    .click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

test('runs the scripted opening until Ada brings in the board', async () => {
  const { app, page } = await launchApp();
  await startSession(page);

  // Ada names the session from what she hears.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strings that start with 010');
  await expect(page.getByRole('banner')).toContainText('Automata · DFA');

  const captions = page.getByTestId('captions');
  await expect(captions).toContainText('1010', { timeout: 10_000 });
  await expect(captions).toContainText("I think that's it.");
  // Her request brought in the board beside the paper, and she's speaking or listening.
  await expect(page.getByRole('region', { name: 'Your paper · Desk View' })).toBeVisible();
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await expect(page.getByTestId('tutor-tile')).toContainText(/Speaking|Listening/);
  await settle(page);
  await snap(page, 'p1-fake-tutor');

  // R16: the title persisted, so the library shows the tutor's title and subject.
  await page.getByRole('button', { name: 'End session' }).click();
  await page
    .getByRole('dialog', { name: 'End this session?' })
    .getByRole('button', { name: 'End session' })
    .click();
  const card = page.getByRole('list', { name: 'Your sessions' }).getByRole('listitem');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Strings that start with 010');
  await expect(card).toContainText('Automata · DFA');
  await app.close();
});

test('keeps her pinned view when Ada asks for the board (R17)', async () => {
  const { app, page } = await launchApp();
  await startSession(page);
  // Pin paper before Ada's split request at 27.6 s (about 1.4 s at speed 20).
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Board: Paper, pinned' })).toBeVisible();

  await expect(page.getByTestId('captions')).toContainText('1010', { timeout: 10_000 });
  await expect(page.getByRole('region', { name: "Ada's board" })).toHaveCount(0);
  await expect(page.getByText('Ada asks: Paper and board')).toBeVisible();
  await settle(page);
  await snap(page, 'p1-fake-tutor-pinned');

  // Unpin follows Ada again: her split request comes in.
  await page.getByRole('button', { name: 'Unpin' }).click();
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await app.close();
});

test('stops the tutor when she ends the session mid-script', async () => {
  const { app, page } = await launchApp({ TASSEL_FAKE_SPEED: '1' });
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await startSession(page);
  await expect(page.getByTestId('tutor-tile')).toContainText('Listening', { timeout: 5_000 });
  await page.getByRole('button', { name: 'End session' }).click();
  await page
    .getByRole('dialog', { name: 'End this session?' })
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your sessions' })).toBeVisible();
  // Past the script's next steps (the student's line at 1.5 s, the title at 4.5 s): nothing lands.
  await page.waitForTimeout(4_000);
  await expect(page.getByRole('list', { name: 'Your sessions' })).toContainText('Untitled Session');
  expect(problems).toEqual([]);
  await app.close();
});
