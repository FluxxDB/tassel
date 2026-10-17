// The debug heatmap (TASSEL_PAPER_DEBUG=1): what the change detector compares, drawn over the
// live feed for tuning. Changed cells are sky, solid cells ink, and the page quad a dashed ink
// line. Each cell goes from page coordinates to the frame through the page's homography, then
// to the panel through the video's own transform, so it lands on the paper it measured.
import { useEffect, useRef } from 'react';
import type { DetectorStats, NormRect, Pt, Quad } from '../contracts';
import type { FeedTransform, Size } from '../crop-transform';
import { applyH, homography, invertH, type Mat3 } from '../detector/homography';

export interface HeatmapProps {
  stats: DetectorStats;
  /** The video's native size. */
  video: Size;
  /** The feed's content inside the video (a window capture's, below its title bar), or all of it. */
  crop: NormRect | null;
  /** The video's place in the panel (cropTransform). */
  transform: FeedTransform;
  /** The panel's size, in CSS pixels. */
  box: Size;
}

const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const CHANGED_ALPHA = 0.55;
const SOLID_ALPHA = 0.25;
const QUAD_LINE = 1.5;
const QUAD_DASH = [6, 4];

export function Heatmap({ stats, video, crop, transform, box }: HeatmapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ratio = globalThis.devicePixelRatio || 1;

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const { quad, cols, rows } = stats;
    if (!quad || cols <= 0 || rows <= 0 || transform.scale <= 0) return;

    let pageToFrame: Mat3;
    try {
      pageToFrame = invertH(homography(quad, UNIT));
    } catch {
      return; // a degenerate quad: nothing to place cells on
    }
    // Frame (content) pixels → the panel's CSS pixels.
    const offsetX = (crop?.x ?? 0) * video.w;
    const offsetY = (crop?.y ?? 0) * video.h;
    const toPanel = (p: Pt): Pt => ({
      x: transform.x + (offsetX + p.x) * transform.scale,
      y: transform.y + (offsetY + p.y) * transform.scale,
    });
    const fromPage = (u: number, v: number) => toPanel(applyH(pageToFrame, { x: u, y: v }));
    const trace = (corners: Pt[]) => {
      ctx.beginPath();
      corners.forEach((corner, index) => {
        if (index === 0) ctx.moveTo(corner.x, corner.y);
        else ctx.lineTo(corner.x, corner.y);
      });
      ctx.closePath();
    };
    const cell = (index: number) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const [u0, u1, v0, v1] = [col / cols, (col + 1) / cols, row / rows, (row + 1) / rows];
      trace([fromPage(u0, v0), fromPage(u1, v0), fromPage(u1, v1), fromPage(u0, v1)]);
      ctx.fill();
    };

    const colors = getComputedStyle(element);
    const sky = colors.getPropertyValue('--heat-changed').trim();
    const ink = colors.getPropertyValue('--heat-ink').trim();

    ctx.globalAlpha = CHANGED_ALPHA;
    if (sky) ctx.fillStyle = sky;
    for (const index of stats.changed) cell(index);

    ctx.globalAlpha = SOLID_ALPHA;
    if (ink) ctx.fillStyle = ink;
    for (const index of stats.solid) cell(index);

    ctx.globalAlpha = 1;
    if (ink) ctx.strokeStyle = ink;
    ctx.lineWidth = QUAD_LINE;
    ctx.setLineDash(QUAD_DASH);
    trace(quad.map(toPanel));
    ctx.stroke();
    ctx.setLineDash([]);
  }, [stats, video, crop, transform, box, ratio]);

  return (
    <canvas
      ref={canvas}
      data-testid="paper-heatmap"
      width={Math.max(1, Math.round(box.w * ratio))}
      height={Math.max(1, Math.round(box.h * ratio))}
      style={{ width: `${box.w}px`, height: `${box.h}px` }}
      // The colors come from the tokens, through custom properties the effect reads.
      className="pointer-events-none absolute top-0 left-0 [--heat-changed:var(--color-sky)] [--heat-ink:var(--color-ink)]"
    />
  );
}
