import { createApiClient } from '@tassel/shared/api';
import { type PaperElements, parseAction } from '@tassel/shared/beats';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveTarget } from '../../../../src/renderer/src/board/marks/geometry';
import { useMarksStore } from '../../../../src/renderer/src/board/marks/marks-store';
import { createPaperSource } from '../../../../src/renderer/src/board/marks/paper-source';
import { registerSnapshotSource } from '../../../../src/renderer/src/board/marks/snapshot-sources';

const frame = { kind: 'paper', id: 'frame-1', capturedAt: '2026-10-17T14:32:05Z' } as const;
const elements: PaperElements = {
  states: {},
  edges: {},
  detected: {
    width: 1000,
    height: 800,
    items: [{ id: 'm3', kind: 'circle', box: { x: 100, y: 200, w: 160, h: 160 } }],
  },
};
afterEach(() => useMarksStore.getState().reset());

function setup(status = 200) {
  const requests: Request[] = [];
  const api = createApiClient({
    baseUrl: 'http://localhost:8852',
    getToken: async () => 'test-token',
    refreshToken: async () => 'test-token',
    fetch: async (request) => {
      requests.push(request as Request);
      return new Response(status === 200 ? new Blob(['jpeg'], { type: 'image/jpeg' }) : '{}', {
        status,
      });
    },
  });
  const revoke = vi.fn();
  const createURL = vi.fn(() => 'blob:paper');
  const source = createPaperSource({
    api,
    sessionId: () => 'session-1',
    createObjectURL: createURL,
    revokeObjectURL: revoke,
  });
  return { source, requests, revoke, createURL };
}

it('loads the authenticated flattened image and resolves m3 to its pixel box', async () => {
  const { source, requests, revoke } = setup();
  const off = registerSnapshotSource('paper', source);
  try {
    const freeze = parseAction({ kind: 'paper.freeze', frame, elements });
    expect(freeze).not.toBeNull();
    useMarksStore.getState().apply(freeze as Extract<typeof freeze, { kind: 'paper.freeze' }>);
    useMarksStore
      .getState()
      .apply({ kind: 'paper.mark', mark: { type: 'circle', id: 'a', target: { el: 'm3' } } });
    await vi.waitFor(() => expect(useMarksStore.getState().status).toBe('frozen'));
    const snapshot = useMarksStore.getState().snapshot;
    if (!snapshot) throw new Error('no frozen snapshot');
    expect(requests[0].url).toBe('http://localhost:8852/v1/sessions/session-1/frames/frame-1/page');
    expect(requests[0].headers.get('Authorization')).toBe('Bearer test-token');
    expect(snapshot.capturedAt).toBe(frame.capturedAt);
    expect(snapshot.image).toMatchObject({ w: 1000, h: 800, url: 'blob:paper' });
    const target = resolveTarget({ el: 'm3' }, snapshot.elements, snapshot.project, {
      x: 10,
      y: 20,
      scale: 0.5,
    });
    expect(target?.bbox).toEqual({ x: 60, y: 120, w: 80, h: 80 });
    expect(useMarksStore.getState().marks).toHaveLength(1);
    expect(
      resolveTarget({ el: 'm99' }, elements, snapshot.project, { x: 0, y: 0, scale: 1 }),
    ).toBeNull();
    useMarksStore.getState().goLive();
    expect(revoke).toHaveBeenCalledWith('blob:paper');
  } finally {
    off();
  }
});

it('rejects missing context, failed HTTP and an aborted load without creating a URL', async () => {
  const { source, createURL } = setup(404);
  await expect(
    source.load(frame, { signal: new AbortController().signal, elements }),
  ).rejects.toThrow();
  await expect(source.load(frame, { signal: new AbortController().signal })).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(source.load(frame, { signal: controller.signal, elements })).rejects.toThrow();
  expect(createURL).not.toHaveBeenCalled();
});
