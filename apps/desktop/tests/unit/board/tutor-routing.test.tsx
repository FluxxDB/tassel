// @vitest-environment jsdom
import type { ApiClient } from '@tassel/shared/api';
import type { BeatAction, BeatDoc } from '@tassel/shared/beats';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatPlayer } from '../../../src/renderer/src/board/beats/player';
import { applyBoardAction } from '../../../src/renderer/src/board/board-store';
import { applyPaperAction } from '../../../src/renderer/src/board/marks/marks-store';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import type { TutorClient, TutorEvent } from '../../../src/renderer/src/tutor/types';
import { useTutorSession } from '../../../src/renderer/src/tutor/use-tutor-session';

vi.mock('../../../src/renderer/src/board/board-store', () => ({ applyBoardAction: vi.fn() }));
vi.mock('../../../src/renderer/src/board/marks/marks-store', () => ({
  applyPaperAction: vi.fn(),
}));

const SESSION_ID = '7c2a5f1e-0b3d-4e8a-9f6c-1d2e3f4a5b6c';
const REVEAL: BeatAction = { kind: 'board.reveal', item: 'fix', els: ['start', 'state:q0'] };
const MARK: BeatAction = {
  kind: 'paper.mark',
  mark: { type: 'circle', id: 'loop', target: { el: 'edge:q0>q0' } },
};

/** A tutor the test drives (P1's pattern): `emit` delivers an event to whoever listens. */
function scriptedTutor() {
  const listeners = new Set<(event: TutorEvent) => void>();
  const client = {
    connect: vi.fn(async (_sessionId: string) => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((listener: (event: TutorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    sendText: vi.fn(),
  } satisfies TutorClient;
  const emit = (event: TutorEvent) =>
    act(() => {
      for (const listener of listeners) listener(event);
    });
  return { client, emit };
}

function renderTutor(client: TutorClient) {
  const api = { GET: vi.fn(), PATCH: vi.fn() } as unknown as ApiClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={api}>{children}</ApiProvider>
  );
  return renderHook(() => useTutorSession(SESSION_ID, client, true), { wrapper });
}

/** Only tags, nothing to hear: its markers fire when it loads, word-gated player or not. */
const WORDLESS: BeatDoc = {
  version: 1,
  id: 'beat-1',
  turn: 'turn-1',
  segment: 'seg-1',
  lang: 'en',
  text: '',
  durationSec: null,
  shapeSet: 'rhubarb9',
  mouthCues: [],
  words: [],
  markers: [
    { id: 'beat-1.1', word: 0, action: { kind: 'stage', view: 'board' } },
    { id: 'beat-1.2', word: 0, action: REVEAL },
    { id: 'beat-1.3', word: 0, action: MARK },
  ],
};

const stage = () => useStageStore.getState();

beforeEach(() => {
  stage().reset();
  vi.mocked(applyBoardAction).mockReset();
  vi.mocked(applyPaperAction).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('useTutorSession and the board', () => {
  it('an actions event dispatches its actions', () => {
    const { client, emit } = scriptedTutor();
    renderTutor(client);
    emit({ type: 'actions', actions: [{ kind: 'stage', view: 'board' }, REVEAL, MARK] });
    // The paper action came while she was on the board, so the stage splits for it.
    expect(stage()).toMatchObject({ mode: 'split', requested: 'split' });
    expect(applyBoardAction).toHaveBeenCalledWith(REVEAL);
    expect(applyPaperAction).toHaveBeenCalledWith(MARK);
  });

  it('a beat event fires its markers through the player', () => {
    const { client, emit } = scriptedTutor();
    const load = vi.spyOn(beatPlayer, 'load');
    renderTutor(client);
    emit({ type: 'beat', beat: WORDLESS });
    expect(load).toHaveBeenCalledWith(WORDLESS);
    expect(stage()).toMatchObject({ mode: 'split', requested: 'split' });
    expect(applyBoardAction).toHaveBeenCalledWith(REVEAL);
    expect(applyPaperAction).toHaveBeenCalledWith(MARK);
  });

  it('a word event reaches the player with its segment and index', () => {
    const { client, emit } = scriptedTutor();
    const hear = vi.spyOn(beatPlayer, 'hear');
    renderTutor(client);
    emit({ type: 'word', text: 'zero', lang: 'en', segment: 'seg-1', index: 3 });
    expect(hear).toHaveBeenCalledWith({
      text: 'zero',
      lang: 'en',
      segment: 'seg-1',
      index: 3,
      atMs: expect.any(Number),
    });
    // A live word with no place in a document yet (P2's own variant) still reaches it.
    emit({ type: 'word', text: 'q', lang: 'es' });
    expect(hear).toHaveBeenLastCalledWith({ text: 'q', lang: 'es', atMs: expect.any(Number) });
  });

  it('unmount resets the player', () => {
    const { client } = scriptedTutor();
    const reset = vi.spyOn(beatPlayer, 'reset');
    const { unmount } = renderTutor(client);
    expect(reset).not.toHaveBeenCalled();
    unmount();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
