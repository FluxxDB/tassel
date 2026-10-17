import { ApiError, createApiClient } from '@tassel/shared/api';
import { describe, expect, it } from 'vitest';
import type { FrameMetaJson } from '../../../../src/renderer/src/paper/upload/frame-meta';
import {
  type FrameOut,
  FramesApiError,
  getFrameImage,
  listFrames,
  uploadFrame,
} from '../../../../src/renderer/src/paper/upload/frames-api';

const BASE = 'http://127.0.0.1:8799';

const META: FrameMetaJson = {
  reason: 'ink',
  source: 'fake-clip',
  captured_at: '2026-10-17T14:32:05.120Z',
  page_found: true,
  page_quad: [
    { x: 240, y: 120 },
    { x: 1040, y: 132 },
    { x: 1032, y: 750 },
    { x: 232, y: 738 },
  ],
  crop_rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
  mask: { cols: 50, rows: 38, cells: [[5, 12]] },
  detector: { changed_cells: 1, ink_pixels: 31, erase_pixels: 0, version: 'p3.1' },
};

const FRAME: FrameOut = {
  id: '6f1d2a7e-0000-4000-8000-000000000001',
  session_id: 'session-1',
  seq: 1,
  reason: 'ink',
  source: 'fake-clip',
  captured_at: '2026-10-17T14:32:05.120000Z',
  created_at: '2026-10-17T14:32:05.300000Z',
  width: 64,
  height: 48,
  has_crop: true,
  bytes: 631,
  page_found: true,
  page_quad: META.page_quad,
  crop_rect: META.crop_rect,
  mask: META.mask,
};

/** Synthetic stand-ins for JPEG bytes: SOI, one marker byte, EOI. */
const bytes = (marker: number) => new Uint8Array([0xff, 0xd8, marker, 0xff, 0xd9]);
const jpeg = (marker: number) => new Blob([bytes(marker)], { type: 'image/jpeg' });

/** A client on a fake server: `answer` sees each request the API client sends. */
function clientAnswering(answer: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return answer(request);
  };
  const api = createApiClient({
    baseUrl: BASE,
    getToken: async () => 'token-1',
    refreshToken: async () => 'token-2',
    fetch,
  });
  const sent = (n = 0): Request => requests[n];
  return { api, sent };
}

async function partBytes(form: FormData, name: string): Promise<Uint8Array> {
  const part = form.get(name);
  if (!(part instanceof Blob)) throw new Error(`${name} isn't a file part`);
  return new Uint8Array(await part.arrayBuffer());
}

describe('uploadFrame', () => {
  it('uploadFrame posts frame, crop and meta parts to /v1/sessions/<id>/frames', async () => {
    let form: FormData | undefined;
    const { api, sent } = clientAnswering(async (request) => {
      form = await request.clone().formData();
      return Response.json(FRAME, { status: 201 });
    });

    await expect(
      uploadFrame(api, 'session-1', { full: jpeg(1), crop: jpeg(2), meta: META }),
    ).resolves.toStrictEqual(FRAME);

    expect(sent().method).toBe('POST');
    expect(sent().url).toBe(`${BASE}/v1/sessions/session-1/frames`);
    expect(sent().headers.get('Authorization')).toBe('Bearer token-1');
    expect(sent().headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    if (!form) throw new Error('no form was sent');
    expect([...form.keys()]).toStrictEqual(['frame', 'crop', 'meta']);
    expect(await partBytes(form, 'frame')).toStrictEqual(bytes(1));
    expect(await partBytes(form, 'crop')).toStrictEqual(bytes(2));
    expect(JSON.parse(String(form.get('meta')))).toStrictEqual(META);
  });

  it('sends no crop part when the frame has none', async () => {
    let keys: string[] = [];
    const { api } = clientAnswering(async (request) => {
      keys = [...(await request.formData()).keys()];
      return Response.json({ ...FRAME, has_crop: false }, { status: 201 });
    });

    await uploadFrame(api, 'session-1', {
      full: jpeg(1),
      crop: null,
      meta: { ...META, reason: 'page', crop_rect: null, mask: null },
    });

    expect(keys).toStrictEqual(['frame', 'meta']);
  });

  it("throws an ApiError carrying the status, the body and a 429's Retry-After", async () => {
    const { api } = clientAnswering(() =>
      Response.json({ detail: 'too recent' }, { status: 429, headers: { 'Retry-After': '3' } }),
    );

    const error = await uploadFrame(api, 's', { full: jpeg(1), crop: null, meta: META }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(FramesApiError);
    expect(error).toMatchObject({ status: 429, body: { detail: 'too recent' }, retryAfterS: 3 });
  });

  it.each([
    ['422 without the header', 422, {}, null],
    ['an HTTP date', 429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }, null],
    ['a negative delay', 429, { 'Retry-After': '-1' }, null],
  ])('reads no Retry-After from %s', async (_name, status, headers, expected) => {
    const { api } = clientAnswering(() => Response.json({ detail: 'no' }, { status, headers }));
    const error = await uploadFrame(api, 's', { full: jpeg(1), crop: null, meta: META }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status, retryAfterS: expected });
  });
});

describe('listFrames', () => {
  it('asks for the newest frames, up to the limit', async () => {
    const { api, sent } = clientAnswering(() => Response.json({ items: [FRAME] }));

    await expect(listFrames(api, 'session-1', 2)).resolves.toStrictEqual([FRAME]);

    expect(sent().method).toBe('GET');
    expect(sent().url).toBe(`${BASE}/v1/sessions/session-1/frames?limit=2`);
  });

  it("leaves the limit to the server's default when none is given", async () => {
    const { api, sent } = clientAnswering(() => Response.json({ items: [] }));
    await expect(listFrames(api, 'session-1')).resolves.toStrictEqual([]);
    expect(sent().url).toBe(`${BASE}/v1/sessions/session-1/frames`);
  });

  it('throws an ApiError for a session that is gone', async () => {
    const { api } = clientAnswering(() => Response.json({ detail: 'gone' }, { status: 404 }));
    await expect(listFrames(api, 'session-1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('getFrameImage', () => {
  it("fetches one part's JPEG as a blob", async () => {
    const { api, sent } = clientAnswering(
      () => new Response(bytes(7), { headers: { 'Content-Type': 'image/jpeg' } }),
    );

    const image = await getFrameImage(api, 'session-1', 'frame-1', 'crop');

    expect(sent().url).toBe(`${BASE}/v1/sessions/session-1/frames/frame-1/image?part=crop`);
    expect(image.type).toBe('image/jpeg');
    expect(new Uint8Array(await image.arrayBuffer())).toStrictEqual(bytes(7));
  });

  it('throws an ApiError when the image is missing', async () => {
    const { api } = clientAnswering(() => Response.json({ detail: 'no crop' }, { status: 404 }));
    await expect(getFrameImage(api, 's', 'f', 'crop')).rejects.toBeInstanceOf(ApiError);
  });
});
