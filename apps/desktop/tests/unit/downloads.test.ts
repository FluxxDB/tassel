// The main process saves what the renderer downloads straight into the Downloads folder (or
// TASSEL_DOWNLOAD_DIR), under the renderer's name, with a counter when the name is taken.
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { downloadDir } from '../../src/main/config';
import { freePath, registerDownloads } from '../../src/main/downloads';

const { app } = vi.hoisted(() => ({
  app: { getPath: vi.fn((name: string) => `/home/her/${name}`) },
}));
vi.mock('electron', () => ({ app }));

describe('freePath', () => {
  it('keeps the name when nothing has it, else counts from 2', () => {
    const taken = new Set([
      join('/dl', 'tassel-board-x-2026-10-18.png'),
      join('/dl', 'tassel-board-x-2026-10-18-2.png'),
    ]);
    const exists = (path: string) => taken.has(path);
    expect(freePath('/dl', 'other.png', exists)).toBe(join('/dl', 'other.png'));
    expect(freePath('/dl', 'tassel-board-x-2026-10-18.png', exists)).toBe(
      join('/dl', 'tassel-board-x-2026-10-18-3.png'),
    );
  });
});

describe('downloadDir', () => {
  it("is the system's Downloads folder, or TASSEL_DOWNLOAD_DIR", () => {
    expect(downloadDir({})).toBe('/home/her/downloads');
    expect(downloadDir({ TASSEL_DOWNLOAD_DIR: '/tmp/e2e-dl' })).toBe('/tmp/e2e-dl');
  });
});

describe('registerDownloads', () => {
  /** A session that hands over its will-download listener, and an item as Electron makes one. */
  function setUp(exists: (path: string) => boolean = () => false) {
    let listener: ((event: unknown, item: unknown) => void) | undefined;
    const session = {
      on: vi.fn((_name: string, fn: (event: unknown, item: unknown) => void) => {
        listener = fn;
      }),
    };
    const finished = vi.fn();
    registerDownloads(session as never, { dir: '/dl', finished, exists });
    const item = {
      getFilename: () => 'tassel-board-x-2026-10-18.png',
      setSavePath: vi.fn(),
      once: vi.fn(),
    };
    if (!listener) throw new Error('no will-download listener');
    listener({}, item);
    return { item, finished, session };
  }

  it("saves each download under the renderer's name in the folder, with no dialog", () => {
    const { item, session } = setUp();
    expect(session.on).toHaveBeenCalledWith('will-download', expect.any(Function));
    expect(item.setSavePath).toHaveBeenCalledWith(join('/dl', 'tassel-board-x-2026-10-18.png'));
  });

  it('counts a taken name up, and reports the file once it has completed', () => {
    const { item, finished } = setUp(
      (path) => path === join('/dl', 'tassel-board-x-2026-10-18.png'),
    );
    expect(item.setSavePath).toHaveBeenCalledWith(join('/dl', 'tassel-board-x-2026-10-18-2.png'));
    const [event, done] = item.once.mock.calls[0] as [string, (e: unknown, state: string) => void];
    expect(event).toBe('done');
    done({}, 'cancelled');
    expect(finished).not.toHaveBeenCalled();
    done({}, 'completed');
    expect(finished).toHaveBeenCalledWith(join('/dl', 'tassel-board-x-2026-10-18-2.png'));
  });
});
