import type { BeatAction } from '@tassel/shared/beats';
import fixtures from '@tassel/shared/beats/fixtures.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBoardAction } from '../../../src/renderer/src/board/board-store';
import { dispatchActions, isShowing } from '../../../src/renderer/src/board/dispatch';
import { applyPaperAction } from '../../../src/renderer/src/board/marks/marks-store';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { FLOW } from './fixtures';

// The stage store is real; the board's and the paper's sinks are spies, whatever later tasks
// put behind them.
vi.mock('../../../src/renderer/src/board/board-store', () => ({ applyBoardAction: vi.fn() }));
vi.mock('../../../src/renderer/src/board/marks/marks-store', () => ({
  applyPaperAction: vi.fn(),
}));

const stage = () => useStageStore.getState();

const PULSE: BeatAction = { kind: 'board.pulse', item: 'wrong', el: 'state:q3' };
const MARK: BeatAction = {
  kind: 'paper.mark',
  mark: { type: 'circle', id: 'loop', target: { el: 'edge:q0>q0' } },
};
const AUTOMATON = fixtures.actions[0] as BeatAction;

/** What reached the stage, the board and the paper, in order. */
let log: string[] = [];
let unsubscribe = () => {};

beforeEach(() => {
  stage().reset();
  log = [];
  vi.mocked(applyBoardAction)
    .mockReset()
    .mockImplementation((action) => log.push(action.kind));
  vi.mocked(applyPaperAction)
    .mockReset()
    .mockImplementation((action) => log.push(action.kind));
  unsubscribe = useStageStore.subscribe((state, previous) => {
    if (state.requested !== previous.requested) log.push(`request ${state.requested}`);
  });
});
afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
});

describe('dispatchActions', () => {
  it('routes stage, board and paper actions in order', () => {
    dispatchActions([
      { kind: 'stage', view: 'board' },
      { kind: 'board.reveal', item: 'fix' },
      { kind: 'stage', view: 'paper' },
      MARK,
    ]);
    expect(log).toEqual(['request board', 'board.reveal', 'request paper', 'paper.mark']);
    expect(applyBoardAction).toHaveBeenCalledWith({ kind: 'board.reveal', item: 'fix' });
    expect(applyPaperAction).toHaveBeenCalledWith(MARK);
  });

  it('a showing board action on the paper view requests split', () => {
    dispatchActions([PULSE]);
    expect(log).toEqual(['request split', 'board.pulse']);
    expect(stage()).toMatchObject({ mode: 'split', requested: 'split', pinned: null });
  });

  it('a showing board action while pinned to paper keeps the pin and remembers split', () => {
    stage().pin('paper');
    dispatchActions([AUTOMATON]);
    // Nothing is lost: the board gets the action, and the pin shows "Ada asks: Paper and board".
    expect(stage()).toMatchObject({ mode: 'paper', pinned: 'paper', requested: 'split' });
    expect(applyBoardAction).toHaveBeenCalledWith(AUTOMATON);
    stage().unpin();
    expect(stage().mode).toBe('split');
  });

  it("judges by Ada's own view while a view is pinned, not by the pinned one", () => {
    // Board pinned, and Ada has since asked for the paper: her drawing must come back beside it.
    stage().pin('board');
    stage().requestMode('paper');
    dispatchActions([PULSE]);
    expect(stage()).toMatchObject({ mode: 'board', pinned: 'board', requested: 'split' });
    // Paper pinned, and Ada has already asked for the board: that request stands.
    stage().reset();
    stage().pin('paper');
    stage().requestMode('board');
    dispatchActions([PULSE]);
    expect(stage()).toMatchObject({ mode: 'paper', pinned: 'paper', requested: 'board' });
  });

  it('a showing paper action on the board view requests split', () => {
    stage().requestMode('board');
    log = [];
    dispatchActions([{ kind: 'paper.freeze', frame: { kind: 'fixture', name: 'dfa-wrong' } }]);
    expect(log).toEqual(['request split', 'paper.freeze']);
    expect(stage().mode).toBe('split');
  });

  it('leaves the view alone when what she shows is already in it', () => {
    stage().requestMode('board');
    dispatchActions([PULSE]);
    expect(stage().requested).toBe('board');
    stage().requestMode('split');
    dispatchActions([PULSE, MARK]);
    expect(stage().requested).toBe('split');
  });

  it('focus, clear, reveal none and paper.live never change the view', () => {
    dispatchActions([
      { kind: 'board.focus', item: 'fix' },
      { kind: 'board.clear' },
      { ...(AUTOMATON as Extract<BeatAction, { kind: 'board.automaton' }>), reveal: 'none' },
      { kind: 'board.highlight', item: 'wrong', el: 'state:q0', on: false },
    ]);
    expect(stage().requested).toBe('paper');
    stage().requestMode('board');
    log = [];
    dispatchActions([
      { kind: 'paper.live' },
      { kind: 'paper.clear' },
      { kind: 'paper.unmark', id: 'm1' },
    ]);
    expect(stage().requested).toBe('board');
    expect(log).toEqual(['paper.live', 'paper.clear', 'paper.unmark']);
  });

  it('an invalid action is skipped with one warning and the next still applies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dispatchActions([{ kind: 'board.erase', item: 'wrong' }, PULSE]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(applyBoardAction).toHaveBeenCalledTimes(1);
    expect(applyBoardAction).toHaveBeenCalledWith(PULSE);
  });

  it('applies the copy the parser made, not what arrived', () => {
    const data = { kind: 'board.note', item: 'why', text: 'Look here.', near: null };
    dispatchActions([data]);
    expect(applyBoardAction).toHaveBeenCalledWith({
      kind: 'board.note',
      item: 'why',
      text: 'Look here.',
    });
  });

  it('a sink that throws stops nothing: it is reported and the rest still apply', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(applyBoardAction).mockImplementationOnce(() => {
      throw new Error('the board broke');
    });
    expect(() => dispatchActions([PULSE, MARK])).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(applyPaperAction).toHaveBeenCalledWith(MARK);
  });

  it('warns once and does nothing when what arrived is not a list', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => dispatchActions(null as unknown as unknown[])).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);
  });
});

describe('isShowing', () => {
  const NOT_SHOWING: BeatAction[] = [
    { kind: 'board.focus' },
    { kind: 'board.clear', item: 'fix' },
    { ...(AUTOMATON as Extract<BeatAction, { kind: 'board.automaton' }>), reveal: 'none' },
    { kind: 'board.highlight', item: 'wrong', el: 'state:q0', on: false },
    { kind: 'board.diagram', item: 'net', spec: FLOW, reveal: 'none' },
    { kind: 'paper.unmark', id: 'm1' },
    { kind: 'paper.clear' },
    { kind: 'paper.live' },
    { kind: 'stage', view: 'board' },
  ];
  const SHOWING: BeatAction[] = [
    AUTOMATON,
    { kind: 'board.diagram', item: 'net', spec: FLOW },
    { kind: 'board.addState', item: 'fix', id: 'qd' },
    { kind: 'board.addTransition', item: 'fix', from: 'q1', to: 'qd', symbols: ['0'] },
    { kind: 'board.reveal', item: 'fix' },
    { kind: 'board.highlight', item: 'wrong', el: 'state:q0', on: true },
    PULSE,
    { kind: 'board.note', item: 'why', text: 'Look here.' },
    { kind: 'board.traceStep', item: 'run' },
    { kind: 'board.verdict', item: 'run', got: 'accept' },
    { kind: 'paper.freeze', frame: { kind: 'latest' } },
    MARK,
    { kind: 'paper.trace', input: '1010' },
    { kind: 'paper.traceStep' },
  ];

  it.each(NOT_SHOWING)('is false for $kind', (action) => expect(isShowing(action)).toBe(false));
  it.each(SHOWING)('is true for $kind', (action) => expect(isShowing(action)).toBe(true));

  it('treats an automaton without reveal as shown', () => {
    const { reveal: _, ...shown } = AUTOMATON as Extract<BeatAction, { kind: 'board.automaton' }>;
    expect(isShowing(shown)).toBe(true);
  });
});
