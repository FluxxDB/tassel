// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const screen = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/src/board/tldraw/TldrawCanvas', async () => {
  const { useEffect } = await import('react');
  return {
    TldrawCanvas: ({ onEngine }: { onEngine: (e: unknown) => void }) => {
      useEffect(() => {
        onEngine({ screen });
        return () => onEngine(null);
      }, [onEngine]);
      return <div data-testid="whiteboard-engine" />;
    },
  };
});

import { initI18n } from '../../../src/renderer/src/i18n';
import { MarkLayer, Overlay, ScrollCaption } from '../../../src/renderer/src/overlay/Overlay';

beforeAll(async () => {
  await initI18n('en');
});

describe('overlay captions', () => {
  it('follows new lines, respects manual scrolling, and follows again at the bottom', () => {
    const view = render(<ScrollCaption text="First sentence" />);
    const element = view.getByText('First sentence');
    let height = 200;
    Object.defineProperties(element, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 40 },
    });
    view.rerender(<ScrollCaption text="First sentence extended" />);
    expect(element.scrollTop).toBe(200);
    element.scrollTop = 0;
    fireEvent.scroll(element);
    height = 300;
    view.rerender(<ScrollCaption text="More sentences" />);
    expect(element.scrollTop).toBe(0);
    element.scrollTop = 260;
    fireEvent.scroll(element);
    height = 400;
    view.rerender(<ScrollCaption text="Another sentence" />);
    expect(element.scrollTop).toBe(400);
  });
  it('renders annotations through the shared whiteboard at display dimensions', async () => {
    const marks = [
      {
        id: 'text',
        kind: 'text' as const,
        author: 'tutor' as const,
        points: [{ x: 0.2, y: 0.3 }],
        text: '<script>example</script>',
      },
    ];
    const view = render(<MarkLayer marks={marks} viewport={{ width: 1920, height: 1080 }} />);
    await view.findByTestId('whiteboard-engine');
    expect(screen).toHaveBeenCalledWith(marks, { width: 1920, height: 1080 }, undefined);
    expect(view.container.querySelector('script')).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('keeps optimistic ink through unrelated updates and removes it after owner rejection', async () => {
  let publish: (state: import('../../../src/shared/screen-bridge').OverlayState) => void = () => {};
  vi.stubGlobal('tassel', {
    screen: {
      ready: vi.fn(),
      intent: vi.fn(),
      stroke: vi.fn(),
      onState: (next: typeof publish) => {
        publish = next;
        return () => {};
      },
    },
  });
  const state = {
    sequence: 1,
    strokeReceipt: 0,
    status: 'sharing' as const,
    caption: '',
    tutorState: 'listening',
    micOn: true,
    draw: true,
    marks: [],
    avatar: {},
    notice: '',
  };
  const view = render(<Overlay kind="ink" />);
  act(() => publish(state));
  await view.findByTestId('whiteboard-engine');
  const element = view.getByTestId('screen-drawing');
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = () => true;
  element.releasePointerCapture = vi.fn();
  function pointer(type: string, x: number, buttons: number) {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 100,
      button: 0,
      buttons,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(element, event);
  }
  pointer('pointerdown', 100, 1);
  pointer('pointerup', 150, 0);
  expect(screen.mock.calls.at(-1)?.[0]).toHaveLength(1);
  act(() => publish({ ...state, sequence: 2, caption: 'An unrelated update' }));
  expect(screen.mock.calls.at(-1)?.[0]).toHaveLength(1);
  act(() => publish({ ...state, sequence: 3, strokeReceipt: 1 }));
  expect(screen.mock.calls.at(-1)?.[0]).toHaveLength(0);
});
