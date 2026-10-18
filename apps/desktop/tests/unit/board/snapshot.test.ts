// The board snapshot the server asks for on a board turn (its board-snapshot request): the board as
// it is now, a PNG about 1280 px on its long side, posted as base64 for the session, so Ada sees
// what the student drew or moved. Nothing goes when there's no board, and a failure stays quiet.
import type { ApiClient } from '@tassel/shared/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardStore } from '../../../src/renderer/src/board/board-store';
import type { BoardEngine } from '../../../src/renderer/src/board/engine';
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_SIDE,
  sendBoardSnapshot,
} from '../../../src/renderer/src/board/snapshot';

const SESSION = '7c2a5f1e-0b3d-4e8a-9f6c-1d2e3f4a5b6c';
/** A PNG's signature and a few bytes: enough to tell its base64. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250, 251]);
const pngBlob = (bytes: Uint8Array<ArrayBuffer> = PNG) => new Blob([bytes], { type: 'image/png' });

function fakeApi(answer: () => Promise<unknown> = async () => ({ response: ok() })) {
  const POST = vi.fn(answer);
  return { POST, api: { POST } as unknown as ApiClient };
}
const ok = () => new Response(null, { status: 204 });

let debug: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  useBoardStore.getState().reset();
});

describe('sendBoardSnapshot', () => {
  it('exports the board at 1280 px and posts it as base64 PNG for the session', async () => {
    const exportPng = vi.fn(async (_side: number) => pngBlob());
    const { api, POST } = fakeApi();
    await sendBoardSnapshot(api, SESSION, { exportPng });

    expect(exportPng).toHaveBeenCalledWith(SNAPSHOT_SIDE);
    expect(SNAPSHOT_SIDE).toBe(1280);
    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST).toHaveBeenCalledWith('/v1/sessions/{session_id}/board/snapshot', {
      params: { path: { session_id: SESSION } },
      body: { image_png: Buffer.from(PNG).toString('base64'), empty: false },
    });
  });

  it('says at once that an empty or unmounted board has nothing, so Ada never waits', async () => {
    // Live test: every turn on an empty board waited out the server's 1.5 s for nothing.
    const { api, POST } = fakeApi();
    await sendBoardSnapshot(api, SESSION, { exportPng: async () => null });
    // The board store's own export: no engine attached, so no board.
    await sendBoardSnapshot(api, SESSION);
    expect(POST).toHaveBeenCalledTimes(2);
    expect(POST).toHaveBeenCalledWith('/v1/sessions/{session_id}/board/snapshot', {
      params: { path: { session_id: SESSION } },
      body: { empty: true },
    });
  });

  it("exports through the attached engine's snapshot", async () => {
    const snapshot = vi.fn(async (_side: number) => pngBlob());
    const engine: BoardEngine = {
      render() {},
      play: async () => {},
      focus() {},
      onStudentEdit: () => () => {},
      dispose() {},
      snapshot,
    };
    const detach = useBoardStore.getState().attach(engine);
    const { api, POST } = fakeApi();
    await sendBoardSnapshot(api, SESSION);
    detach();
    expect(snapshot).toHaveBeenCalledWith(SNAPSHOT_SIDE);
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it('exports smaller until the PNG is under 1.8 MiB', async () => {
    const big = pngBlob(new Uint8Array(SNAPSHOT_MAX_BYTES + 1));
    const exportPng = vi.fn(async (side: number) => (side >= 1000 ? big : pngBlob()));
    const { api, POST } = fakeApi();
    await sendBoardSnapshot(api, SESSION, { exportPng });

    const sides = exportPng.mock.calls.map(([side]) => side);
    expect(sides[0]).toBe(1280);
    expect(sides.length).toBeGreaterThan(1);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).toBeLessThan(sides[i - 1] as number);
    expect(POST).toHaveBeenCalledTimes(1);
    const body = (POST.mock.calls[0] as unknown as [string, { body: { image_png: string } }])[1]
      .body;
    expect(body.image_png).toBe(Buffer.from(PNG).toString('base64'));
    expect(SNAPSHOT_MAX_BYTES).toBeLessThan(2 * 1024 * 1024);
  });

  it('gives up, saying it has no picture, when even a small export is too big', async () => {
    const big = pngBlob(new Uint8Array(SNAPSHOT_MAX_BYTES + 1));
    const exportPng = vi.fn(async () => big);
    const { api, POST } = fakeApi();
    await sendBoardSnapshot(api, SESSION, { exportPng });
    expect(exportPng.mock.calls.length).toBeLessThan(10);
    expect(POST).toHaveBeenCalledOnce();
    expect(POST).toHaveBeenCalledWith('/v1/sessions/{session_id}/board/snapshot', {
      params: { path: { session_id: SESSION } },
      body: { empty: true },
    });
  });

  it('never throws: a failed export, a refused POST or a network error is logged at debug', async () => {
    const failing = fakeApi(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      sendBoardSnapshot(failing.api, SESSION, { exportPng: async () => pngBlob() }),
    ).resolves.toBeUndefined();
    const refused = fakeApi(async () => ({
      error: { detail: 'Invalid PNG' },
      response: new Response(null, { status: 422 }),
    }));
    await expect(
      sendBoardSnapshot(refused.api, SESSION, { exportPng: async () => pngBlob() }),
    ).resolves.toBeUndefined();
    const { api, POST } = fakeApi();
    await expect(
      sendBoardSnapshot(api, SESSION, {
        exportPng: async () => {
          throw new Error('export failed');
        },
      }),
    ).resolves.toBeUndefined();
    expect(POST).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(3);
  });
});
