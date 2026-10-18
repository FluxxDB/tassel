// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION } from '../../src/renderer/src/board/motion';
import {
  FloatingTile,
  type FloatingTileProps,
} from '../../src/renderer/src/components/FloatingTile';
import { initI18n } from '../../src/renderer/src/i18n';

// jsdom lays nothing out: the stage reads its size from data-w and data-h.
const sizes = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.w ?? 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0);
    },
  });
  return () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', sizes.clientWidth ?? {});
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', sizes.clientHeight ?? {});
  };
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

const TILE: Omit<FloatingTileProps, 'children'> = {
  id: 'ada',
  label: "Ada's tile",
  defaultCorner: 'top-right',
  defaultSize: { w: 200, h: 100 },
  minWidth: 120,
  maxWidth: 400,
  inset: 14,
  bottomClearance: 110,
};

async function renderTile(
  props: Partial<FloatingTileProps> = {},
  stage = { w: 1000, h: 600 },
  extra?: Partial<FloatingTileProps>,
) {
  const i18n = await initI18n('en');
  const view = render(
    <I18nextProvider i18n={i18n}>
      <div data-testid="bounds" data-w={stage.w} data-h={stage.h}>
        <FloatingTile {...TILE} {...props}>
          <span>inside</span>
        </FloatingTile>
        {extra && (
          <FloatingTile {...TILE} {...extra}>
            <span>other</span>
          </FloatingTile>
        )}
      </div>
    </I18nextProvider>,
  );
  return { ...view, tile: screen.getByRole('group', { name: props.label ?? TILE.label }) };
}

const box = (el: HTMLElement) => ({
  left: Number.parseFloat(el.style.left),
  top: Number.parseFloat(el.style.top),
  width: Number.parseFloat(el.style.width),
  height: Number.parseFloat(el.style.height),
});

/** A pointer drag from (x, y) by (dx, dy), its moves and release on the window. */
function drag(target: Element, x: number, y: number, dx: number, dy: number, release = true) {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, button: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: x + dx / 2, clientY: y + dy / 2, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: x + dx, clientY: y + dy, pointerId: 1 });
  if (release) fireEvent.pointerUp(window, { clientX: x + dx, clientY: y + dy, pointerId: 1 });
}

describe('FloatingTile', () => {
  it('starts in its default corner, inset from the stage', async () => {
    const { tile } = await renderTile();
    expect(box(tile)).toEqual({ left: 1000 - 14 - 200, top: 14, width: 200, height: 100 });
    expect(tile).toHaveTextContent('inside');
    // Hairline, never a drop shadow.
    expect(tile).toHaveClass('rounded-card', 'shadow-[0_0_0_1px_var(--color-hairline)]');
  });

  it('keeps its bottom corners clear of the captions band', async () => {
    const { tile } = await renderTile({ defaultCorner: 'bottom-left' });
    expect(box(tile)).toMatchObject({ left: 14, top: 600 - 110 - 100 });
  });

  it('follows the pointer while dragged, clamped inside the stage', async () => {
    const { tile } = await renderTile();
    drag(tile, 900, 50, -300, 200, false);
    expect(box(tile)).toMatchObject({ left: 786 - 300, top: 214 });
    // Far past the stage's edges, it stops at the inset.
    fireEvent.pointerMove(window, { clientX: -5000, clientY: 5000, pointerId: 1 });
    expect(box(tile)).toMatchObject({ left: 14, top: 600 - 110 - 100 });
    // No transition while it follows the pointer.
    expect(tile.style.transitionDuration).toBe('');
  });

  it('snaps to the nearest corner on release, with the camera motion', async () => {
    const { tile } = await renderTile();
    // Its centre ends in the stage's bottom left quarter.
    drag(tile, 900, 50, -600, 300);
    expect(box(tile)).toMatchObject({ left: 14, top: 600 - 110 - 100 });
    expect(tile).toHaveClass('motion-safe:transition-[left,top,width,height]');
    expect(tile.style.transitionDuration).toBe(`${MOTION.cameraMs}ms`);
    expect(tile.style.transitionTimingFunction).toBe(MOTION.ease);
  });

  it("doesn't move for a click that barely moves", async () => {
    const { tile } = await renderTile();
    drag(tile, 900, 50, 2, 1);
    expect(box(tile)).toMatchObject({ left: 786, top: 14 });
  });

  it('resizes from its inner corner with the aspect ratio locked, within min and max', async () => {
    const { tile } = await renderTile();
    const handle = tile.querySelector('[data-resize-handle]');
    if (!handle) throw new Error('no resize handle');
    // Top right: the handle is bottom left, so dragging it out (left and down) grows the tile.
    drag(handle, 786, 114, -60, 30);
    expect(box(tile)).toMatchObject({ width: 260, height: 130 });
    // Its anchored corner stays put.
    expect(box(tile).left + box(tile).width).toBe(1000 - 14);
    expect(box(tile).top).toBe(14);
    drag(handle, 726, 144, -1000, 1000);
    expect(box(tile)).toMatchObject({ width: 400, height: 200 });
    drag(handle, 586, 214, 1000, -1000);
    expect(box(tile)).toMatchObject({ width: 120, height: 60 });
  });

  it("doesn't start a drag from its resize handle", async () => {
    const { tile } = await renderTile();
    const handle = tile.querySelector('[data-resize-handle]') as Element;
    drag(handle, 786, 114, -600, 300);
    expect(box(tile).top).toBe(14);
  });

  it('keeps its corner and size across mounts, per tile id', async () => {
    const first = await renderTile();
    drag(first.tile, 900, 50, -600, 300);
    first.unmount();
    const { tile } = await renderTile();
    expect(box(tile)).toMatchObject({ left: 14, top: 390 });
    expect(JSON.parse(localStorage.getItem('tassel.tile.ada') ?? '{}')).toMatchObject({
      corner: 'bottom-left',
      width: 200,
    });
  });

  it('renders at its default without storage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { tile } = await renderTile();
    expect(box(tile)).toMatchObject({ left: 786, top: 14 });
    drag(tile, 900, 50, -600, 300);
    expect(box(tile)).toMatchObject({ left: 14, top: 390 });
    get.mockRestore();
    set.mockRestore();
  });

  it('ignores a stored value it does not understand', async () => {
    localStorage.setItem('tassel.tile.ada', '{"corner":"middle","width":"wide"}');
    const { tile } = await renderTile();
    expect(box(tile)).toMatchObject({ left: 786, top: 14, width: 200 });
  });

  it('moves between corners with the arrows and resizes with Shift and the arrows', async () => {
    const { tile } = await renderTile();
    tile.focus();
    fireEvent.keyDown(tile, { key: 'ArrowLeft' });
    expect(box(tile)).toMatchObject({ left: 14, top: 14 });
    fireEvent.keyDown(tile, { key: 'ArrowDown' });
    expect(box(tile)).toMatchObject({ left: 14, top: 390 });
    fireEvent.keyDown(tile, { key: 'ArrowRight', shiftKey: true });
    expect(box(tile)).toMatchObject({ width: 216, height: 108 });
    fireEvent.keyDown(tile, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(tile, { key: 'ArrowDown', shiftKey: true });
    expect(box(tile)).toMatchObject({ width: 184, height: 92 });
    // Bottom corners keep clear of the captions band as they grow.
    expect(box(tile).top + box(tile).height).toBe(600 - 110);
  });

  it("keeps arrow keys from the page's own handlers", async () => {
    const { tile } = await renderTile();
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    fireEvent.keyDown(tile, { key: 'ArrowLeft' });
    window.removeEventListener('keydown', onKey);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('activates on a double click and on Enter', async () => {
    const onActivate = vi.fn();
    const { tile } = await renderTile({ onActivate });
    fireEvent.doubleClick(tile);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('re-clamps its size when the window shrinks the stage, and grows back after', async () => {
    const { tile, getByTestId } = await renderTile({ defaultSize: { w: 400, h: 200 } });
    const bounds = getByTestId('bounds');
    bounds.dataset.w = '300';
    bounds.dataset.h = '400';
    act(() => window.dispatchEvent(new Event('resize')));
    // 300 − 2 × 14 wide at most, still at the top right.
    expect(box(tile)).toMatchObject({ width: 272, height: 136, left: 14, top: 14 });
    bounds.dataset.w = '1000';
    bounds.dataset.h = '600';
    act(() => window.dispatchEvent(new Event('resize')));
    expect(box(tile)).toMatchObject({ width: 400, left: 586 });
  });

  it('snaps past a corner another tile holds, to the nearest free one', async () => {
    await renderTile({}, undefined, {
      id: 'pip',
      label: 'Your desk',
      defaultCorner: 'bottom-left',
    });
    const ada = screen.getByRole('group', { name: "Ada's tile" });
    // Toward the bottom left, which the other tile holds: the nearest free corner is the top left.
    drag(ada, 900, 50, -600, 300);
    expect(box(ada)).toMatchObject({ left: 14, top: 14 });
  });

  it('starts in the nearest free corner when its own is taken', async () => {
    await renderTile({}, undefined, { id: 'pip', label: 'Your desk', defaultCorner: 'top-right' });
    const pip = screen.getByRole('group', { name: 'Your desk' });
    expect(box(pip).top).toBe(600 - 110 - 100);
    expect(box(pip).left).toBe(786);
  });

  it('describes its keyboard controls', async () => {
    const { tile } = await renderTile();
    expect(tile).toHaveAttribute('tabindex', '0');
    expect(tile).toHaveAccessibleDescription(/arrow keys/i);
  });

  it('passes its current size to a render function child', async () => {
    const i18n = await initI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <div data-w={1000} data-h={600}>
          <FloatingTile {...TILE}>{(size) => <span>{`${size.w}×${size.h}`}</span>}</FloatingTile>
        </div>
      </I18nextProvider>,
    );
    expect(screen.getByText('200×100')).toBeInTheDocument();
  });
});
