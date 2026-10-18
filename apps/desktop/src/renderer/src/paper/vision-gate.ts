/** Pure capture decisions, shared by the live path and offline tests. */
export const SHARPNESS_FLOOR = 20;
export function laplacianVariance(gray: Uint8ClampedArray, width: number, height: number): number {
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      squares += lap * lap;
      count++;
    }
  }
  return count ? squares / count - (sum / count) ** 2 : 0;
}

export async function captureBurst<T>(
  grab: () => Promise<T>,
  score: (frame: T) => number | Promise<number>,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let best: T | undefined;
    let sharpness = -Infinity;
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(150);
      const frame = await grab();
      const value = await score(frame);
      if (value > sharpness) {
        best = frame;
        sharpness = value;
      }
    }
    if (best !== undefined && sharpness >= SHARPNESS_FLOOR) return best;
    if (!attempt) await sleep(300);
  }
  throw new Error('No sharp frame');
}

/** Large means at least a quarter of the page grid changed. */
export function inkUploadAllowed(now: number, last: number, cells: number, total: number): boolean {
  return now - last >= 10_000 || (total > 0 && cells / total >= 0.25);
}

export async function jpegSharpness(blob: Blob): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No capture context');
    context.drawImage(bitmap, 0, 0, w, h);
    const rgba = context.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    }
    return laplacianVariance(gray, w, h);
  } finally {
    bitmap.close();
  }
}
