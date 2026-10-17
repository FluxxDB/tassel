// board.css can't import MOTION, so this keeps its reveal fade on MOTION's values.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOTION } from '../../../../src/renderer/src/board/motion';

const css = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'src', 'renderer', 'src', 'board', 'tldraw', 'board.css'),
  'utf8',
);

describe('board.css', () => {
  it("fades Ada's shapes in over MOTION.revealMs with MOTION.ease, and not under reduced motion", () => {
    expect(css).toContain(`animation: ada-reveal ${MOTION.revealMs}ms ${MOTION.ease};`);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.tl-shape\[data-shape-id\^="shape:ada\."\] \{\s*animation: none;/,
    );
  });
});
