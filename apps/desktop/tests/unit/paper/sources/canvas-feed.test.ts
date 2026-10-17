import { describe, expect, it, vi } from 'vitest';
import { createCanvasFeed } from '../../../../src/renderer/src/paper/sources/canvas-feed';

function fakeDocument() {
  const track = { requestFrame: vi.fn(), stop: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const context = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    captureStream: vi.fn(() => stream),
  };
  const doc = { createElement: vi.fn(() => canvas) } as unknown as Document;
  return { doc, canvas, context, stream, track };
}

const bitmap = (width: number, height: number) =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

describe('createCanvasFeed', () => {
  it('captures the canvas at frame rate 0 and asks for a frame after each draw', () => {
    const { doc, canvas, context, track } = fakeDocument();
    const feed = createCanvasFeed(doc);
    expect(canvas.captureStream).toHaveBeenCalledWith(0);
    const first = bitmap(1920, 1440);
    feed.draw(first);
    expect([canvas.width, canvas.height]).toEqual([1920, 1440]);
    expect(context.drawImage).toHaveBeenCalledWith(first, 0, 0);
    expect(first.close).toHaveBeenCalled();
    expect(track.requestFrame).toHaveBeenCalledTimes(1);
    // The canvas follows each bitmap's size.
    feed.draw(bitmap(1280, 960));
    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
  });

  it('stop ends the stream, and a later draw only closes its bitmap', () => {
    const { doc, context, track } = fakeDocument();
    const feed = createCanvasFeed(doc);
    feed.stop();
    expect(track.stop).toHaveBeenCalled();
    const late = bitmap(64, 48);
    feed.draw(late);
    expect(late.close).toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });
});
