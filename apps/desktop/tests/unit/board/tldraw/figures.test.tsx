// @vitest-environment jsdom
// What Ada's shapes draw (the global constraints' visual values), without tldraw: the state,
// the trace card and the note, in the session's language.
import type { Lang } from '@tassel/shared/i18n';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import {
  NoteFigure,
  StateFigure,
  TraceCard,
  type TraceProps,
} from '../../../../src/renderer/src/board/tldraw/shapes/figures';
import { initI18n } from '../../../../src/renderer/src/i18n';

/** Renders in an English UI: the figures speak the session's language they're given. */
async function renderIn(ui: ReactNode) {
  const i18n = await initI18n('en');
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const circles = (root: Element) =>
  [...root.querySelectorAll('circle')].map((circle) => ({
    r: circle.getAttribute('r'),
    stroke: circle.style.stroke,
    width: circle.style.strokeWidth,
  }));

describe('StateFigure', () => {
  it('draws a state: an ink circle of r 32 on paper, labelled in Geist 18/520', async () => {
    await renderIn(<StateFigure label="q0" accept={false} ring="none" lang="en" />);
    const state = screen.getByRole('img', { name: 'q0' });
    expect(state).toHaveAttribute('data-accept', 'false');
    expect(state).toHaveAttribute('data-ring', 'none');
    expect(circles(state)).toEqual([{ r: '32', stroke: 'var(--color-ink)', width: '2' }]);
    const label = within(state).getByText('q0');
    expect(label.style.fontSize).toBe('18px');
    expect(label.style.fontWeight).toBe('520');
  });

  it('an accepting state has its inner circle at r 26 and says so, in the session language', async () => {
    const { rerender } = await renderIn(
      <StateFigure label="q3" accept={true} ring="none" lang="en" />,
    );
    const state = screen.getByRole('img', { name: 'q3, accepting' });
    expect(state).toHaveAttribute('data-accept', 'true');
    expect(circles(state).map((circle) => circle.r)).toEqual(['32', '26']);
    const i18n = await initI18n('en');
    for (const [lang, name] of [
      ['es', 'q3, de aceptación'],
      ['ko', 'q3, 수락 상태'],
    ] as [Lang, string][]) {
      rerender(
        <I18nextProvider i18n={i18n}>
          <StateFigure label="q3" accept={true} ring="none" lang={lang} />
        </I18nextProvider>,
      );
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
    }
  });

  it('rings a highlighted state at r 38 in iris-ink 2, and the current one in 3 on iris', async () => {
    const { rerender } = await renderIn(
      <StateFigure label="qd" accept={false} ring="highlight" lang="en" />,
    );
    let state = screen.getByRole('img', { name: 'qd' });
    expect(state).toHaveAttribute('data-ring', 'highlight');
    expect(circles(state)).toContainEqual({ r: '38', stroke: 'var(--color-iris-ink)', width: '2' });
    const i18n = await initI18n('en');
    rerender(
      <I18nextProvider i18n={i18n}>
        <StateFigure label="qd" accept={false} ring="current" lang="en" />
      </I18nextProvider>,
    );
    state = screen.getByRole('img', { name: 'qd' });
    expect(state).toHaveAttribute('data-ring', 'current');
    expect(circles(state)).toContainEqual({ r: '38', stroke: 'var(--color-iris-ink)', width: '3' });
    const body = state.querySelector('circle');
    expect(body?.style.fill).toBe('color-mix(in oklab, var(--color-iris) 20%, white)');
  });
});

// Track B's placement sizes the card (TRACE_CARD): 480 wide, 20 px padding around 440 of content.
const RUN: TraceProps = {
  w: 480,
  h: 356,
  lang: 'en',
  input: '1010',
  title: null,
  kind: 'dfa',
  subject: 'student',
  rows: [
    { symbol: '1', from: 'q0', to: 'q0', loop: true, stuck: false },
    { symbol: '0', from: 'q0', to: 'q1', loop: false, stuck: false },
    { symbol: '1', from: 'q1', to: 'q2', loop: false, stuck: false },
    { symbol: '0', from: 'q2', to: 'q3', loop: false, stuck: false },
  ],
  shown: 2,
  verdict: null,
};

describe('TraceCard', () => {
  it('shows the title and the tape, and the rows Ada has shown so far', async () => {
    await renderIn(<TraceCard {...RUN} />);
    const card = screen.getByTestId('trace-card');
    expect(card).toHaveStyle({ width: '480px', padding: '20px', boxSizing: 'border-box' });
    expect(within(card).getByText('Trace · input 1010')).toHaveClass('mono');
    const cells = within(card).getAllByTestId('trace-cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['1', '0', '1', '0']);
    // The newest row has read the second symbol: that cell is blush.
    expect(cells.map((cell) => cell.dataset.reading)).toEqual(['false', 'true', 'false', 'false']);
    const rows = within(card).getAllByTestId('trace-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Step 1read 1q0 → q0loops',
      'Step 2read 0q0 → q1',
    ]);
    expect(rows.map((row) => row.dataset.newest)).toEqual(['false', 'true']);
    expect(within(rows[0]).getByText('loops').style.color).toBe('var(--color-iris-ink)');
  });

  it('shows no move as rejected, and the verdict in ink with its note beside it', async () => {
    await renderIn(
      <TraceCard
        {...RUN}
        rows={[
          { symbol: '1', from: 'q0', to: 'q0', loop: true, stuck: false },
          { symbol: '1', from: 'q0', to: '', loop: false, stuck: true },
        ]}
        shown={2}
        verdict={{ got: 'reject', note: 'Starts with 010? No' }}
      />,
    );
    const rows = screen.getAllByTestId('trace-row');
    expect(rows[1].textContent).toBe('Step 2read 1q0no move: rejected');
    // The verdict row as Track B's verdictRow measures it (VERDICT_ROW): 16 px under the rows,
    // pills 12 px apart that wrap 8 px below, each Geist 15 inside 10 × 18 padding, at most 440.
    const verdict = screen.getByTestId('trace-verdict');
    expect(verdict).toHaveStyle({ marginTop: '16px', columnGap: '12px', rowGap: '8px' });
    const pills = [
      within(verdict).getByText('Your DFA: reject'),
      within(verdict).getByText('Starts with 010? No'),
    ];
    for (const pill of pills) {
      expect(pill).toHaveStyle({
        padding: '10px 18px',
        fontSize: '15px',
        lineHeight: '20px',
        maxWidth: '440px',
        boxSizing: 'border-box',
      });
    }
    expect(pills[0].style.backgroundColor).toBe('var(--color-ink)');
    expect(pills[0].style.color).toBe('var(--color-paper)');
    expect(pills[1].style.boxShadow).toBe('inset 0 0 0 1px var(--color-ink)');
  });

  it("speaks the session's language, not the UI's", async () => {
    await renderIn(
      <TraceCard
        {...RUN}
        lang="es"
        kind="dfa"
        subject="tutor"
        shown={1}
        verdict={{ got: 'accept', note: null }}
      />,
    );
    expect(screen.getByText('Traza · entrada 1010')).toBeInTheDocument();
    expect(screen.getAllByTestId('trace-row').map((row) => row.textContent)).toEqual([
      'Paso 1lee 1q0 → q0se queda',
    ]);
    expect(screen.getByText('Este AFD: acepta')).toBeInTheDocument();
  });

  it('heads the card with its own title when it has one', async () => {
    await renderIn(<TraceCard {...RUN} title="Your DFA on 1010" />);
    expect(screen.getByText('Your DFA on 1010')).toHaveClass('mono');
    expect(screen.queryByText('Trace · input 1010')).toBeNull();
  });
});

describe('NoteFigure', () => {
  it('is an ink box of white Geist 17 filling the box its text was measured for', async () => {
    // Track B's noteSize: the text measured at 320 − 32, inside 10 × 16 padding (NOTE_BOX).
    await renderIn(<NoteFigure w={252} h={68} text="Watch what q0 does on a 1." variant="note" />);
    const note = screen.getByText('Watch what q0 does on a 1.');
    expect(note).toHaveStyle({
      width: '252px',
      height: '68px',
      boxSizing: 'border-box',
      padding: '10px 16px',
      borderRadius: '20px',
      fontSize: '17px',
      fontWeight: '400',
      lineHeight: '24px',
    });
    expect(note.style.backgroundColor).toBe('var(--color-ink)');
    expect(note.style.color).toBe('var(--color-paper)');
  });

  it('a title is a lab label in smoke-text, on one line', async () => {
    await renderIn(<NoteFigure w={300} h={28} text="Reference DFA" variant="title" />);
    const title = screen.getByText('Reference DFA');
    expect(title).toHaveClass('mono');
    expect(title).toHaveStyle({
      fontSize: '12px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    expect(title.style.color).toBe('var(--color-smoke-text)');
  });
});

it('writes overlay notes in colored ink on a transparent background', async () => {
  await renderIn(<NoteFigure transparent w={252} h={68} text="Overlay writing" variant="note" />);
  const note = screen.getByText('Overlay writing');
  expect(note.style.backgroundColor).toBe('transparent');
  expect(note.style.color).toBe('var(--color-ink)');
});
