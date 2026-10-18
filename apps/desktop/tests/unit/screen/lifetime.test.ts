import { describe, expect, it, vi } from 'vitest';
import { destroyAlive, hideAlive } from '../../../src/main/overlay/lifetime';

describe('overlay native lifetime', () => {
  it('never touches an already destroyed window during closed callbacks', () => {
    const window = {
      isDestroyed: () => true,
      hide: vi.fn(() => {
        throw new Error('Object has been destroyed');
      }),
      destroy: vi.fn(),
    };
    expect(() => hideAlive(window)).not.toThrow();
    expect(() => destroyAlive(window)).not.toThrow();
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.destroy).not.toHaveBeenCalled();
  });
  it('hides and destroys live windows', () => {
    const window = { isDestroyed: () => false, hide: vi.fn(), destroy: vi.fn() };
    hideAlive(window);
    destroyAlive(window);
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
  });
});
