// The app shell polish (workstream U), in the running app: the Settings window at 1440×900 and
// 1024×680, the library's cleaned strip with its sort menu and a card's menu and rename, the new
// session sheet's soft segments and option cards, and the session strip's rename. Each step
// leaves a screenshot in test-results/screens/shell-*.png.
import { expect, type Page, test } from '@playwright/test';
import { callApi, launchApp, settle, setWindowSize, snap } from './fixtures';

async function seed(page: Page): Promise<void> {
  for (const [create, patch] of [
    [
      { type: 'homework', language: 'en', source: 'paper' },
      { title: 'Strings that start with 010', subject: 'Automata · DFA' },
    ],
    [
      { type: 'studying', language: 'es', source: 'screen' },
      { title: 'Derivadas con la regla de la cadena', subject: 'Cálculo' },
    ],
    [{ type: 'research', language: 'ko', source: 'talk' }, null],
  ] as const) {
    const created = await callApi(page, '/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(create),
    });
    expect(created.status).toBe(201);
    if (patch) {
      const { id } = (await created.json()) as { id: string };
      const patched = await callApi(page, `/v1/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      expect(patched.ok).toBe(true);
    }
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await snap(page, `shell-${name}`);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function walkSettings(page: Page, size: string): Promise<void> {
  const view = page.getByRole('dialog', { name: 'Settings' });
  for (const [tab, name] of [
    ['Tutor', 'tutor'],
    ['Memory', 'memory'],
    ['Voice & audio', 'voice'],
    ['Session defaults', 'defaults'],
    ['Language', 'language'],
    ['Camera & paper', 'camera'],
    ['Privacy', 'privacy'],
    ['About', 'about'],
  ] as const) {
    await view.getByRole('tab', { name: tab, exact: true }).click();
    await expect(view.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
    await noSidewaysScroll(page);
    if (size === '1440' || ['tutor', 'defaults'].includes(name)) {
      await shot(page, `settings-${name}-${size}`);
    }
  }
}

test('Settings: every section at 1440×900 and 1024×680, Escape closes it', async () => {
  const { app, page } = await launchApp();
  try {
    await setWindowSize(app, page, 1440, 900);
    await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'Settings' });
    await expect(view).toBeVisible();
    await expect(view.getByRole('tab', { name: 'Tutor', exact: true })).toBeFocused();
    await walkSettings(page, '1440');
    // The underline tabs in the tutor editor.
    await view.getByRole('tab', { name: 'Tutor', exact: true }).click();
    await view.getByRole('tab', { name: 'Body', exact: true }).click();
    await shot(page, 'settings-tutor-body-1440');

    await setWindowSize(app, page, 1024, 680);
    await walkSettings(page, '1024');
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  } finally {
    await app.close();
  }
});

test('Library: the cleaned strip, the sort menu, and a card renamed and deleted from its menu', async () => {
  const { app, page } = await launchApp();
  try {
    await setWindowSize(app, page, 1440, 900);
    await seed(page);
    await page.reload();
    const cards = page.getByTestId('session-card');
    await expect(cards).toHaveCount(3);
    await shot(page, 'library-1440');

    await page.getByRole('button', { name: /^Sort sessions/ }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Recent activity' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await shot(page, 'library-sort-menu');
    await page.getByRole('menuitemradio', { name: 'Topic' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
    await page.getByRole('button', { name: /^Sort sessions/ }).click();
    await page.getByRole('menuitemradio', { name: 'Recent activity' }).click();

    const firstTitles = await cards.allInnerTexts();

    await page.getByRole('button', { name: 'Options for Strings that start with 010' }).click();
    await shot(page, 'library-card-menu');
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const field = page.getByRole('textbox', { name: 'Session title' });
    await expect(field).toBeFocused();
    await field.fill('DFA: starts with 010');
    await shot(page, 'library-card-rename');
    await field.press('Enter');
    await expect(
      page.getByRole('button', { name: 'DFA: starts with 010', exact: true }),
    ).toBeVisible();
    // A rename doesn't move the card under Recent activity.
    const renamedTitles = await cards.allInnerTexts();
    expect(renamedTitles.findIndex((text) => text.includes('DFA: starts with 010'))).toBe(
      firstTitles.findIndex((text) => text.includes('Strings that start with 010')),
    );

    await page.getByRole('button', { name: 'Options for DFA: starts with 010' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete “DFA: starts with 010”?' });
    await expect(confirm).toBeVisible();
    await shot(page, 'library-card-delete');
    await confirm.getByRole('button', { name: 'Delete session' }).click();
    await expect(cards).toHaveCount(2);

    await setWindowSize(app, page, 1024, 680);
    await noSidewaysScroll(page);
    await shot(page, 'library-1024');
  } finally {
    await app.close();
  }
});

test('New session and the session strip: soft segments, option cards, rename in place', async () => {
  const { app, page } = await launchApp();
  try {
    await setWindowSize(app, page, 1440, 900);
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'New session', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'New session' });
    await sheet.getByRole('radio', { name: 'Studying', exact: true }).click();
    await shot(page, 'new-session');
    await sheet.getByRole('radio', { name: 'Just talk', exact: true }).click();
    await expect(sheet.getByRole('radio', { name: 'Just talk', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await sheet.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(sheet).toBeHidden();

    const strip = page.getByRole('banner');
    const title = strip.getByRole('button', { name: 'Untitled Session' });
    await expect(title).toBeVisible();
    await shot(page, 'session-strip-1440');
    await title.dblclick();
    const field = strip.getByRole('textbox', { name: 'Session title' });
    await expect(field).toBeFocused();
    await field.fill('Chain rule practice');
    await shot(page, 'session-strip-rename');
    await field.press('Enter');
    await expect(
      strip.getByRole('heading', { level: 1, name: 'Chain rule practice' }),
    ).toBeVisible();

    await strip.getByRole('button', { name: 'Session options' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Studying' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await shot(page, 'session-title-menu');
    await page.keyboard.press('Escape');

    // The gear in a session opens the same Settings, over the running session.
    await strip.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('tab', { name: 'Voice & audio', exact: true })
      .click();
    await shot(page, 'session-settings-voice');
    await page.keyboard.press('Escape');

    await setWindowSize(app, page, 1024, 680);
    await noSidewaysScroll(page);
    await shot(page, 'session-strip-1024');

    const saved = await callApi(page, '/v1/sessions?sort=recent');
    const { items } = (await saved.json()) as { items: { title: string; title_source: string }[] };
    expect(items[0]).toMatchObject({ title: 'Chain rule practice', title_source: 'student' });
  } finally {
    await app.close();
  }
});
