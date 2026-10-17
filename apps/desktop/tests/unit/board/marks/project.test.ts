import { describe, expect, it } from 'vitest';
import {
  containFit,
  rectProjector,
  toScreen,
} from '../../../../src/renderer/src/board/marks/project';

describe('rectProjector', () => {
  it('maps page coordinates onto a flat frame', () => {
    const project = rectProjector(1100, 850);
    expect(project({ x: 0.5, y: 0.5 })).toEqual({ x: 550, y: 425 });
    expect(project({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(project({ x: 1, y: 1 })).toEqual({ x: 1100, y: 850 });
  });
});

describe('containFit', () => {
  it('fits the frame inside the box and centers it', () => {
    expect(containFit({ w: 1100, h: 850 }, { w: 550, h: 600 })).toEqual({
      scale: 0.5,
      x: 0,
      y: 87.5,
    });
    // A wide box letterboxes left and right instead.
    expect(containFit({ w: 1100, h: 850 }, { w: 1408, h: 425 })).toEqual({
      scale: 0.5,
      x: 429,
      y: 0,
    });
  });

  it('gives a zero scale for an empty box or frame, never NaN', () => {
    expect(containFit({ w: 1100, h: 850 }, { w: 0, h: 0 })).toEqual({ scale: 0, x: 0, y: 0 });
    expect(containFit({ w: 0, h: 850 }, { w: 550, h: 600 })).toEqual({
      scale: 0,
      x: 275,
      y: 300,
    });
  });
});

describe('toScreen', () => {
  it('composes the projection and the fit', () => {
    const project = rectProjector(1100, 850);
    const fit = containFit({ w: 1100, h: 850 }, { w: 550, h: 600 });
    expect(toScreen({ x: 0.5, y: 0.5 }, project, fit)).toEqual({ x: 275, y: 300 });
    expect(toScreen({ x: 0, y: 0 }, project, fit)).toEqual({ x: 0, y: 87.5 });
    expect(toScreen({ x: 1, y: 1 }, project, fit)).toEqual({ x: 550, y: 512.5 });
  });
});
