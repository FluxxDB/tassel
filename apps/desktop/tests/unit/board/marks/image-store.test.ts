import type { DetectedElements, ImageAction, PaperMark } from '@tassel/shared/beats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyImageAction,
  type ImageSource,
  type LoadedImage,
  marksOf,
  registerImageSource,
  useImageStore,
} from '../../../../src/renderer/src/board/marks/image-store';

const store = () => useImageStore.getState();

const A = '0f6a1d2e-7b3c-4d5e-8f90-1a2b3c4d5e6f';
const B = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const DETECTED: DetectedElements = {
  width: 960,
  height: 720,
  items: [
    { id: 'm1', kind: 'label', box: { x: 100, y: 100, w: 200, h: 60 } },
    { id: 'm2', kind: 'circle', box: { x: 400, y: 300, w: 120, h: 120 } },
  ],
};

const show = (attachmentId: string): ImageAction => ({ kind: 'image.show', attachmentId });
const clear = (attachmentId: string): ImageAction => ({ kind: 'image.clear', attachmentId });
const mark = (attachmentId: string, m: PaperMark): ImageAction => ({
  kind: 'image.mark',
  attachmentId,
  mark: m,
});
const circle = (id: string, el: string): PaperMark =>
  ({ type: 'circle', id, target: { el } }) as PaperMark;
const dot = (id: string): PaperMark => ({ type: 'check', id, target: { at: { x: 0.5, y: 0.5 } } });

/** An image as the attachment source would load it: a URL to revoke once unused. */
function image(attachmentId: string, detected?: DetectedElements) {
  const revoke = vi.fn();
  const loaded: LoadedImage = {
    url: `blob:app://tassel/${attachmentId}`,
    w: 960,
    h: 720,
    revoke,
    ...(detected && { detected }),
  };
  return { loaded, revoke };
}

/** A source whose loads wait until the test settles them. */
function deferredSource() {
  const loads: Array<{
    attachmentId: string;
    signal: AbortSignal;
    resolve(image: LoadedImage): void;
    reject(error: unknown): void;
  }> = [];
  const source: ImageSource = {
    load: (attachmentId, { signal }) =>
      new Promise<LoadedImage>((resolve, reject) =>
        loads.push({ attachmentId, signal, resolve, reject }),
      ),
  };
  return { source, loads };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

let unregister = () => {};
beforeEach(() => {
  store().reset();
});
afterEach(() => {
  unregister();
  unregister = () => {};
  store().reset();
  vi.restoreAllMocks();
});

describe('image.show', () => {
  it('loads the attachment through the registered source and puts it on the stage', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    expect(store()).toMatchObject({ shown: A, status: 'loading', image: null });
    expect(loads.map((l) => l.attachmentId)).toEqual([A]);
    const { loaded } = image(A, DETECTED);
    loads[0].resolve(loaded);
    await flush();
    expect(store()).toMatchObject({ shown: A, status: 'shown', image: loaded });
  });

  it('with no source, or a load that fails, leaves her paper up with a failed notice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyImageAction(show(A));
    expect(store()).toMatchObject({ shown: null, status: 'failed', image: null });
    expect(warn).toHaveBeenCalledTimes(1);

    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    expect(store().status).toBe('loading');
    loads[0].reject(new Error('404'));
    await flush();
    expect(store()).toMatchObject({ shown: null, status: 'failed', image: null });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a newer show aborts the load in flight; its image, arriving late, is let go', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    applyImageAction(show(B));
    expect(loads[0].signal.aborted).toBe(true);
    expect(loads[1].signal.aborted).toBe(false);
    const a = image(A);
    const b = image(B);
    loads[1].resolve(b.loaded);
    loads[0].resolve(a.loaded);
    await flush();
    expect(store()).toMatchObject({ shown: B, status: 'shown', image: b.loaded });
    expect(a.revoke).toHaveBeenCalledTimes(1);
    expect(b.revoke).not.toHaveBeenCalled();
  });

  it('shows an image it already loaded at once, without loading it again', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    const a = image(A);
    loads[0].resolve(a.loaded);
    await flush();
    applyImageAction(show(B));
    loads[1].resolve(image(B).loaded);
    await flush();
    applyImageAction(show(A));
    expect(loads).toHaveLength(2);
    expect(store()).toMatchObject({ shown: A, status: 'shown', image: a.loaded });
    expect(a.revoke).not.toHaveBeenCalled();
  });
});

describe('image.mark and image.clear', () => {
  it('keeps marks per attachment, in order, replacing one by its id', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    loads[0].resolve(image(A, DETECTED).loaded);
    await flush();
    applyImageAction(mark(A, circle('c', 'm1')));
    applyImageAction(mark(A, dot('d')));
    applyImageAction(mark(B, dot('e')));
    applyImageAction(mark(A, circle('c', 'm2')));
    expect(marksOf(store(), A)).toEqual([circle('c', 'm2'), dot('d')]);
    expect(marksOf(store(), B)).toEqual([dot('e')]);
    // Switching images keeps each image's marks.
    applyImageAction(show(B));
    loads[1].resolve(image(B).loaded);
    await flush();
    expect(marksOf(store(), A)).toEqual([circle('c', 'm2'), dot('d')]);
    applyImageAction(clear(A));
    expect(marksOf(store(), A)).toEqual([]);
    expect(marksOf(store(), B)).toEqual([dot('e')]);
  });

  it('a mark on an image not yet loaded waits for it, so what she says with the show lands', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    applyImageAction(mark(A, circle('c', 'm1')));
    loads[0].resolve(image(A, DETECTED).loaded);
    await flush();
    expect(marksOf(store(), A)).toEqual([circle('c', 'm1')]);
  });

  it("skips a mark on ink the image's Set-of-Mark doesn't have, with a warning", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    loads[0].resolve(image(A, DETECTED).loaded);
    await flush();
    applyImageAction(mark(A, circle('c', 'm9')));
    // An automaton's ink is on her paper, never on an image.
    applyImageAction(mark(A, circle('s', 'state:q0')));
    expect(marksOf(store(), A)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('back to paper and reset', () => {
  it('Back to paper takes the image off the stage and keeps it, and its marks, for later', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    const a = image(A);
    loads[0].resolve(a.loaded);
    await flush();
    applyImageAction(mark(A, dot('d')));
    store().backToPaper();
    expect(store()).toMatchObject({ shown: null, status: 'idle', image: null });
    expect(marksOf(store(), A)).toEqual([dot('d')]);
    expect(a.revoke).not.toHaveBeenCalled();
    applyImageAction(show(A));
    expect(store()).toMatchObject({ shown: A, status: 'shown', image: a.loaded });
    expect(loads).toHaveLength(1);
  });

  it('Back to paper while loading drops the load', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    store().backToPaper();
    expect(loads[0].signal.aborted).toBe(true);
    const a = image(A);
    loads[0].resolve(a.loaded);
    await flush();
    expect(store()).toMatchObject({ shown: null, status: 'idle', image: null });
    expect(a.revoke).toHaveBeenCalledTimes(1);
  });

  it('reset lets every loaded image go and forgets the marks', async () => {
    const { source, loads } = deferredSource();
    unregister = registerImageSource(source);
    applyImageAction(show(A));
    const a = image(A);
    loads[0].resolve(a.loaded);
    await flush();
    applyImageAction(mark(A, dot('d')));
    applyImageAction(show(B));
    const b = image(B);
    loads[1].resolve(b.loaded);
    await flush();
    store().reset();
    expect(store()).toMatchObject({ shown: null, status: 'idle', image: null });
    expect(marksOf(store(), A)).toEqual([]);
    expect(a.revoke).toHaveBeenCalledTimes(1);
    expect(b.revoke).toHaveBeenCalledTimes(1);
  });
});
