import type { ScreenMark, ScreenPoint } from '../../../shared/screen-bridge';
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

/** Native capture excludes the overlay; add only the student's ink to the tutor's frame. */
export function paintStudentInk(
  context: CanvasRenderingContext2D,
  marks: ScreenMark[],
  width: number,
  height: number,
) {
  context.save();
  context.strokeStyle = '#7952b8';
  context.lineWidth = Math.max(2, width / 500);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const mark of marks) {
    if (mark.author !== 'student' || !mark.points.length) continue;
    context.beginPath();
    mark.points.forEach((point, i) => {
      if (i === 0) context.moveTo(point.x * width, point.y * height);
      else context.lineTo(point.x * width, point.y * height);
    });
    if (mark.points.length === 1) {
      const a = mark.points[0];
      context.lineTo(a.x * width + 0.1, a.y * height + 0.1);
    }
    context.stroke();
  }
  context.restore();
}
