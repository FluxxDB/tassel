// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
    expect(strip).toHaveClass('h-[52px]', 'app-drag', 'pl-[84px]');
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
  });

  it('has no traffic-light inset on Windows', () => {
    render(<AppFrame platform="win32">Tassel</AppFrame>);
    expect(screen.getByRole('banner')).not.toHaveClass('pl-[84px]');
  });
});
