import type { ScreenPoint } from '../../../shared/screen-bridge';
export function projectPoint(
  point: ScreenPoint,
  bounds: { x: number; y: number; width: number; height: number },
) {
  return { x: bounds.x + point.x * bounds.width, y: bounds.y + point.y * bounds.height };
}
export function viewportChanged(previous: Uint8Array, current: Uint8Array) {
  if (previous.length !== current.length || !current.length) return true;
  let changed = 0;
  for (let i = 0; i < current.length; i++)
    if (Math.abs((current[i] ?? 0) - (previous[i] ?? 0)) > 18) ++changed;
  return changed / current.length > 0.035;
}

/** Match object-fit:contain so expanded preview marks never drift into letterboxing. */
export function containRect(width: number, height: number, boxWidth: number, boxHeight: number) {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const containedWidth = Math.min(boxWidth, width * scale);
  const containedHeight = Math.min(boxHeight, height * scale);
  return {
    x: (boxWidth - containedWidth) / 2,
    y: (boxHeight - containedHeight) / 2,
    width: containedWidth,
    height: containedHeight,
  };
}
