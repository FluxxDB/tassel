// @vitest-environment jsdom
// What a diagram's shapes draw, without tldraw: a node card (its stroke icon over its label and a
// mono sublabel) and a group frame (a hairline wash with its lab label), and the icons themselves.
// Also Ada's notes keep her line breaks, drawn and measured alike.
import { DIAGRAM_ICONS } from '@tassel/shared/beats';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagramIcon } from '../../../../src/renderer/src/board/icons/DiagramIcon';
import { NODE_CARD } from '../../../../src/renderer/src/board/scene/diagram';
import { createTextMeasure } from '../../../../src/renderer/src/board/tldraw/measure';
import {
  GroupFigure,
  NodeFigure,
  NoteFigure,
} from '../../../../src/renderer/src/board/tldraw/shapes/figures';
import { initI18n } from '../../../../src/renderer/src/i18n';

async function renderIn(ui: ReactNode) {
  const i18n = await initI18n('en');
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('DiagramIcon', () => {
  it('draws every icon as an ink stroke of 1.5 px, with no fill and no image', () => {
    for (const icon of DIAGRAM_ICONS) {
      const { container, unmount } = render(<DiagramIcon icon={icon} size={24} />);
      const svg = container.querySelector('svg');
      expect(svg, icon).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('width')).toBe('24');
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.getAttribute('stroke-width')).toBe('1.5');
      expect(svg?.getAttribute('fill')).toBe('none');
      expect(
        svg?.querySelectorAll('path, circle, rect, line, ellipse, polyline').length,
      ).toBeGreaterThan(0);
      expect(container.querySelector('image, img, text')).toBeNull();
      unmount();
    }
  });

  it('draws each icon differently', () => {
    const drawn = DIAGRAM_ICONS.map((icon) => {
      const { container, unmount } = render(<DiagramIcon icon={icon} size={24} />);
      const html = container.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(drawn).size).toBe(DIAGRAM_ICONS.length);
  });
});

describe('NodeFigure', () => {
  it('is a hairline card on paper: the icon beside its label, the sublabel in mono under it', async () => {
    await renderIn(
      <NodeFigure
        w={120}
        h={92}
        label="Router A"
        sublabel="192.168.1.1"
        icon="router"
        highlight={false}
        lang="en"
      />,
    );
    const card = screen.getByRole('img', { name: 'Router A, router, 192.168.1.1' });
    expect(card).toHaveAttribute('data-icon', 'router');
    expect(card).toHaveAttribute('data-highlight', 'false');
    expect(card).toHaveStyle({ width: '120px', height: '92px', boxSizing: 'border-box' });
    expect(card.style.borderWidth).toBe('1px');
    expect(card.style.borderStyle).toBe('solid');
    expect(card.style.borderColor).toBe('var(--color-hairline)');
    expect(card.style.backgroundColor).toBe('var(--color-paper)');
    expect(card.style.boxShadow).toBe('');
    expect(card.querySelector('svg')).not.toBeNull();
    expect(card.style.flexDirection).toBe('row');
    expect(card.style.padding).toBe(
      `${NODE_CARD.padY}px ${NODE_CARD.padRight}px ${NODE_CARD.padY}px ${NODE_CARD.padLeft}px`,
    );
    const label = screen.getByText('Router A');
    expect(label).toHaveStyle({ fontSize: '14px', whiteSpace: 'nowrap' });
    // An address keeps its case: mono, but not a lab label.
    const sub = screen.getByText('192.168.1.1');
    expect(sub.style.fontFamily).toBe('var(--font-mono)');
    expect(sub.style.textTransform).toBe('none');
    expect(Number.parseFloat(sub.style.fontSize)).toBeGreaterThanOrEqual(11);
    expect(Number.parseFloat(label.style.fontSize)).toBe(NODE_CARD.labelSize);
  });

  it('a highlighted node rings in iris-ink, as a highlighted state does', async () => {
    await renderIn(
      <NodeFigure w={96} h={74} label="Core" sublabel="" icon="switch" highlight lang="en" />,
    );
    const card = screen.getByRole('img', { name: 'Core, switch' });
    expect(card).toHaveAttribute('data-highlight', 'true');
    expect(card.style.outlineWidth).toBe('2px');
    expect(card.style.outlineStyle).toBe('solid');
    expect(card.style.outlineColor).toBe('var(--color-iris-ink)');
  });
});

describe('GroupFigure', () => {
  it('is a hairline frame on a wash, its lab label and sublabel on one line at its top-left', async () => {
    await renderIn(
      <GroupFigure
        w={300}
        h={260}
        label="Zone A"
        sublabel="192.168.1.0/26"
        tone={0}
        highlight={false}
        lang="en"
      />,
    );
    const frame = screen.getByRole('group', { name: 'Zone A, 192.168.1.0/26' });
    expect(frame).toHaveStyle({ width: '300px', height: '260px' });
    expect(frame.style.borderWidth).toBe('1px');
    expect(frame.style.borderColor).toBe('var(--color-hairline)');
    expect(frame.style.backgroundColor).toBe('var(--color-mint, #daf7ee)');
    const label = screen.getByText('Zone A');
    expect(label).toHaveClass('mono');
    expect(label).toHaveStyle({ textTransform: 'uppercase', fontSize: '12px' });
    expect(screen.getByText('192.168.1.0/26')).toHaveClass('mono');
  });

  it('each of six groups has its own wash', async () => {
    const washes = [];
    for (let tone = 0; tone < 6; tone++) {
      const { unmount } = await renderIn(
        <GroupFigure
          w={10}
          h={10}
          label={`G${tone}`}
          sublabel=""
          tone={tone}
          highlight={false}
          lang="en"
        />,
      );
      washes.push(screen.getByRole('group', { name: `G${tone}` }).style.backgroundColor);
      unmount();
    }
    expect(new Set(washes).size).toBe(6);
  });
});

describe("Ada's line breaks", () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a note keeps them', async () => {
    await renderIn(<NoteFigure w={200} h={92} text={'Zone A: /26\nZone B: /27'} variant="note" />);
    const note = screen.getByText(/Zone A: \/26/);
    expect(note.style.whiteSpace).toBe('pre-wrap');
  });

  it('the measure keeps them too, and sets the diagram labels as they are drawn', () => {
    const measure = createTextMeasure(document.body, () => 'en');
    measure.measure('a\nb', 'note', 288);
    const box = document.body.lastElementChild as HTMLElement;
    expect(box.style.whiteSpace).toBe('pre-wrap');
    measure.measure('Zone A', 'groupLabel', 1000);
    expect(box.style.textTransform).toBe('uppercase');
    expect(box.style.letterSpacing).toBe('0.025em');
    measure.measure('Router A', 'nodeLabel', 1000);
    expect(box.style.textTransform).toBe('none');
    measure.dispose();
  });
});
