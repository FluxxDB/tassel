// packages/shared/tests/tokens.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', 'src');
const tokens = readFileSync(join(root, 'styles/tokens.css'), 'utf8');
const fonts = readFileSync(join(root, 'styles/fonts.css'), 'utf8');
const base = readFileSync(join(root, 'styles/base.css'), 'utf8');

describe('design tokens', () => {
  it.each([
    ['--color-ink', '#222222'],
    ['--color-bone', '#fff9f3'],
    ['--color-iris', '#c094e4'],
    ['--color-iris-ink', '#7d4fc4'],
    ['--color-smoke-text', '#6b6966'],
    ['--color-live', '#e5484d'],
    ['--color-sky', '#ccdff1'],
    ['--color-hairline', '#ece5dc'],
    ['--radius-pill', '9999px'],
    ['--radius-card', '16px'],
  ])('defines %s as %s', (name, value) => {
    expect(tokens).toContain(`${name}: ${value};`);
  });
  it('puts Geist first and Pretendard second in the sans stack', () => {
    expect(tokens).toMatch(/--font-sans:\s*"Geist",\s*"Pretendard Variable"/);
  });
  it('limits Pretendard to Hangul ranges', () => {
    expect(fonts).toContain(
      'unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7FF, U+3000-303F;',
    );
  });
  it('resets tracking for Korean', () => {
    expect(base).toMatch(/:lang\(ko\)\s*\{[^}]*letter-spacing:\s*0;[^}]*line-height:\s*1\.6;/);
  });
  it('keeps Hangul lab labels untracked too', () => {
    // .mono sets +0.025em and, as a class, outranks :lang(ko) alone.
    expect(base).toMatch(/\.mono:lang\(ko\)\s*\{\s*letter-spacing:\s*0;/);
  });
  it('breaks Korean between words, never inside one, unless a word overflows (R28)', () => {
    expect(base).toMatch(
      /:lang\(ko\)\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*break-word;/,
    );
  });
  it("narrows Geist Mono's 0.6em space between Hangul words in lab labels", () => {
    expect(base).toMatch(/\.mono:lang\(ko\)\s*\{[^}]*word-spacing:\s*-0\.3em;/);
  });
  it.each(['Geist-Variable.woff2', 'GeistMono-Variable.woff2', 'PretendardVariable.woff2'])(
    'ships %s',
    (f) => {
      expect(existsSync(join(root, 'fonts', f))).toBe(true);
    },
  );
});
