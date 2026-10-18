// One of her images, made ready to send before it leaves the app: decoded, shrunk to 2048 px on
// its long side (what the server keeps anyway), and re-encoded as a JPEG under the server's
// 8 MiB, smaller again while it's too big (board/snapshot.ts does the same for the board). An
// image Chromium can't decode (HEIC, some of the time) fails as unreadable, which the composer
// says.
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic';
const ACCEPTED = new Set(IMAGE_ACCEPT.split(','));

/** The long side asked of the first encode, in px. */
export const IMAGE_SIDE = 2048;
/** Under the server's 8 MiB, with room to spare. */
export const IMAGE_MAX_BYTES = 7 * 1024 * 1024;
const SHRINK = 0.75;
const MIN_SIDE = 320;
const QUALITY = 0.86;

export interface PreparedImage {
  blob: Blob;
  w: number;
  h: number;
}

export class UnreadableImage extends Error {
  constructor() {
    super("This image couldn't be read");
  }
}

/** Whether a file or clipboard item is one of the images she can send. */
export function isSendableImage(file: { type: string; name?: string }): boolean {
  return ACCEPTED.has(file.type) || (file.type === '' && /\.hei[cf]$/iu.test(file.name ?? ''));
}

export interface PrepareDeps {
  decode(file: Blob): Promise<ImageBitmap>;
  encode(bitmap: ImageBitmap, w: number, h: number): Promise<Blob>;
}

const browser: PrepareDeps = {
  decode: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
  encode: async (bitmap, w, h) => {
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d');
    if (!context) throw new UnreadableImage();
    // JPEG has no alpha: a transparent PNG goes on white, not black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
    context.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  },
};

export async function prepareImage(
  file: Blob,
  deps: PrepareDeps = browser,
): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await deps.decode(file);
  } catch {
    throw new UnreadableImage();
  }
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    if (!(long > 0)) throw new UnreadableImage();
    // A small image is sent at its own size; a big one shrinks until it fits.
    for (let side = Math.min(IMAGE_SIDE, long); ; side = Math.round(side * SHRINK)) {
      const scale = side / long;
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const blob = await deps.encode(bitmap, w, h);
      if (blob.size <= IMAGE_MAX_BYTES) return { blob, w, h };
      if (side * SHRINK < MIN_SIDE) throw new UnreadableImage();
    }
  } finally {
    bitmap.close?.();
  }
}
