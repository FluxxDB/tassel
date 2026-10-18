// A diagram on Ada's board (board.diagram): the fake tutor's diagram-demo draws a network of three
// zones (/26, /27, /28), each a router and two PCs with their addresses, the routers wired to a
// core switch on labelled ports; then highlights Router A and notes the zones' host counts beside
// it, on three real lines. The store's account comes first (the description list, which needs no
// tldraw: P5-R6, I10), then tldraw's drawing: frames around their nodes, cards apart, arrows bound
// and headless, the note's lines kept.
//
// tldraw's license: as board-demo.spec.ts says, a build on app://tassel blanks the board 5 s after
// tldraw mounts unless its key validates there, so the drawing checks run inside that window (the
// script runs at the fixtures' 20x), or on the dev path with TASSEL_E2E_RENDERER_URL.
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchApp, settle, snap } from '../fixtures';
import { hasTldrawKey } from './tldraw-key';

const DEV_RENDERER = process.env.TASSEL_E2E_RENDERER_URL;
const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';
const NO_TLDRAW = 'needs TLDRAW_LICENSE_KEY (P5-R2), or TASSEL_E2E_RENDERER_URL';
const seesTldraw = () => DEV_RENDERER !== undefined || hasTldrawKey();

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function launchDemo(): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launchApp({
    TASSEL_FAKE_SCRIPT: 'diagram-demo',
    ...(DEV_RENDERER && { ELECTRON_RENDERER_URL: DEV_RENDERER }),
  });
  await launched.app.context().route(
    (url) => url.href.startsWith(LICENSE_PING),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
  );
  return launched;
}

async function startSession(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  await page
    .getByRole('dialog', { name: 'New session' })
    .getByRole('button', { name: 'Start session' })
    .click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

const described = (page: Page) =>
  page
    .locator('[data-testid="board-canvas"] ul[aria-label="What\'s on Ada\'s board"] li')
    .allTextContents();

const shapes = (page: Page, type: string) =>
  page.locator(`[data-testid="board-canvas"] .tl-shape[data-shape-type="${type}"]`);
const shapeOf = (page: Page, el: string) =>
  page.locator(`[data-testid="board-canvas"] .tl-shape[data-shape-id="shape:ada.net.${el}"]`);

function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** Each of Ada's diagram shapes on screen, by element: its box, and a group's label's. */
async function drawn(page: Page) {
  return page.evaluate(() => {
    const boxOf = (el: Element) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    };
    const found: Record<string, { box: Box; label?: Box }> = {};
    for (const shape of document.querySelectorAll(
      '[data-testid="board-canvas"] .tl-shape[data-shape-id^="shape:ada.net."]',
    )) {
      const el = (shape.getAttribute('data-shape-id') ?? '').replace('shape:ada.net.', '');
      const figure = shape.querySelector('[role="img"], [role="group"]') ?? shape;
      const label = el.startsWith('group:') ? figure.querySelector('span') : null;
      found[el] = { box: boxOf(figure), ...(label && { label: boxOf(label) }) };
    }
    return found;
  });
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.width <= b.x + b.width + 0.5 &&
  a.y + a.height <= b.y + b.height + 0.5;

const ZONES: Record<string, string[]> = {
  zoneA: ['rA', 'pcA1', 'pcA2'],
  zoneB: ['rB', 'pcB1', 'pcB2'],
  zoneC: ['rC', 'pcC1', 'pcC2'],
};

test('draws a network: zones around their routers and PCs, wired to the core switch', async () => {
  const { app, page } = await launchDemo();
  const problems = watchProblems(page);
  try {
    await startSession(page);

    // The store's account: the whole network, laid out by Graphviz in its worker.
    await expect
      .poll(() => described(page), { timeout: 10_000 })
      .toContain('Note: Zone A /26: 62 hosts\nZone B /27: 30 hosts\nZone C /28: 14 hosts');
    const lines = await described(page);
    expect(lines.slice(0, 4)).toEqual([
      'Diagram: Subnets 192.168.1.0/24',
      'Zone A (192.168.1.0/26): Router A, PC A1, PC A2',
      'Zone B (192.168.1.64/27): Router B, PC B1, PC B2',
      'Zone C (192.168.1.96/28): Router C, PC C1, PC C2',
    ]);
    expect(lines).toContain('Router A: router, 192.168.1.1');
    expect(lines).toContain('Core switch connected to Router C, Gi0/3');
    await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-layout', 'graphviz');
    await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
    expect(problems).toEqual([]);

    test.skip(!seesTldraw(), NO_TLDRAW);

    await expect(shapes(page, 'tassel-group')).toHaveCount(3);
    await expect(shapes(page, 'tassel-node')).toHaveCount(10);
    await expect(shapes(page, 'arrow')).toHaveCount(9);
    await settle(page);
    // Router A is highlighted, and named for screen readers by its label, icon and address.
    await expect(shapeOf(page, 'node:rA').locator('[role="img"]')).toHaveAttribute(
      'aria-label',
      'Router A, router, 192.168.1.1',
    );
    await expect(shapeOf(page, 'node:rA').locator('[data-highlight]')).toHaveAttribute(
      'data-highlight',
      'true',
    );
    // Undirected links: no arrowhead drawn, and the dashed one dashed.
    const heads = await shapes(page, 'arrow').evaluateAll((els) =>
      els.map((el) => el.querySelectorAll('[data-testid="arrowhead"], path[marker-end]').length),
    );
    expect(heads.every((n) => n === 0)).toBe(true);
    const dashes = (el: string) =>
      shapeOf(page, el).evaluate((shape) =>
        [...shape.querySelectorAll('path')].some((path) => {
          const dash =
            path.getAttribute('stroke-dasharray') ?? getComputedStyle(path).strokeDasharray;
          return dash !== '' && dash !== 'none';
        }),
      );
    expect(await dashes('edge:rB>pcB2')).toBe(true);
    expect(await dashes('edge:rB>pcB1')).toBe(false);

    const at = await drawn(page);
    // Each zone frames its nodes, keeps the others out, and its label clears every node.
    for (const [zone, members] of Object.entries(ZONES)) {
      const frame = at[`group:${zone}`];
      expect(frame, zone).toBeDefined();
      for (const [el, { box }] of Object.entries(at)) {
        if (!el.startsWith('node:')) continue;
        const id = el.slice('node:'.length);
        if (members.includes(id)) expect(inside(box, frame.box), `${id} in ${zone}`).toBe(true);
        else expect(overlaps(box, frame.box), `${id} clear of ${zone}`).toBe(false);
        expect(overlaps(box, frame.label as Box), `${id} clear of ${zone}'s label`).toBe(false);
      }
    }
    // No two cards overlap, and no two zones.
    const cards = Object.entries(at).filter(([el]) => el.startsWith('node:'));
    for (const [i, [a, { box }]] of cards.entries()) {
      for (const [b, other] of cards.slice(i + 1)) {
        expect(overlaps(box, other.box), `${a} and ${b}`).toBe(false);
      }
    }
    expect(overlaps(at['group:zoneA'].box, at['group:zoneB'].box)).toBe(false);
    expect(overlaps(at['group:zoneB'].box, at['group:zoneC'].box)).toBe(false);
    // Every label fits its card: no text runs past its box.
    const clipped = await shapes(page, 'tassel-node').evaluateAll((els) =>
      els.flatMap((el) => {
        const card = el.querySelector('[role="img"]');
        if (!card) return ['no card'];
        const edge = card.getBoundingClientRect();
        return [...card.querySelectorAll('span')]
          .filter((span) => {
            const box = span.getBoundingClientRect();
            return box.left < edge.left || box.right > edge.right;
          })
          .map((span) => span.textContent ?? '');
      }),
    );
    expect(clipped).toEqual([]);
    // Her note keeps its three lines.
    const note = page.locator(
      '[data-testid="board-canvas"] .tl-shape[data-shape-id="shape:ada.hosts.note"]',
    );
    await expect(note).toBeVisible();
    const noteLines = await note.evaluate((el) => {
      const text = el.querySelector('div div') ?? el;
      return Math.round(text.getBoundingClientRect().height / 24);
    });
    expect(noteLines).toBeGreaterThanOrEqual(3);
    // Beside her paper, the camera fits it all clear of her tile and the TopLine, at a zoom where
    // its labels stay readable: a network this tall may take the captions band (P5-R9).
    await expect
      .poll(() => page.locator('[data-testid="board-canvas"] [data-fit]').getAttribute('data-fit'))
      .toMatch(/^(clear|no-captions)$/);
    await settle(page);
    await page.waitForTimeout(400);
    await snap(page, 'diagram-network-split');

    // The board alone: Board pinned (Paper, Split, then Board).
    for (let press = 0; press < 3; press++) await page.keyboard.press('b');
    await expect(page.getByRole('button', { name: 'Board: Board, pinned' })).toBeVisible();
    await settle(page);
    await page.waitForTimeout(400);
    await snap(page, 'diagram-network-board');
    expect(problems).toEqual([]);
  } finally {
    await app.close();
  }
});
