// What the renderer downloads (the board as a PNG, board/download.ts) lands in the student's
// Downloads folder under the name the renderer gave it, with no dialog: one click, one file. A
// name already taken gets a counter. On macOS the Downloads stack bounces when it's done, the
// system's own way of saying so. TASSEL_DOWNLOAD_DIR (E2E) puts the files somewhere else.
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import type { DownloadItem, Session } from 'electron';

export interface DownloadsDeps {
  /** Where the files go. */
  dir: string;
  /** Says a finished download is in the Downloads folder: app.dock.downloadFinished on macOS. */
  finished?: (path: string) => void;
  exists?: (path: string) => boolean;
}

/** The first of `name`, `name-2`, `name-3`… in `dir` that doesn't exist yet. */
export function freePath(
  dir: string,
  name: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const { name: stem, ext } = parse(name);
  let path = join(dir, name);
  for (let n = 2; exists(path); n += 1) path = join(dir, `${stem}-${n}${ext}`);
  return path;
}

/** Saves each download of `session` into `deps.dir`, past Electron's save dialog. */
export function registerDownloads(
  session: Pick<Session, 'on'>,
  { dir, finished, exists }: DownloadsDeps,
): void {
  session.on('will-download', (_event, item: DownloadItem) => {
    const path = freePath(dir, item.getFilename() || 'download', exists);
    item.setSavePath(path);
    item.once('done', (_done, state) => {
      if (state === 'completed') finished?.(path);
    });
  });
}
