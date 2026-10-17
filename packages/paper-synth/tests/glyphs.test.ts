import { describe, expect, it } from 'vitest';
import { GLYPH_SET, glyph, layoutText } from '../src/glyphs.ts';

describe('glyphs', () => {
  it('covers exactly the characters the statement and the DFA need', () => {
    expect([...GLYPH_SET].sort()).toEqual([...'Baghinrstwy0123q, '].sort());
  });

  it('every glyph in the set has a stroke, and an unknown character throws', () => {
    for (const ch of GLYPH_SET) {
      const g = glyph(ch);
      expect(g.advance).toBeGreaterThan(0);
      if (ch === ' ') {
        expect(g.strokes).toHaveLength(0);
        continue;
      }
      expect(g.strokes.length, ch).toBeGreaterThan(0);
      for (const stroke of g.strokes) {
        expect(stroke.length, ch).toBeGreaterThanOrEqual(2);
        for (const p of stroke) {
          expect(p.x, ch).toBeGreaterThanOrEqual(0);
          expect(p.x, ch).toBeLessThanOrEqual(1);
          expect(p.y, ch).toBeGreaterThanOrEqual(0);
          expect(p.y, ch).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(() => glyph('Z')).toThrow(/"Z"/);
    expect(() => layoutText('q4', { x: 0, y: 0 }, 0.04)).toThrow(/"4"/);
  });

  it('lays a string out left to right at the em size, with its strokes inside its box', () => {
    const run = layoutText('Binary strings that start with 010', { x: 0.1, y: 0.07 }, 0.0386);
    expect(run.strokes.length).toBeGreaterThan(30);
    expect(run.box.x).toBeCloseTo(0.1, 2);
    // About 17 em wide: it fits on the page with room to spare.
    expect(run.box.w).toBeGreaterThan(0.55);
    expect(run.box.w).toBeLessThan(0.75);
    for (const stroke of run.strokes) {
      for (const p of stroke) {
        expect(p.x).toBeGreaterThanOrEqual(run.box.x - 1e-12);
        expect(p.x).toBeLessThanOrEqual(run.box.x + run.box.w + 1e-12);
        expect(p.y).toBeGreaterThanOrEqual(run.box.y - 1e-12);
        expect(p.y).toBeLessThanOrEqual(run.box.y + run.box.h + 1e-12);
      }
    }
  });
});
