// @vitest-environment jsdom
// The board's text alternative: what Ada has revealed of her automata, in the session's language.
import type { ApiClient, Session } from '@tassel/shared/api';
import type { BoardAction } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import { act, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardDescription } from '../../../src/renderer/src/board/BoardDescription';
import { applyBoardAction, useBoardStore } from '../../../src/renderer/src/board/board-store';
import {
  forgetCurrentSession,
  useCurrentSession,
} from '../../../src/renderer/src/features/session/current-session';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import { CORRECT, NETWORK, WRONG } from './fixtures';

vi.mock('../../../src/renderer/src/board/layout/client', () => ({
  getLayoutClient: () => ({
    layout: () => new Promise(() => {}),
    layoutDiagram: () => new Promise(() => {}),
    dispose: () => {},
  }),
}));

function session(language: Lang): Session {
  return {
    id: '5b1e9c2d-3f4a-4b6c-8d7e-9f0a1b2c3d4e',
    title: null,
    title_source: null,
    subject: null,
    type: 'studying',
    language,
    source: 'paper',
    created_at: '2026-10-17T12:00:00.000000Z',
    last_activity_at: '2026-10-17T12:00:00.000000Z',
  };
}

/** Renders the description in an English UI for a session in `language`, once it has loaded. */
async function renderFor(language: Lang) {
  const i18n = await initI18n('en');
  const open = session(language);
  const GET = vi.fn(async () => ({ data: open, response: new Response(null) }));
  let load: (id: string) => Promise<void> = async () => {};
  function Loader() {
    load = useCurrentSession().load;
    return null;
  }
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={{ GET } as unknown as ApiClient}>
        <Loader />
        <BoardDescription />
      </ApiProvider>
    </I18nextProvider>,
  );
  await act(() => load(open.id));
}

const items = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

beforeEach(() => {
  useBoardStore.getState().reset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  forgetCurrentSession();
  vi.restoreAllMocks();
});

const draw = (reveal: 'all' | 'none'): BoardAction => ({
  kind: 'board.automaton',
  item: 'fix',
  spec: CORRECT,
  reveal,
});

describe('BoardDescription', () => {
  it('lists revealed states, the start, accepting states and transitions in the session language', async () => {
    await renderFor('es');
    act(() => applyBoardAction(draw('all')));
    const list = screen.getByRole('list', { name: 'Lo que hay en la pizarra de Ada' });
    expect(list).toHaveClass('sr-only');
    expect(list).toHaveAttribute('lang', 'es');
    expect(items('Lo que hay en la pizarra de Ada')).toEqual([
      'Estados: q0, q1, q2, q3, qd',
      'Inicio: q0',
      'De aceptación: q3',
      'De q0 a q1 con 0',
      'De q1 a q2 con 1',
      'De q2 a q3 con 0',
      'De q3 a q3 con 0, 1',
      'De q0 a qd con 1',
      'De q1 a qd con 0',
      'De q2 a qd con 1',
      'De qd a qd con 0, 1',
    ]);
  });

  it("lists a trace card's steps so far and its verdict, and notes, in the session language (M3)", async () => {
    await renderFor('es');
    act(() => {
      applyBoardAction({
        kind: 'board.trace',
        item: 'run',
        spec: WRONG,
        input: '100',
        subject: 'student',
      });
      applyBoardAction({ kind: 'board.traceStep', item: 'run', step: 2 });
      applyBoardAction({ kind: 'board.note', item: 'n1', text: 'Mira q0 con un 1.' });
    });
    const name = 'Lo que hay en la pizarra de Ada';
    // Only the steps Ada has shown.
    expect(items(name)).toEqual([
      'Traza · entrada 100',
      'Paso 1: lee 1, de q0 a q0',
      'Paso 2: lee 0, de q0 a q1',
      'Nota: Mira q0 con un 1.',
    ]);
    act(() => {
      applyBoardAction({ kind: 'board.traceStep', item: 'run' });
      applyBoardAction({
        kind: 'board.verdict',
        item: 'run',
        got: 'reject',
        note: '¿Empieza con 010? No',
      });
    });
    expect(items(name)).toEqual([
      'Traza · entrada 100',
      'Paso 1: lee 1, de q0 a q0',
      'Paso 2: lee 0, de q0 a q1',
      'Paso 3: lee 0, sin transición desde q1: rechaza',
      'Tu AFD: rechaza',
      '¿Empieza con 010? No',
      'Nota: Mira q0 con un 1.',
    ]);
  });

  it('heads a titled trace with its own title, in English too', async () => {
    await renderFor('en');
    act(() => {
      applyBoardAction({
        kind: 'board.trace',
        item: 'run',
        title: 'Your DFA on 1010',
        spec: WRONG,
        input: '1',
      });
      applyBoardAction({ kind: 'board.traceStep', item: 'run' });
      applyBoardAction({ kind: 'board.verdict', item: 'run', got: 'reject' });
    });
    expect(items("What's on Ada's board")).toEqual([
      'Your DFA on 1010',
      'Step 1: read 1, q0 to q0',
      'This DFA: reject',
    ]);
  });

  it("hidden elements aren't listed", async () => {
    await renderFor('en');
    act(() => applyBoardAction(draw('none')));
    expect(screen.getByRole('list', { name: "What's on Ada's board" })).toBeEmptyDOMElement();
    act(() => applyBoardAction({ kind: 'board.reveal', item: 'fix', els: ['edge:q0>q1'] }));
    expect(items("What's on Ada's board")).toEqual(['States: q0, q1', 'q0 to q1 on 0']);
    act(() =>
      applyBoardAction({ kind: 'board.reveal', item: 'fix', els: ['start', 'edge:q2>q3'] }),
    );
    expect(items("What's on Ada's board")).toEqual([
      'States: q0, q1, q2, q3',
      'Start: q0',
      'Accepting: q3',
      'q0 to q1 on 0',
      'q2 to q3 on 0',
    ]);
  });
  it('describes a diagram as its groups and their nodes, each node, then its links', async () => {
    await renderFor('en');
    act(() =>
      applyBoardAction({ kind: 'board.diagram', item: 'net', spec: NETWORK, reveal: 'none' }),
    );
    expect(screen.getByRole('list', { name: "What's on Ada's board" })).toBeEmptyDOMElement();
    act(() => applyBoardAction({ kind: 'board.reveal', item: 'net', els: ['edge:core>rA'] }));
    expect(items("What's on Ada's board")).toEqual([
      'Diagram: Subnets 192.168.1.0/24',
      'Zone A (192.168.1.0/26): Router A',
      'Core switch: switch',
      'Router A: router, 192.168.1.1',
      'Core switch connected to Router A, Gi0/1',
    ]);
    act(() => applyBoardAction({ kind: 'board.reveal', item: 'net' }));
    const all = items("What's on Ada's board");
    expect(all.slice(0, 4)).toEqual([
      'Diagram: Subnets 192.168.1.0/24',
      'Zone A (192.168.1.0/26): Router A, PC A1, PC A2',
      'Zone B (192.168.1.64/27): Router B, PC B1, PC B2',
      'Zone C (192.168.1.96/28): Router C, PC C1, PC C2',
    ]);
    expect(all).toContain('PC B2: laptop, 192.168.1.71');
    expect(all).toContain('Router A connected to PC A1');
    expect(all).toHaveLength(4 + 10 + 9);
  });

  it('describes a diagram in the session language', async () => {
    await renderFor('ko');
    act(() =>
      applyBoardAction({
        kind: 'board.diagram',
        item: 'flow',
        spec: {
          direction: 'TB',
          groups: [],
          nodes: [
            { id: 'a', label: '요청', icon: 'circle' },
            { id: 'b', label: '주문', icon: 'database' },
          ],
          edges: [{ from: 'a', to: 'b', label: '허용', directed: true, style: 'solid' }],
        },
      }),
    );
    const name = screen.getByRole('list').getAttribute('aria-label') ?? '';
    expect(items(name)).toEqual(['요청: 원', '주문: 데이터베이스', '요청에서 주문까지, 허용']);
  });
});
