// The student's one-click board download: the whole board as it is now, Ada's items and hers, as
// a PNG at full quality (a small board twice its size, engine.ts's snapshot cap), saved through a
// temporary download link named for the session and the day. Pure where it can be, so the name
// and the link are tested without tldraw.
import { currentSession } from '../features/session/current-session';
import { exportBoardPng } from './board-store';

/**
 * The long side asked of the snapshot: large enough that any board the panel can hold comes out
 * at the snapshot's own cap of twice its size, crisp when opened at full size.
 */
export const DOWNLOAD_SIDE = 4096;
/** The most of the session's title that goes in the file name. */
const SLUG_MAX = 60;

/**
 * `tassel-board-<title>-<YYYY-MM-DD>.png`: the session's title as a slug (letters and digits of
 * any script, runs of anything else as one hyphen, at most 60 characters, `untitled` for none),
 * and the local date.
 */
export function boardFileName(title: string | null, date: Date): string {
  const slug =
    (title ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX)
      .replace(/-+$/, '') || 'untitled';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `tassel-board-${slug}-${day}.png`;
}

/**
 * Hands `blob` to the browser as a download named `name`, through a link that lives only for the
 * click. The object URL is released once the download has started from it.
 */
export function saveBlob(blob: Blob, name: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.hidden = true;
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Not at once: Chromium reads the blob after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

/**
 * Downloads the board as a PNG named for the open session and today. False when there's nothing
 * to download: no engine yet, or an empty board.
 */
export async function downloadBoardPng(): Promise<boolean> {
  const blob = await exportBoardPng(DOWNLOAD_SIDE);
  if (!blob) return false;
  saveBlob(blob, boardFileName(currentSession()?.title ?? null, new Date()));
  return true;
}
