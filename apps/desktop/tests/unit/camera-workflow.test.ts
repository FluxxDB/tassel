import { describe, expect, it } from 'vitest';
import * as camera from '../camera/support';

describe('camera teardown without a device or Electron', () => {
  it('always releases processes and user data when frame deletion throws or hangs', async () => {
    for (const deletion of [
      () => Promise.reject(new Error('store unavailable')),
      () => new Promise<void>(() => {}),
    ]) {
      const actions: string[] = [];
      await expect(
        camera.cleanupCameraRun({
          deleteFrames: deletion,
          shutdown: async () => {
            actions.push('shutdown');
          },
          removeUserData: () => {
            actions.push('remove');
          },
          timeoutMs: 5,
        }),
      ).rejects.toThrow('Frame cleanup failed');
      expect(actions).toEqual(['shutdown', 'remove']);
    }
  });

  it('retries frame cleanup after stopping capture and preserves shutdown errors', async () => {
    const actions: string[] = [];
    await expect(
      camera.cleanupCameraRun({
        deleteFrames: async () => {
          actions.push('delete');
        },
        shutdown: async () => {
          actions.push('shutdown');
          throw new Error('stuck helper');
        },
        removeUserData: () => {
          actions.push('remove');
        },
      }),
    ).rejects.toThrow('stuck helper');
    expect(actions).toEqual(['delete', 'shutdown', 'delete', 'remove']);
  });

  it('a successful retry recovers a transient deletion failure after camera release', async () => {
    let attempts = 0;
    const actions: string[] = [];
    await camera.cleanupCameraRun({
      deleteFrames: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
      },
      shutdown: async () => {
        actions.push('shutdown');
      },
      removeUserData: () => {
        actions.push('remove');
      },
    });
    expect(attempts).toBe(2);
    expect(actions).toEqual(['shutdown', 'remove']);
  });

  it('records the creation id before the renderer can fail its UI assertions', async () => {
    const ids = new Set<string>();
    await expect(
      camera.captureSessionCreation(
        {
          status: () => 201,
          json: async () => ({ id: 'created-session' }),
        },
        ids,
        async () => {
          expect([...ids]).toEqual(['created-session']);
          throw new Error('stage never appeared');
        },
      ),
    ).rejects.toThrow('stage never appeared');
    expect([...ids]).toEqual(['created-session']);
  });

  it('lists and deletes only the fresh learner sessions when the creation response was lost', async () => {
    const requests: string[] = [];
    const send: typeof fetch = async (input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer dummy-device-token');
      expect(init?.signal).toBeDefined();
      const url = String(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      return init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ items: [{ id: 'lost-session' }] });
    };
    await camera.deleteRunSessions('http://local', 'dummy-device-token', new Set(), send);
    expect(requests).toEqual([
      'GET http://local/v1/sessions',
      'DELETE http://local/v1/sessions/lost-session',
    ]);
  });

  it('deletes a recorded id even if fallback listing fails and reports failed deletion', async () => {
    const deleted: string[] = [];
    await expect(
      camera.deleteRunSessions(
        'http://local',
        'dummy',
        new Set(['early-id']),
        async (input, init) => {
          if (init?.method === 'DELETE') {
            deleted.push(String(input));
            return new Response(null, { status: 503 });
          }
          throw new Error('offline');
        },
      ),
    ).rejects.toThrow('Frame cleanup failed');
    expect(deleted).toEqual(['http://local/v1/sessions/early-id']);
  });

  it('rejects a CDP listener owned by another app before attaching or closing it', () => {
    expect(() =>
      camera.assertCdpOwner(9334, 'this-run', () => ['Electron --tassel-camera-run=other-run']),
    ).toThrow('CDP');
    expect(() =>
      camera.assertCdpOwner(9334, 'this-run', () => [
        'Electron --tassel-camera-run=this-run-extra',
      ]),
    ).toThrow('CDP');
    expect(() =>
      camera.assertCdpOwner(49152, 'this-run', () => [
        'Electron /out/main.js --tassel-camera-run=this-run',
      ]),
    ).not.toThrow();
  });
});
