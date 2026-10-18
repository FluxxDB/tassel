import { createApiClient } from '@tassel/shared/api';
import { afterEach, expect, it, vi } from 'vitest';
import { createAttachmentSource } from '../../../../src/renderer/src/board/marks/attachment-source';
import {
  applyImageAction,
  registerImageSource,
  useImageStore,
} from '../../../../src/renderer/src/board/marks/image-store';

const ATTACHMENT = '0f6a1d2e-7b3c-4d5e-8f90-1a2b3c4d5e6f';

afterEach(() => useImageStore.getState().reset());

function setup(status = 200, sessionId: string | null = 'session-1') {
  const requests: Request[] = [];
  const api = createApiClient({
    baseUrl: 'http://localhost:8852',
    getToken: async () => 'test-token',
    refreshToken: async () => 'test-token',
    fetch: async (request) => {
      requests.push(request as Request);
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

it('loads the attachment with the device token and measures it', async () => {
  const { source, requests, revoke, measure } = setup();
  const off = registerImageSource(source);
  try {
    applyImageAction({ kind: 'image.show', attachmentId: ATTACHMENT });
    await vi.waitFor(() => expect(useImageStore.getState().status).toBe('shown'));
    const image = useImageStore.getState().image;
    if (!image) throw new Error('no image shown');
    expect(requests[0].url).toBe(
      `http://localhost:8852/v1/sessions/session-1/attachments/${ATTACHMENT}`,
    );
    expect(requests[0].headers.get('Authorization')).toBe('Bearer test-token');
    expect(measure).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ url: 'blob:attachment', w: 1200, h: 900 });
    expect(image.detected).toBeUndefined();
    image.revoke();
    expect(revoke).toHaveBeenCalledWith('blob:attachment');
  } finally {
    off();
  }
});

it('fails when the server has no such attachment, leaving her paper up', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { source, createURL } = setup(404);
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
  const { source, requests } = setup(200, null);
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
