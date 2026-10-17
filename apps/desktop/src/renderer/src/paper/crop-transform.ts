// How the paper panel fits the feed: the crop region (a window capture's content below its title
// bar, or the whole frame) contain-fit and centred in the panel.
import type { NormRect } from './contracts';

export interface Size {
  w: number;
  h: number;
}

/** Translate the video to (x, y), then scale it, both in CSS pixels, from its top left. */
export interface FeedTransform {
  scale: number;
  x: number;
  y: number;
}

const WHOLE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The transform that contain-fits `crop` (0–1 of the video) into `box`, centred. Until the video
 * and the box both have a size, the scale is 0: nothing shows yet.
 */
export function cropTransform(video: Size, crop: NormRect | null, box: Size): FeedTransform {
  const region = crop ?? WHOLE;
  const width = region.w * video.w;
  const height = region.h * video.h;
  if (width <= 0 || height <= 0 || box.w <= 0 || box.h <= 0) return { scale: 0, x: 0, y: 0 };
  const scale = Math.min(box.w / width, box.h / height);
  return {
    scale,
    x: (box.w - width * scale) / 2 - region.x * video.w * scale,
    y: (box.h - height * scale) / 2 - region.y * video.h * scale,
  };
}

/** A CSS clip-path that shows only `crop` of the element it's on, in its own coordinates. */
export function cropClipPath(crop: NormRect | null): string | undefined {
  if (!crop) return undefined;
  const percent = (n: number) => `${(Math.max(0, n) * 100).toFixed(4)}%`;
  const top = percent(crop.y);
  const right = percent(1 - crop.x - crop.w);
  const bottom = percent(1 - crop.y - crop.h);
  const left = percent(crop.x);
  return `inset(${top} ${right} ${bottom} ${left})`;
}
