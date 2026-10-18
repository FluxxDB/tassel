// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkLayer, ScrollCaption } from '../../../src/renderer/src/overlay/Overlay';

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
  it('renders written text as text and bounds a rectangle in image coordinates', () => {
    const view = render(
      <MarkLayer
        marks={[
          {
            id: 'label',
            author: 'tutor',
            kind: 'text',
            points: [{ x: 0.2, y: 0.3 }],
            text: '<script>example</script>',
          },
          {
            id: 'box',
            author: 'tutor',
            kind: 'rectangle',
            points: [
              { x: 0.2, y: 0.3 },
              { x: 0.6, y: 0.7 },
            ],
          },
        ]}
      />,
    );
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('text')?.textContent).toBe('<script>example</script>');
    expect(Number(view.container.querySelector('rect')?.getAttribute('width'))).toBeCloseTo(400);
  });
});
