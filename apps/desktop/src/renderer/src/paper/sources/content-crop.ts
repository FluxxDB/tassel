// Where a captured window's content starts, below its title bar.

/**
 * The height of a captured window's title bar, from a greyscale frame (0–255): the longest run
 * of rows from the top, within the top 15%, that are flat (standard deviation under 4) and the
 * shade of the first row (mean within 6). Only x from 40% of the width is read, which skips the
 * traffic lights. A run under 2% of the height isn't a title bar: 0.
 */
export function findContentTop(gray: Uint8Array, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const lastRow = Math.min(height - 1, Math.floor(0.15 * height));
  const from = Math.floor(0.4 * width);
  const count = width - from;
  let firstMean = 0;
  let band = 0;
  for (let y = 0; y <= lastRow; y += 1) {
    let sum = 0;
    let squares = 0;
    for (let x = from; x < width; x += 1) {
      const value = gray[y * width + x] ?? 0;
      sum += value;
      squares += value * value;
    }
    const mean = sum / count;
    const deviation = Math.sqrt(Math.max(0, squares / count - mean * mean));
    if (y === 0) firstMean = mean;
    if (deviation >= 4 || Math.abs(mean - firstMean) > 6) break;
    band = y + 1;
  }
  return band >= 0.02 * height ? band : 0;
}
