import { describe, expect, it, vi } from 'vitest';
import { bindHelperToApp } from '../../../../src/main/paper/lifecycle';

describe('bindHelperToApp', () => {
  it('will-quit stops the helper', () => {
    const listeners = new Map<string, () => void>();
    const app = {
      on: vi.fn((event: 'will-quit', listener: () => void) => listeners.set(event, listener)),
    };
    const helper = { start: vi.fn(), stop: vi.fn(async () => {}) };
    bindHelperToApp(app, helper);
    expect(helper.stop).not.toHaveBeenCalled();
    listeners.get('will-quit')?.();
    expect(helper.stop).toHaveBeenCalledTimes(1);
  });
});
