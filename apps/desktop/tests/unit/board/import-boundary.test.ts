// The board's engine boundary (P5-R1): only board/tldraw/** knows tldraw, and only
// board/layout/** knows Graphviz, so another engine (Excalidraw, say) replaces one folder.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(__dirname, '..', '..', '..', 'src', 'renderer', 'src');

/** Every module specifier a file names: static and type imports, re-exports, import() and require(). */
function specifiersOf(source: string): string[] {
  const found = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g,
  );
  return [...found].map((match) => match[1]);
}

/** The renderer's .ts and .tsx files, as forward-slash paths from src/renderer/src. */
function rendererFiles(): string[] {
  return readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter((path) => /\.tsx?$/.test(path));
}

/** The renderer files that import a module `matches` accepts. */
function importersOf(matches: (specifier: string) => boolean): string[] {
  return rendererFiles().filter((path) =>
    specifiersOf(readFileSync(join(RENDERER, path), 'utf8')).some(matches),
  );
}

const isTldraw = (spec: string) =>
  spec === 'tldraw' || spec.startsWith('tldraw/') || spec.startsWith('@tldraw/');
const isViz = (spec: string) => spec === '@viz-js/viz' || spec.startsWith('@viz-js/');

describe('the board engine boundary', () => {
  it('the scan sees every form of import', () => {
    const source = [
      "import { Tldraw } from 'tldraw';",
      'import type { Editor } from "@tldraw/editor";',
      "import 'tldraw/tldraw.css';",
      "export { x } from './x';",
      'const viz = await import(\n  "@viz-js/viz");',
      "const assets = require('@tldraw/assets/imports.vite');",
      'import {\n  a,\n  b,\n} from "../board/engine";',
    ].join('\n');
    expect(specifiersOf(source)).toEqual([
      'tldraw',
      '@tldraw/editor',
      'tldraw/tldraw.css',
      './x',
      '@viz-js/viz',
      '@tldraw/assets/imports.vite',
      '../board/engine',
    ]);
  });

  it('only board/tldraw imports tldraw', () => {
    const importers = importersOf(isTldraw);
    // The scan finds the engine's own imports, so it would find an offender too.
    expect(importers).toContain('board/tldraw/TldrawCanvas.tsx');
    expect(importers.filter((path) => !path.startsWith('board/tldraw/'))).toEqual([]);
  });

  it('only board/layout imports viz', () => {
    const importers = importersOf(isViz);
    expect(importers.filter((path) => !path.startsWith('board/layout/'))).toEqual([]);
  });
});
