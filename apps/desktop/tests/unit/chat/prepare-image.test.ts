import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_MAX_BYTES,
  isSendableImage,
  prepareImage,
  UnreadableImage,
} from '../../../src/renderer/src/features/chat/prepare-image';

function deps(width: number, height: number, sizeAt: (w: number, h: number) => number) {
  const close = vi.fn();
  const encode = vi.fn(
    async (_bitmap: ImageBitmap, w: number, h: number) =>
      ({
        size: sizeAt(w, h),
        type: 'image/jpeg',
      }) as Blob,
  );
  return {
    close,
    encode,
    deps: {
      decode: async () => ({ width, height, close }) as unknown as ImageBitmap,
      encode,
    },
  };
}

describe('preparing one of her images', () => {
  it('shrinks a photo to 2048 px on its long side, keeping its shape', async () => {
    const { deps: d, close } = deps(4032, 3024, () => 1_000_000);
    expect(await prepareImage(new Blob(), d)).toMatchObject({ w: 2048, h: 1536 });
    expect(close).toHaveBeenCalled();
  });

  it('sends a small image at its own size', async () => {
    const { deps: d } = deps(200, 120, () => 9_000);
    expect(await prepareImage(new Blob(), d)).toMatchObject({ w: 200, h: 120 });
  });

  it('shrinks again while the JPEG is over the limit', async () => {
    const { deps: d, encode } = deps(3000, 3000, (w) => (w > 1200 ? IMAGE_MAX_BYTES + 1 : 100));
    const prepared = await prepareImage(new Blob(), d);
    expect(prepared.w).toBeLessThanOrEqual(1200);
    expect(encode.mock.calls.map(([, w]) => w)).toEqual([2048, 1536, 1152]);
  });

  it("fails as unreadable when it can't be decoded", async () => {
    const d = { decode: async () => Promise.reject(new Error('heic')), encode: vi.fn() };
    await expect(prepareImage(new Blob(), d)).rejects.toBeInstanceOf(UnreadableImage);
  });

  it('takes PNG, JPEG, WebP and HEIC, and nothing else', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/heic'])
      expect(isSendableImage({ type })).toBe(true);
    expect(isSendableImage({ type: '', name: 'IMG_0042.HEIC' })).toBe(true);
    expect(isSendableImage({ type: 'image/gif' })).toBe(false);
    expect(isSendableImage({ type: 'text/plain', name: 'notes.txt' })).toBe(false);
  });
});
