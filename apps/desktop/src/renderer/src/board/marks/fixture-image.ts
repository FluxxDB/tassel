// A synthetic "photo" of a student's working, drawn on a canvas when the image demo asks for
// it: four lines solving 2x + 3 = 11 on ruled paper, never a camera frame. Its Set-of-Mark
// boxes (m1–m3) are where the lines are drawn, so `el` targets land on the ink, as a stored
// attachment's would through the server's detection. Only the explicit image demo script
// registers it; the app loads attachments through the API.
import type { DetectedElements } from '@tassel/shared/beats';
import type { ImageSource, LoadedImage } from './image-store';

/** The attachment id the image demo shows. */
export const FIXTURE_IMAGE_ID = 'fixture-image-1';

const W = 960;
const H = 720;
/** The lines of working, each at its baseline; font size 56 px, so a line of ink is ~56 tall. */
const LINES: Array<{ text: string; x: number; y: number }> = [
  { text: '2x + 3 = 11', x: 120, y: 190 },
  { text: '2x = 11 − 3', x: 120, y: 310 },
  { text: '2x = 8', x: 120, y: 430 },
  { text: 'x = 4', x: 120, y: 550 },
];
const FONT_PX = 56;
/** A line's ink box: from its left edge, up to its cap height and down to its descent. */
const box = (line: (typeof LINES)[number], width: number) => ({
  x: line.x - 6,
  y: line.y - FONT_PX * 0.78,
  w: width + 12,
  h: FONT_PX * 1.02,
});
/** Each line's width at 56 px Geist, near enough: the boxes only need to hold the ink. */
const WIDTHS = [312, 318, 170, 140];

export const FIXTURE_IMAGE: {
  w: number;
  h: number;
  detected: DetectedElements;
} = {
  w: W,
  h: H,
  detected: {
    width: W,
    height: H,
    items: [
      { id: 'm1', kind: 'label', box: box(LINES[0], WIDTHS[0]) },
      { id: 'm2', kind: 'label', box: box(LINES[1], WIDTHS[1]) },
      { id: 'm3', kind: 'label', box: box(LINES[3], WIDTHS[3]) },
    ],
  },
};

/** Draws the page and hands it over as a PNG the stage can show. */
export const fixtureImageSource: ImageSource = {
  async load(attachmentId, { signal }) {
    signal.throwIfAborted();
    if (attachmentId !== FIXTURE_IMAGE_ID) {
      throw new Error(`The image demo has no attachment ${attachmentId}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas to draw the fixture image on');
    draw(ctx);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('The fixture image could not be encoded'))),
        'image/png',
      ),
    );
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const image: LoadedImage = {
      url,
      w: W,
      h: H,
      revoke: () => URL.revokeObjectURL(url),
      detected: FIXTURE_IMAGE.detected,
    };
    return image;
  },
};

function draw(ctx: CanvasRenderingContext2D): void {
  // Warm paper, photographed: a little darker toward the edges.
  const shade = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 700);
  shade.addColorStop(0, '#fbf8f1');
  shade.addColorStop(1, '#e9e3d6');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  // Rules every 60 px, and a margin line.
  ctx.strokeStyle = 'rgba(96, 140, 200, 0.35)';
  ctx.lineWidth = 2;
  for (let y = 70; y < H; y += 60) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(W - 40, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(210, 90, 90, 0.5)';
  ctx.beginPath();
  ctx.moveTo(96, 20);
  ctx.lineTo(96, H - 20);
  ctx.stroke();
  // The working, in pencil grey.
  ctx.fillStyle = '#2f2a24';
  ctx.font = `${FONT_PX}px Geist, "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  for (const line of LINES) ctx.fillText(line.text, line.x, line.y);
  // Her own tick beside the answer.
  ctx.strokeStyle = '#2f2a24';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(320, 540);
  ctx.lineTo(340, 562);
  ctx.lineTo(380, 512);
  ctx.stroke();
}
