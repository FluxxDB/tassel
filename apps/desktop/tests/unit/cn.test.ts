import { describe, expect, it } from 'vitest';
import { cn } from '../../src/renderer/src/lib/cn';

describe('cn', () => {
  it('joins class names, skipping the falsy ones', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('lets a later utility replace an earlier one that sets the same thing', () => {
    expect(cn('px-4 py-1', 'px-[22px]')).toBe('py-1 px-[22px]');
    expect(cn('text-sm', 'text-[17px]')).toBe('text-[17px]');
    expect(cn('bg-ink text-paper', 'bg-paper')).toBe('text-paper bg-paper');
    // Task 13's subject chip: a cap passed in replaces the Chip's own max-w-full.
    expect(cn('min-w-0 max-w-full truncate', 'max-w-[200px]')).toBe(
      'min-w-0 truncate max-w-[200px]',
    );
  });

  it("knows Tassel's own tokens", () => {
    expect(cn('rounded-pill', 'rounded-card')).toBe('rounded-card');
    expect(cn('text-ink', 'text-smoke-text')).toBe('text-smoke-text');
    expect(cn('font-normal', 'font-w520')).toBe('font-w520');
  });

  it('keeps utilities that set different things', () => {
    expect(cn('text-sm text-smoke-text')).toBe('text-sm text-smoke-text');
    expect(cn('font-mono font-w520')).toBe('font-mono font-w520');
    expect(cn('bg-ink hover:bg-ink/85 active:bg-ink/75')).toBe(
      'bg-ink hover:bg-ink/85 active:bg-ink/75',
    );
    expect(cn('mono app-drag', 'shrink-0')).toBe('mono app-drag shrink-0');
  });
});
