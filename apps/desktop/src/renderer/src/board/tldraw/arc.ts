import type { Pt } from '@tassel/shared/beats';

/** n points on a circular arc. Positive bend is left of start→end on a y-down page. */
export function sampleArc(start: Pt, end: Pt, bend: number, n: number): Pt[] {
  const count = Math.max(0, Math.floor(n));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (count <= 1) return count === 1 ? [{ ...start }] : [];
  if (Math.abs(bend) < 1e-8 || length < 1e-8) {
    return Array.from({ length: count }, (_, i) => ({
      x: start.x + (dx * i) / (count - 1),
      y: start.y + (dy * i) / (count - 1),
    }));
  }
  const normal = { x: dy / length, y: -dx / length };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const offset = bend / 2 - (length * length) / (8 * bend);
  const center = { x: midpoint.x + normal.x * offset, y: midpoint.y + normal.y * offset };
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const angle = Math.atan2(start.y - center.y, start.x - center.x);
  // Sagitta/chord form also handles major arcs, essential for self-loops.
  const sweep = 4 * Math.atan2(2 * bend, length);
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return { ...start };
    if (i === count - 1) return { ...end };
    const a = angle + (sweep * i) / (count - 1);
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
}
