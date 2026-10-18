// The chat sidebar on the live tutor (integration): the LIVE client against the E2E server's
// fake providers, playing the dfa-board scenario (the one where Ada draws). A typed line and
// Ada's reply travel as `message` server events and render in the sidebar; a generated PNG
// (never a camera frame) uploads to POST /attachments and goes out with the next
// `student-message`; voice off brings a text-only reply (message events, no TTS); Ada's drawing
// adds an action row; and after End session the library reopens the session with its saved
// conversation, image included.
//
// It needs both claude/chat-server (the chat store and events) and claude/chat-ui (the sidebar)
// merged, so it skips itself until the integration branch holds both.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { callApi, launchVoice, settle, snap, startVoiceSession } from './fixtures';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const SERVER_CHAT = join(repoRoot, 'services', 'server', 'src', 'tassel', 'chat', 'store.py');
const DESKTOP_CHAT = join(__dirname, '..', '..', 'src', 'renderer', 'src', 'features', 'chat');
const CHAT_READY = existsSync(SERVER_CHAT) && existsSync(DESKTOP_CHAT);
test.skip(
  !CHAT_READY,
  'needs claude/chat-server (services/server/src/tassel/chat/store.py) and claude/chat-ui ' +
    '(apps/desktop/src/renderer/src/features/chat) merged into this branch',
);

// The dfa-board scenario (services/server/src/tassel/voice/fakes/scenarios/dfa-board.json).
const GREETING = "Hi, I'm Ada. What are we working on today?";
const DRAW_ASK = 'Can you show me the answer?';
// The scripted director routes this turn to the thinker, so its brief is what she says.
const DRAW_BRIEF = "Here's one that works.";
const FALLBACK = "Tell me more about what you're trying.";
const WITH_IMAGE = 'Here is my paper so far.';
const TEXT_ONLY = 'Please answer in text only.';

/** What the sidebar exposes (claude/chat-ui); the board lists these so both sides agree. */
const SIDEBAR = '[data-testid="chat-sidebar"]';
const LINE = '[data-testid="chat-line"]';
const COMPOSER_NAME = 'Message Ada';
const VOICE_TOGGLE_NAME = 'Voice';

/** One RTVI message over the data channel, either way. */
interface Wire {
  dir: 'in' | 'out';
  type: string;
  data: unknown;
}
/** A `message` server event's fields, as the contract declares them. */
interface ChatEvent {
  kind: 'message';
  id: string;
  client_id: string | null;
  role: 'student' | 'tutor' | 'action';
  source: 'voice' | 'typed' | null;
  text: string;
  final: boolean;
  interrupted: boolean;
  attachments: Array<{ id: string; w: number; h: number }>;
  action: { kind: string; side: string; item: string | null; attachment_id: string | null } | null;
}

/**
 * Records every RTVI message on every data channel, from page load: the server's events (in)
 * and the app's client events (out), so the spec can check what travelled, not only what
 * rendered.
 */
async function watchWire(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { wire: Wire[] };
    w.wire = [];
    const record = (dir: 'in' | 'out', raw: unknown) => {
      if (typeof raw !== 'string') return;
      try {
        const message = JSON.parse(raw) as { type?: string; data?: unknown };
        if (typeof message.type === 'string')
          w.wire.push({ dir, type: message.type, data: message.data });
      } catch {
        // Not JSON: a binary or keepalive frame.
      }
    };
    const proto = RTCDataChannel.prototype;
    const send = proto.send;
    proto.send = function (this: RTCDataChannel, data: never) {
      record('out', data);
      return send.call(this, data);
    };
    const addEventListener = proto.addEventListener;
    proto.addEventListener = function (
      this: RTCDataChannel,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'message' && typeof listener === 'function') {
        const wrapped = (event: Event) => {
          record('in', (event as MessageEvent).data);
          listener.call(this, event);
        };
        return addEventListener.call(this, type, wrapped, options);
      }
      return addEventListener.call(this, type, listener as EventListener, options);
    };
    const onmessage = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (onmessage?.set) {
      Object.defineProperty(proto, 'onmessage', {
        ...onmessage,
        set(this: RTCDataChannel, handler: ((event: MessageEvent) => void) | null) {
          onmessage.set?.call(
            this,
            handler &&
              ((event: MessageEvent) => {
                record('in', event.data);
                handler.call(this, event);
              }),
          );
        },
      });
    }
  });
  await page.reload();
}

const wireOf = (page: Page) => page.evaluate(() => (window as unknown as { wire: Wire[] }).wire);

/** The `message` server events so far, in order. */
async function messageEvents(page: Page): Promise<ChatEvent[]> {
  const wire = await wireOf(page);
  return wire
    .filter((m) => m.dir === 'in' && m.type === 'server-message')
    .map((m) => (m.data as { tassel?: { kind?: string } } | undefined)?.tassel)
    .filter((e): e is ChatEvent => e?.kind === 'message');
}

/** The `student-message` client events the app sent so far. */
async function studentMessagesSent(page: Page) {
  const wire = await wireOf(page);
  return wire
    .filter((m) => m.dir === 'out' && m.type === 'client-message')
    .map((m) => m.data as { t?: string; d?: { kind?: string } } | undefined)
    .filter((d) => d?.t === 'tassel' && d.d?.kind === 'student-message')
    .map(
      (d) =>
        d?.d as {
          kind: 'student-message';
          client_id: string;
          text: string;
          attachment_ids: string[];
          voice: boolean;
        },
    );
}

/** A small synthetic PNG (RGB, a diagonal gradient): not a camera frame, never one. */
function syntheticPng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = Math.round((255 * x) / width);
      raw[at + 1] = Math.round((255 * y) / height);
      raw[at + 2] = 96;
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('typed lines, an image, a text-only reply and an action row, saved for the reopened session', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchVoice({
    env: { TASSEL_FAKE_SCRIPT: 'dfa-board', TASSEL_CHAT_SIDEBAR: 'open' },
  });
  try {
    await watchWire(page);
    const id = await startVoiceSession(page, { language: 'en' });
    const tile = page.getByTestId('tutor-tile');
    const sidebar = page.locator(SIDEBAR);
    const lines = sidebar.locator(LINE);
    const composer = sidebar.getByRole('textbox', { name: COMPOSER_NAME });

    // Her greeting arrives as a tutor `message` and renders as the first line.
    await expect(tile).toContainText('Speaking', { timeout: 20_000 });
    await expect(sidebar).toBeVisible();
    await expect(lines.first()).toContainText(GREETING, { timeout: 15_000 });
    await expect(tile).toContainText('Listening', { timeout: 20_000 });
    await expect
      .poll(async () => (await messageEvents(page)).find((e) => e.role === 'tutor' && e.final))
      .toMatchObject({ role: 'tutor', source: 'voice', text: GREETING, attachments: [] });

    // 1. A typed line: the student line echoes the app's client_id; Ada's reply is `typed`.
    await composer.fill(DRAW_ASK);
    await composer.press('Enter');
    await expect(lines.filter({ hasText: DRAW_ASK })).toHaveCount(1);
    const sent = await expect
      .poll(() => studentMessagesSent(page))
      .toHaveLength(1)
      .then(() => studentMessagesSent(page));
    expect(sent[0]).toMatchObject({ text: DRAW_ASK, attachment_ids: [], voice: true });
    const clientId = sent[0]?.client_id as string;
    expect(clientId).toBeTruthy();
    await expect
      .poll(async () => (await messageEvents(page)).find((e) => e.client_id === clientId), {
        timeout: 15_000,
      })
      .toMatchObject({ role: 'student', source: 'typed', text: DRAW_ASK, final: true });
    await expect(sidebar).toContainText(DRAW_BRIEF, { timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (await messageEvents(page)).find(
            (e) => e.role === 'tutor' && e.text.includes(DRAW_BRIEF) && e.final,
          ),
        { timeout: 20_000 },
      )
      .toMatchObject({ source: 'typed', interrupted: false });

    // 2. Ada draws: a view row (the board opened) and a draw row (`fix`), and the board is up.
    await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible({
      timeout: 15_000,
    });
    const actionRow = lines.filter({ has: page.locator('[data-role="action"]') });
    await expect(actionRow.first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (await messageEvents(page)).find((e) => e.role === 'action' && e.action?.kind === 'draw'),
        { timeout: 15_000 },
      )
      .toMatchObject({
        source: null,
        text: '',
        final: true,
        action: { kind: 'draw', side: 'board', item: 'fix', attachment_id: null },
      });
    await expect(tile).toContainText('Listening', { timeout: 20_000 });
    await settle(page);
    await snap(page, 'chat-live-conversation');

    // 3. An image: a generated PNG uploads, shows in the composer, and goes with the line.
    const pngDir = join(__dirname, '..', '..', 'test-results', 'chat');
    mkdirSync(pngDir, { recursive: true });
    const pngPath = join(pngDir, 'synthetic.png');
    writeFileSync(pngPath, syntheticPng(320, 200));
    const uploaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/v1/sessions/${id}/attachments` &&
        response.request().method() === 'POST',
    );
    await sidebar.locator('input[type="file"]').setInputFiles(pngPath);
    const upload = await uploaded;
    expect(upload.status()).toBe(201);
    const attachment = (await upload.json()) as { id: string; w: number; h: number };
    expect(attachment).toMatchObject({ w: 320, h: 200 });
    await expect(sidebar.locator('img')).toHaveCount(1);
    await composer.fill(WITH_IMAGE);
    await composer.press('Enter');
    await expect
      .poll(async () => (await studentMessagesSent(page)).at(-1))
      .toMatchObject({ text: WITH_IMAGE, attachment_ids: [attachment.id], voice: true });
    await expect
      .poll(
        async () =>
          (await messageEvents(page)).find((e) => e.role === 'student' && e.text === WITH_IMAGE),
        { timeout: 15_000 },
      )
      .toMatchObject({ attachments: [{ id: attachment.id, w: 320, h: 200 }] });
    await expect(lines.filter({ hasText: WITH_IMAGE }).locator('img')).toHaveCount(1);
    // The server kept it: it serves the image back as a PNG.
    const served = await callApi(page, `/v1/sessions/${id}/attachments/${attachment.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toMatch(/^image\/(png|jpeg)/);
    expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);
    await expect(sidebar).toContainText(FALLBACK, { timeout: 15_000 });
    await expect(tile).toContainText('Listening', { timeout: 20_000 });

    // 4. Voice off: the reply is text only, message events but no TTS and no bot output.
    await sidebar.getByRole('switch', { name: VOICE_TOGGLE_NAME }).click();
    const before = (await wireOf(page)).length;
    await composer.fill(TEXT_ONLY);
    await composer.press('Enter');
    await expect
      .poll(async () => (await studentMessagesSent(page)).at(-1))
      .toMatchObject({ text: TEXT_ONLY, voice: false });
    await expect
      .poll(
        async () =>
          (await messageEvents(page))
            .filter((e) => e.role === 'tutor' && e.final && e.text.includes(FALLBACK))
            .at(1),
        { timeout: 15_000 },
      )
      .toMatchObject({ source: 'typed', interrupted: false });
    await expect(lines.filter({ hasText: FALLBACK })).toHaveCount(2);
    const after = (await wireOf(page)).slice(before);
    // RTVI still reports the LLM's text (bot-llm-*); nothing is spoken: no TTS, no bot-output.
    const spoken = after.filter(
      (m) => m.dir === 'in' && /^bot-(tts-|output|started-speaking|stopped-speaking)/.test(m.type),
    );
    expect(spoken.map((m) => m.type)).toEqual([]);
    await settle(page);
    await snap(page, 'chat-live-text-only');

    // 5. End, then reopen from the library: the saved conversation loads, image included.
    await page.getByRole('button', { name: 'End session' }).click();
    await page
      .getByRole('dialog', { name: 'End this session?' })
      .getByRole('button', { name: 'End session' })
      .click();
    const cards = page.getByRole('list', { name: 'Your sessions' }).getByRole('listitem');
    await expect(cards).toHaveCount(1);
    const history = (await (await callApi(page, `/v1/sessions/${id}/messages`)).json()) as {
      messages: Array<Record<string, unknown>>;
    };
    const roles = history.messages.map((m) => [m.role, m.source]);
    expect(roles[0]).toEqual(['tutor', 'voice']);
    expect(roles).toContainEqual(['student', 'typed']);
    expect(roles).toContainEqual(['action', null]);
    expect(history.messages.find((m) => m.text === WITH_IMAGE)).toMatchObject({
      attachments: [{ id: attachment.id, w: 320, h: 200 }],
    });
    const loaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/v1/sessions/${id}/messages` &&
        response.request().method() === 'GET',
    );
    await cards.first().getByRole('button').first().click();
    expect((await loaded).status()).toBe(200);
    const reopened = page.locator(SIDEBAR);
    await expect(reopened).toBeVisible({ timeout: 15_000 });
    await expect(reopened.locator(LINE).first()).toContainText(GREETING);
    await expect(reopened.locator(LINE).filter({ hasText: WITH_IMAGE }).locator('img')).toHaveCount(
      1,
    );
    await expect(reopened.locator(LINE).filter({ hasText: DRAW_ASK })).toHaveCount(1);
    await expect(reopened.locator('[data-role="action"]').first()).toBeVisible();
    await settle(page);
    await snap(page, 'chat-live-history');
  } finally {
    await app.close();
  }
});
