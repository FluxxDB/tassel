import { beforeEach, describe, expect, it } from 'vitest';
import { useRoute } from '../../src/renderer/src/app/route-store';

describe('useRoute', () => {
  beforeEach(() => useRoute.getState().goLibrary());

  it('starts on the library', () => {
    expect(useRoute.getState().route).toEqual({ name: 'library' });
  });

  it('opens a session and goes back to the library', () => {
    useRoute.getState().openSession('s-1');
    expect(useRoute.getState().route).toEqual({ name: 'session', sessionId: 's-1' });
    useRoute.getState().goLibrary();
    expect(useRoute.getState().route).toEqual({ name: 'library' });
  });
});
