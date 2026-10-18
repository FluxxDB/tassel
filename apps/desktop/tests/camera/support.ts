// Camera-spec infrastructure; safe to import in unit tests (no app/device access on import).
import { createServer } from 'node:net';
import spawn from 'cross-spawn';
import { withDeadline } from '../../../../scripts/camera-lifecycle.mjs';

export async function allocateCdpPort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== 'string') resolve(address.port);
        else reject(new Error('Could not allocate a CDP port'));
      });
    });
  });
}

function listenerCommands(port: number): string[] {
  const result = spawn.sync('lsof', ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
    timeout: 1_000,
  });
  if (result.error || result.status !== 0) throw new Error('Could not verify CDP listener');
  const pids = [...new Set(result.stdout.trim().split('\n').filter(Boolean))];
  return pids.map((pid) => {
    if (!/^\d+$/.test(pid)) throw new Error('Invalid CDP listener pid');
    const proc = spawn.sync('ps', ['-p', pid, '-o', 'command='], {
      encoding: 'utf8',
      timeout: 1_000,
    });
    if (proc.error || proc.status !== 0) throw new Error('Could not verify CDP listener process');
    return proc.stdout.trim();
  });
}

export function assertCdpOwner(port: number, tag: string, inspect = listenerCommands): void {
  const commands = inspect(port);
  if (commands.length !== 1 || !commands[0]?.split(/\s+/).includes(`--tassel-camera-run=${tag}`)) {
    throw new Error('CDP listener does not belong to this camera run');
  }
}

/** Hold the creation response until its ID is recorded, before the renderer starts capture. */
export async function captureSessionCreation(
  response: { status(): number; json(): Promise<unknown> },
  ids: Set<string>,
  deliver: () => Promise<void>,
): Promise<void> {
  if (response.status() === 201) {
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id)
      throw new Error('Session creation response has no id');
    ids.add(body.id);
  }
  await deliver();
}

/** The token belongs to the fresh user-data directory. Never use a renderer during cleanup. */
export async function deleteRunSessions(
  serverUrl: string,
  token: string,
  ids: Set<string>,
  send: typeof fetch = fetch,
): Promise<void> {
  const errors: Error[] = [];
  const request = (path: string, method = 'GET') =>
    send(`${serverUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1_500),
    });
  // Always sweep the fresh learner: this also covers a POST that committed but whose response
  // was lost. Existing learners are never used by this spec.
  try {
    const response = await request('/v1/sessions');
    if (!response.ok) throw new Error('Session fallback listing failed');
    const body = (await response.json()) as { items: Array<{ id: string }> };
    for (const item of body.items) ids.add(item.id);
  } catch {
    errors.push(new Error('Session fallback listing failed'));
  }
  for (const id of ids) {
    try {
      const response = await request(`/v1/sessions/${encodeURIComponent(id)}`, 'DELETE');
      if (response.status !== 204 && response.status !== 404) throw new Error('DELETE failed');
    } catch {
      errors.push(new Error(`Frame deletion failed for session ${id}`));
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Frame cleanup failed');
}

/** Deletion cannot block camera release, even on a hung request or a closed renderer. */
export async function cleanupCameraRun({
  deleteFrames,
  shutdown,
  removeUserData,
  timeoutMs = 5_000,
}: {
  deleteFrames: () => Promise<void>;
  shutdown: () => Promise<void>;
  removeUserData: () => void;
  timeoutMs?: number;
}): Promise<void> {
  const errors: unknown[] = [];
  let firstDeletionError: unknown;
  try {
    try {
      await withDeadline(deleteFrames, timeoutMs, 'Frame deletion');
    } catch (error) {
      firstDeletionError = error;
    }
  } finally {
    try {
      await shutdown();
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        // Retry/sweep after capture has stopped, including creations racing the first sweep.
        await withDeadline(deleteFrames, timeoutMs, 'Frame deletion retry');
      } catch (error) {
        errors.push(
          new AggregateError(
            firstDeletionError ? [firstDeletionError, error] : [error],
            'Frame cleanup failed after retry; local frames may remain',
          ),
        );
      } finally {
        try {
          removeUserData();
        } catch (error) {
          errors.push(error);
        }
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Camera cleanup failed');
}
