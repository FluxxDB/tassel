import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveAppFile } from '../../src/main/app-protocol';

vi.mock('electron', () => ({ net: {}, protocol: {} }));

// resolve() makes it absolute everywhere, including a drive letter on Windows.
const root = resolve('/opt/tassel/out/renderer');

describe('resolveAppFile', () => {
  it('serves index.html at the origin root', () => {
    expect(resolveAppFile(root, 'app://tassel/')).toBe(join(root, 'index.html'));
  });
  it('maps a path under the renderer root', () => {
    expect(resolveAppFile(root, 'app://tassel/assets/index-abc.js')).toBe(
      join(root, 'assets', 'index-abc.js'),
    );
  });
  it('decodes escaped characters', () => {
    expect(resolveAppFile(root, 'app://tassel/assets/a%20b.png')).toBe(
      join(root, 'assets', 'a b.png'),
    );
  });
  // The URL parser resolves "/%2e%2e/" itself, but an escaped slash survives parsing and only
  // becomes "../" once decoded.
  it.each([
    'app://tassel/%2e%2e%2fsecret.txt',
    'app://tassel/assets/..%2f..%2f..%2fsecret.txt',
    'app://tassel/..%5c..%5csecret.txt',
    'app://tassel/index.html%00.png',
  ])('refuses %s', (url) => {
    expect(resolveAppFile(root, url)).toBeNull();
  });
  it('refuses other hosts', () => {
    expect(resolveAppFile(root, 'app://evil/index.html')).toBeNull();
  });
  it('refuses malformed escapes', () => {
    expect(resolveAppFile(root, 'app://tassel/%E0%A4%A')).toBeNull();
  });
});
