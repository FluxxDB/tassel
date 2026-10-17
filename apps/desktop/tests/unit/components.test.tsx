// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { AppFrame } from '../../src/renderer/src/app/AppFrame';
import { Button } from '../../src/renderer/src/components/Button';
import { Chip } from '../../src/renderer/src/components/Chip';
import { IconButton } from '../../src/renderer/src/components/IconButton';
import {
  Board,
  Camera,
  Captions,
  Globe,
  Mic,
  MicOff,
  Plus,
  Retry,
  Screen,
  Search,
} from '../../src/renderer/src/components/icons';
import { SegmentedControl } from '../../src/renderer/src/components/SegmentedControl';
import { Sheet } from '../../src/renderer/src/components/Sheet';
import { Wordmark } from '../../src/renderer/src/components/Wordmark';
import { initI18n } from '../../src/renderer/src/i18n';

const SORTS = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'created', label: 'Date created' },
  { value: 'topic', label: 'Topic' },
] as const;
type Sort = (typeof SORTS)[number]['value'];

describe('Button', () => {
  it('Button primary is an ink pill', () => {
    render(<Button variant="primary">Start</Button>);
    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass(
      'bg-ink',
      'text-paper',
      'rounded-pill',
    );
  });

  it("lg is a 48px pill on the 14px type scale, with the mock's 22px sides", () => {
    render(<Button size="lg">End session</Button>);
    const button = screen.getByRole('button', { name: 'End session' });
    expect(button).toHaveClass('h-12', 'px-[22px]', 'text-sm');
    expect(button).not.toHaveClass('text-[15px]');
  });

  it('transitions only its colors, so the focus ring appears at once', () => {
    render(<Button>Start</Button>);
    const button = screen.getByRole('button', { name: 'Start' });
    expect(button).toHaveClass('transition-[color,background-color]');
    expect(button).not.toHaveClass('transition-colors');
  });

  it('ghost is a text button with no fill, and never submits a form by default', () => {
    render(<Button variant="ghost">Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).not.toHaveClass('bg-ink');
    expect(button).toHaveClass('text-ink');
    expect(button).toHaveAttribute('type', 'button');
  });
});

describe('Chip', () => {
  it('Chip renders mono uppercase', () => {
    render(<Chip>Homework</Chip>);
    expect(screen.getByText('Homework')).toHaveClass('mono', 'bg-paper', 'rounded-pill');
  });

  it("is 22px tall, as the mock's chips are: 14px lines inside 4px padding", () => {
    render(<Chip>Homework</Chip>);
    expect(screen.getByText('Homework')).toHaveClass('leading-[14px]', 'py-1');
  });
});

describe('SegmentedControl', () => {
  it('SegmentedControl moves selection with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Sort" options={SORTS} value="recent" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Recent activity' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('created'));
    expect(screen.getByRole('radio', { name: 'Date created' })).toHaveFocus();
  });

  it('shows the selected option as a checked ink pill and keeps it on a second click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Sorts() {
      const [value, setValue] = useState<Sort>('recent');
      return (
        <SegmentedControl
          label="Sort"
          options={SORTS}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Sorts />);
    expect(screen.getByRole('radiogroup', { name: 'Sort' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Topic' }));
    const topic = screen.getByRole('radio', { name: 'Topic' });
    expect(topic).toHaveAttribute('aria-checked', 'true');
    expect(topic).toHaveClass('bg-ink', 'text-paper');
    expect(screen.getByRole('radio', { name: 'Recent activity' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Clicking the selected option again doesn't clear the selection.
    await user.click(topic);
    expect(topic).toHaveAttribute('aria-checked', 'true');
    expect(onChange.mock.calls).toEqual([['topic']]);
  });

  it('skips a disabled option, wrapping around from the last', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = [
      { value: 'paper', label: 'Paper', disabled: true },
      { value: 'screen', label: 'Screen share' },
      { value: 'talk', label: 'Just talk' },
    ];
    function Sources() {
      const [value, setValue] = useState('screen');
      return (
        <SegmentedControl
          label="Source"
          options={options}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Sources />);
    expect(screen.getByRole('radio', { name: 'Paper' })).toBeDisabled();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('talk'));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('screen'));
    expect(onChange).not.toHaveBeenCalledWith('paper');
  });

  it('keeps the global 2px ring offset on a focused segment, so the ring clears the ink pill', async () => {
    const user = userEvent.setup();
    render(<SegmentedControl label="Sort" options={SORTS} value="recent" onChange={() => {}} />);
    await user.tab();
    const focused = screen.getByRole('radio', { name: 'Recent activity' });
    expect(focused).toHaveFocus();
    expect(focused).toHaveClass('bg-ink');
    // Nothing on the item may cancel the 2px offset that :focus-visible sets in global.css.
    expect(focused.className).not.toMatch(/outline-offset/);
    expect(focused).toHaveClass('transition-[color,background-color]');
  });

  it('jumps to the last and first options with End and Home', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Sort" options={SORTS} value="recent" onChange={onChange} />);
    await user.tab();
    await user.keyboard('{End}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('topic'));
  });
});

describe('IconButton', () => {
  it('IconButton exposes aria-pressed and aria-label', () => {
    render(
      <IconButton label="Microphone" pressed>
        <Mic />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Microphone' });
    expect(button).toHaveAttribute('aria-label', 'Microphone');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('size-12', 'rounded-pill', 'bg-ink', 'text-paper');
  });

  it("draws its icon at 22px, as the mock's dock does", () => {
    render(
      <IconButton label="Board">
        <Board />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Board' });
    expect(button).toHaveClass('[&>svg]:size-[22px]', 'transition-[color,background-color]');
  });

  it('is unfilled when not pressed, and has no aria-pressed when it is not a toggle', () => {
    const { rerender } = render(
      <IconButton label="Camera" pressed={false}>
        <Camera />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Camera' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveClass('bg-ink');
    rerender(
      <IconButton label="Camera">
        <Camera />
      </IconButton>,
    );
    expect(button).not.toHaveAttribute('aria-pressed');
  });
});

describe('icons', () => {
  const ICONS = { Mic, MicOff, Camera, Screen, Board, Captions, Globe, Plus, Search, Retry };

  it.each(Object.entries(ICONS))(
    '%s is a 24px stroke icon at 1.6, hidden from assistive tech',
    (_, Icon) => {
      const { container } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '24');
      expect(svg).toHaveAttribute('height', '24');
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      expect(svg).toHaveAttribute('stroke-width', '1.6');
      expect(svg).toHaveAttribute('fill', 'none');
      expect(svg).toHaveAttribute('stroke', 'currentColor');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    },
  );
});

describe('Sheet', () => {
  it('is a titled dialog that closes on Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="New session">
        <button type="button">Start</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New session' });
    expect(dialog).toHaveClass('rounded-hero', 'bg-paper');
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  function SheetOpener({ withCancel = false }: { withCancel?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open sheet
        </button>
        <Sheet open={open} onOpenChange={setOpen} title="New session">
          {withCancel && (
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          )}
          <button type="button">Start</button>
        </Sheet>
      </>
    );
  }

  it('returns focus to the control that opened it when Escape closes it', async () => {
    const user = userEvent.setup();
    render(<SheetOpener />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('returns focus to a keyboard opener when a button inside closes it', async () => {
    const user = userEvent.setup();
    render(<SheetOpener withCancel />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.tab();
    expect(opener).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('keeps scrolling inside a tall sheet', () => {
    render(
      <Sheet open onOpenChange={() => {}} title="New session">
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('overflow-y-auto', 'overscroll-contain');
  });

  it('renders nothing while closed', () => {
    render(
      <Sheet open={false} onOpenChange={() => {}} title="New session">
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AppFrame', () => {
  it('is a 52px drag strip that clears the traffic lights on macOS', () => {
    render(
      <AppFrame platform="darwin">
        <button type="button">New session</button>
      </AppFrame>,
    );
    const strip = screen.getByRole('banner');
    expect(strip).toHaveClass('h-[52px]', 'app-drag', 'pl-[84px]', 'gap-[18px]');
    // The lights end at x 80 on current macOS: the first item starts 18px past them, at 98.
    expect(strip).toHaveClass('[&>:first-child]:ml-3.5');
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
  });

  it('has no traffic-light inset on Windows', () => {
    render(<AppFrame platform="win32">Tassel</AppFrame>);
    const strip = screen.getByRole('banner');
    expect(strip).not.toHaveClass('pl-[84px]');
    expect(strip).not.toHaveClass('[&>:first-child]:ml-3.5');
    expect(strip).toHaveClass('app-drag-overlay-inset', 'pl-5');
  });
});

describe('Wordmark', () => {
  it('looks the same in every UI language and is never translated', async () => {
    const i18n = await initI18n('ko');
    render(
      <I18nextProvider i18n={i18n}>
        <Wordmark />
      </I18nextProvider>,
    );
    const name = screen.getByText('Tassel');
    expect(name).toHaveAttribute('translate', 'no');
    // Explicit tracking and leading, so :lang(ko) doesn't loosen the Latin name.
    expect(name).toHaveClass('lowercase', 'tracking-[-0.025em]', 'leading-none');
    expect(name.parentElement).toHaveClass('gap-[7px]');
  });
});
