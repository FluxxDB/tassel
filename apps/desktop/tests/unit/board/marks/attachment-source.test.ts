import { createApiClient } from '@tassel/shared/api';
import type { DetectedElements } from '@tassel/shared/beats';
import { afterEach, expect, it, vi } from 'vitest';
import { createAttachmentSource } from '../../../../src/renderer/src/board/marks/attachment-source';
import { resolveTarget } from '../../../../src/renderer/src/board/marks/geometry';
import {
  applyImageAction,
  marksOf,
  registerImageSource,
  useImageStore,
} from '../../../../src/renderer/src/board/marks/image-store';
import { containFit, rectProjector } from '../../../../src/renderer/src/board/marks/project';

const ATTACHMENT = '0f6a1d2e-7b3c-4d5e-8f90-1a2b3c4d5e6f';
const IMAGE_URL = `http://localhost:8852/v1/sessions/session-1/attachments/${ATTACHMENT}`;
const ELEMENTS_URL = `${IMAGE_URL}/elements`;

/** The image's Set-of-Mark as the server's elements route serves it, in its pixels. */
const ELEMENTS: DetectedElements = {
  width: 1200,
  height: 900,
  items: [
    { id: 'm1', kind: 'label', box: { x: 80, y: 60, w: 520, h: 48 } },
    { id: 'm2', kind: 'label', box: { x: 80, y: 140, w: 610, h: 40 } },
    { id: 'm3', kind: 'circle', box: { x: 700, y: 500, w: 300, h: 280 } },
  ],
};

afterEach(() => useImageStore.getState().reset());

function setup(
  opts: {
    status?: number;
    sessionId?: string | null;
    elements?: unknown;
    elementsStatus?: number;
  } = {},
) {
  const { status = 200, sessionId = 'session-1', elements = ELEMENTS, elementsStatus = 200 } = opts;
  const requests: Request[] = [];
  const api = createApiClient({
    baseUrl: 'http://localhost:8852',
    getToken: async () => 'test-token',
    refreshToken: async () => 'test-token',
    fetch: async (request) => {
      const req = request as Request;
      requests.push(req);
      if (req.url.endsWith('/elements')) {
        return new Response(JSON.stringify(elements), {
          status: elementsStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(status === 200 ? new Blob(['png'], { type: 'image/png' }) : '{}', {
        status,
      });
    },
  });
  const revoke = vi.fn();
  const createURL = vi.fn(() => 'blob:attachment');
  const measure = vi.fn(async () => ({ w: 1200, h: 900 }));
  const source = createAttachmentSource({
    api,
    sessionId: () => sessionId,
    createObjectURL: createURL,
    revokeObjectURL: revoke,
    measure,
  });
  return { source, requests, revoke, createURL, measure };
}

async function shown() {
  await vi.waitFor(() => expect(useImageStore.getState().status).toBe('shown'));
  const image = useImageStore.getState().image;
  if (!image) throw new Error('no image shown');
  return image;
}

it('loads the attachment and its Set-of-Mark with the device token, and measures it', async () => {
  const { source, requests, revoke, measure } = setup();
  const off = registerImageSource(source);
  try {
    applyImageAction({ kind: 'image.show', attachmentId: ATTACHMENT });
    const image = await shown();
    expect(requests.map((r) => r.url).sort()).toEqual([IMAGE_URL, ELEMENTS_URL]);
    for (const request of requests) {
      expect(request.headers.get('Authorization')).toBe('Bearer test-token');
    }
    expect(measure).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ url: 'blob:attachment', w: 1200, h: 900 });
    expect(image.detected).toEqual(ELEMENTS);
    image.revoke();
    expect(revoke).toHaveBeenCalledWith('blob:attachment');
  } finally {
    off();
  }
});

it('lands an el mark on the box the server numbered, and skips a marker it has not', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { source } = setup();
  const off = registerImageSource(source);
  try {
    // Ada shows the image and circles m3 in the same breath, before it has loaded.
    applyImageAction({ kind: 'image.show', attachmentId: ATTACHMENT });
    applyImageAction({
      kind: 'image.mark',
      attachmentId: ATTACHMENT,
      mark: { id: 'c1', type: 'circle', target: { el: 'm3' } },
    });
    applyImageAction({
      kind: 'image.mark',
      attachmentId: ATTACHMENT,
      mark: { id: 'c2', type: 'circle', target: { el: 'm9' } },
    });
    const image = await shown();
    const marks = marksOf(useImageStore.getState(), ATTACHMENT);
    expect(marks.map((m) => m.id)).toEqual(['c1']);
    expect(warn).toHaveBeenCalledTimes(1);
    // On a 600×450 panel the image fits at half size: m3's box, halved.
    const fit = containFit(image, { w: 600, h: 450 });
    const elements = { states: {}, edges: {}, detected: image.detected };
    const resolved = resolveTarget({ el: 'm3' }, elements, rectProjector(image.w, image.h), fit);
    expect(resolved?.bbox).toEqual({ x: 350, y: 250, w: 150, h: 140 });
  } finally {
    off();
    warn.mockRestore();
  }
});

it('still shows the image when its Set-of-Mark fails to load', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { source } = setup({ elementsStatus: 503 });
  const off = registerImageSource(source);
  try {
    applyImageAction({ kind: 'image.show', attachmentId: ATTACHMENT });
    const image = await shown();
    expect(image.detected).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    off();
    warn.mockRestore();
  }
});

it('keeps only well-formed boxes from the server', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const elements = {
    width: 1200,
    height: 900,
    items: [
      ELEMENTS.items[0],
      { id: 'q0', kind: 'label', box: { x: 1, y: 1, w: 2, h: 2 } },
      { id: 'm2', kind: 'blob', box: { x: 1, y: 1, w: 2, h: 2 } },
      { id: 'm3', kind: 'circle', box: { x: 1, y: 1, w: -2, h: 2 } },
      { id: 'm1', kind: 'label', box: { x: 5, y: 5, w: 5, h: 5 } },
    ],
  };
  const { source } = setup({ elements });
  try {
    const image = await source.load(ATTACHMENT, { signal: new AbortController().signal });
    expect(image.detected).toEqual({ width: 1200, height: 900, items: [ELEMENTS.items[0]] });
    const broken = setup({ elements: { width: 0, height: 900, items: [] } }).source;
    const none = await broken.load(ATTACHMENT, { signal: new AbortController().signal });
    expect(none.detected).toBeUndefined();
  } finally {
    warn.mockRestore();
  }
});

it('fails when the server has no such attachment, leaving her paper up', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { source, createURL } = setup({ status: 404, elementsStatus: 404 });
  const off = registerImageSource(source);
  try {
    applyImageAction({ kind: 'image.show', attachmentId: ATTACHMENT });
    await vi.waitFor(() => expect(useImageStore.getState().status).toBe('failed'));
    expect(useImageStore.getState().shown).toBeNull();
    expect(createURL).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    off();
    warn.mockRestore();
  }
});

it('needs a session: without one it rejects before any request', async () => {
  const { source, requests } = setup({ sessionId: null });
  await expect(source.load(ATTACHMENT, { signal: new AbortController().signal })).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

it('an aborted load never makes a URL', async () => {
  const { source, createURL } = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(source.load(ATTACHMENT, { signal: controller.signal })).rejects.toThrow();
  expect(createURL).not.toHaveBeenCalled();
});
