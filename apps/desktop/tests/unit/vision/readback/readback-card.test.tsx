// @vitest-environment jsdom
import type { Lang } from '@tassel/shared/i18n';
import type { DfaReading } from '@tassel/shared/vision';
import fixtures from '@tassel/shared/vision/fixtures.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../../../../src/renderer/src/i18n';
import { ReadBackCard } from '../../../../src/renderer/src/vision/readback/ReadBackCard';

const demo = fixtures.readings['demo-wrong'] as DfaReading;
async function card(reading: DfaReading | null = demo, lang: Lang = 'en') {
  const i18n = await initI18n('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <ReadBackCard reading={reading} lang={lang} />
    </I18nextProvider>,
  );
}

describe('ReadBackCard', () => {
  it('renders four states, five edges, and only q3 as accepting', async () => {
    await card();
    expect(screen.getByRole('figure', { name: 'How I read your DFA' })).toHaveAttribute(
      'lang',
      'en',
    );
    expect(screen.getAllByTestId(/^readback-state-/)).toHaveLength(4);
    expect(screen.getAllByTestId(/^readback-edge-/)).toHaveLength(5);
    for (const state of demo.states) {
      expect(screen.getByTestId(`readback-state-${state.id}`)).toHaveAttribute(
        'data-accept',
        String(state.accept),
      );
      expect(screen.getByTestId(`readback-state-${state.id}`)).toHaveAttribute(
        'data-uncertain',
        'false',
      );
    }
    expect(screen.getByTestId('readback-state-q3').querySelectorAll('circle')).toHaveLength(2);
    expect(screen.getByText('Missing arrows go to a dead state.')).toBeVisible();
  });

  it('marks uncertain states and transitions with dashed iris ink and a question mark', async () => {
    await card({ ...(fixtures.readings.uncertain as DfaReading), uncertain: ['q2', 'q0-1-q0'] });
    expect(screen.getByTestId('readback-state-q2')).toHaveAttribute('data-uncertain', 'true');
    expect(screen.getByTestId('readback-state-q2').querySelector('circle')).toHaveAttribute(
      'stroke-dasharray',
      '4 3',
    );
    expect(screen.getByTestId('readback-edge-q0-1-q0').querySelector('path')).toHaveAttribute(
      'stroke-dasharray',
      '4 3',
    );
    expect(within(screen.getByTestId('readback-state-q2')).getByText('?')).toHaveClass(
      'fill-iris-ink',
    );
    expect(screen.getByText("? I'm not sure about this part.", { selector: 'p' })).toBeVisible();
  });

  it.each([
    ['en', 'How I read your DFA', 'Missing arrows go to a dead state.', 'q0 to q0 on 1'],
    ['es', 'Así leí tu AFD', 'Las flechas que faltan van a un estado muerto.', 'De q0 a q0 con 1'],
    ['ko', '내가 읽은 DFA', '없는 화살표는 죽은 상태로 가요.', 'q0 → q0, 입력 1'],
  ] as const)(
    'uses the %s session language even when UI is English',
    async (lang, title, deadState, transition) => {
      await card(demo, lang);
      expect(document.documentElement.lang).toBe('en');
      expect(screen.getByRole('figure', { name: title })).toHaveAttribute('lang', lang);
      expect(screen.getByRole('button', { name: title })).toBeVisible();
      expect(screen.getByText(deadState)).toBeVisible();
      expect(screen.getByText(transition)).toBeInTheDocument();
    },
  );

  it('collapses and expands by keyboard, keeping the title available', async () => {
    const user = userEvent.setup();
    const { container } = await card();
    const button = screen.getByRole('button', { name: 'How I read your DFA' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('title', 'Hide my reading');
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('title', 'Show my reading');
    expect(container.querySelector('svg[data-reading]')).not.toBeVisible();
    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('svg[data-reading]')).toBeVisible();
  });

  it('provides an accessible list of all states and transitions', async () => {
    await card();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
    expect(within(list).getByText('q0, start')).toBeInTheDocument();
    expect(within(list).getByText('q3, accepting')).toBeInTheDocument();
    expect(within(list).getByText('q0 to q0 on 1')).toBeInTheDocument();
  });

  it('omits footnotes when a reading is complete and certain', async () => {
    await card({
      ...demo,
      transitions: demo.states.map((s) => ({
        ...demo.transitions[0],
        id: s.id,
        source: s.id,
        target: s.id,
        symbols: ['0', '1'],
      })),
    });
    expect(screen.queryByText('Missing arrows go to a dead state.')).not.toBeInTheDocument();
    expect(screen.queryByText("? I'm not sure about this part.")).not.toBeInTheDocument();
  });

  it('identifies uncertain states and transitions in the accessible list', async () => {
    await card({ ...demo, uncertain: ['q2', 'q0-1-q0'] }, 'ko');
    const list = screen.getByRole('list');
    expect(within(list).getByText('q2')).toHaveTextContent('q2 ? 이 부분은 확실하지 않아요.');
    expect(within(list).getByText('q0 → q0, 입력 1')).toHaveTextContent(
      'q0 → q0, 입력 1 ? 이 부분은 확실하지 않아요.',
    );
    expect(within(list).getByText('q1')).not.toHaveTextContent('확실하지');
  });

  it('renders nothing for null', async () => {
    const { container } = await card(null);
    expect(container).toBeEmptyDOMElement();
  });
});
