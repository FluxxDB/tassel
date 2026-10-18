import type { BoardAction } from '@tassel/shared/beats';
import { type Lang, resources } from '@tassel/shared/i18n';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { beforeAll, describe, expect, it } from 'vitest';
import { fallbackLayout } from '../../../../src/renderer/src/board/layout/fallback';
import type { AutomatonLayout } from '../../../../src/renderer/src/board/layout/types';
import {
  type BoardText,
  ITEM_GAP,
  itemSize,
  type MeasureText,
  NOTE_BOX,
  noteSize,
  placeItems,
  TRACE_CARD,
  type Translate,
  traceSize,
  VERDICT_ROW,
  verdictPills,
} from '../../../../src/renderer/src/board/scene/placement';
import { EMPTY_SCENE, reduceBoard } from '../../../../src/renderer/src/board/scene/reduce';
import type { BoardScene, TraceItem } from '../../../../src/renderer/src/board/scene/types';
import { CORRECT, WRONG } from '../fixtures';

/**
 * A stand-in for the DOM: every character is ADVANCE px wide and every line LINE px high, and
 * lines break between words, keeping each word whole unless it alone is too wide.
 */
const ADVANCE = { note: 9, verdict: 8 } as const;
const LINE = { note: 24, verdict: 20 } as const;
const measure: MeasureText = (text, style, maxWidth) => {
  const advance = ADVANCE[style as keyof typeof ADVANCE] ?? 8;
  const perLine = Math.max(1, Math.floor(maxWidth / advance));
  const lines: number[] = [];
  let line = -1;
  for (const word of text.split(' ')) {
    let chars = [...word].length;
    if (line >= 0 && line + 1 + chars <= perLine) {
      line += 1 + chars;
      continue;
    }
    if (line >= 0) lines.push(line);
    for (; chars > perLine; chars -= perLine) lines.push(perLine);
    line = chars;
  }
  lines.push(Math.max(line, 0));
  return {
    w: Math.max(...lines) * advance,
    h: lines.length * (LINE[style as keyof typeof LINE] ?? 16),
  };
};

/** Board copy in `lng`, as the board store gets it: i18next with ICU and the shared catalogs. */
async function translator(lng: Lang): Promise<Translate> {
  const i18n = i18next.createInstance().use(ICU);
  await i18n.init({ resources, lng, fallbackLng: 'en', interpolation: { escapeValue: false } });
  return (key, values) => String(i18n.t(key, { ...values, lng }));
}

let text: Record<Lang, BoardText>;
beforeAll(async () => {
  const [en, es, ko] = await Promise.all([translator('en'), translator('es'), translator('ko')]);
  text = { en: { measure, t: en }, es: { measure, t: es }, ko: { measure, t: ko } };
});

/** 280 code points of Spanish and of Korean (spaced words), the most a note or a verdict holds. */
const SPANISH =
  'Este bucle en q0 es lo que deja pasar a 1010: con un 1 al principio te quedas en q0, '
    .repeat(4)
    .slice(0, 280);
const KOREAN = '이 루프 때문에 1010이 통과해요. 처음에 1이 오면 q0에 그대로 머물러요. '
  .repeat(8)
  .slice(0, 280);

function scene(...actions: BoardAction[]): BoardScene {
  return actions.reduce((current, action) => reduceBoard(current, action).scene, EMPTY_SCENE);
}

const LAYOUTS: Record<string, AutomatonLayout> = {
  wrong: fallbackLayout(WRONG),
  fix: fallbackLayout(CORRECT),
};

describe('placeItems', () => {
  it('stacks items 64 apart', () => {
    const board = scene(
      { kind: 'board.automaton', item: 'wrong', spec: WRONG },
      { kind: 'board.trace', item: 'run', spec: WRONG, input: '1010' },
      { kind: 'board.note', item: 'aside', text: 'Try 0100 next.' },
    );
    const boxes = placeItems(board, LAYOUTS, text.en);
    const trace = traceSize('1010', 4, [], measure);
    const aside = noteSize('Try 0100 next.', measure);

    expect(ITEM_GAP).toBe(64);
    expect(boxes).toEqual({
      wrong: { x: 0, y: 0, w: LAYOUTS.wrong.width, h: LAYOUTS.wrong.height },
      run: { x: 0, y: LAYOUTS.wrong.height + 64, ...trace },
      aside: { x: 0, y: LAYOUTS.wrong.height + 64 + trace.h + 64, ...aside },
    });
  });

  it('puts a note beside its item', () => {
    const board = scene(
      { kind: 'board.automaton', item: 'wrong', spec: WRONG },
      { kind: 'board.automaton', item: 'fix', spec: CORRECT },
      {
        kind: 'board.note',
        item: 'why',
        text: 'This loop.',
        near: { item: 'fix', el: 'state:q0' },
      },
    );
    const boxes = placeItems(board, LAYOUTS, text.en);

    expect(boxes.why).toEqual({
      x: LAYOUTS.fix.width + 32,
      y: boxes.fix.y,
      ...noteSize('This loop.', measure),
    });
  });

  it('stacks the notes beside one item, each below the last', () => {
    const board = scene(
      { kind: 'board.automaton', item: 'wrong', spec: WRONG },
      { kind: 'board.note', item: 'one', text: SPANISH, near: { item: 'wrong', el: 'start' } },
      { kind: 'board.note', item: 'two', text: 'Then this.', near: { item: 'wrong', el: 'start' } },
    );
    const boxes = placeItems(board, LAYOUTS, text.en);

    expect(boxes.two).toMatchObject({ x: boxes.one.x, y: boxes.one.y + boxes.one.h + 16 });
  });

  it('leaves items after a pending layout unplaced', () => {
    const board = scene(
      { kind: 'board.automaton', item: 'wrong', spec: WRONG },
      { kind: 'board.automaton', item: 'fix', spec: CORRECT },
      { kind: 'board.note', item: 'why', text: 'Here.', near: { item: 'fix', el: 'state:q0' } },
      { kind: 'board.trace', item: 'run', spec: WRONG, input: '1010' },
    );

    expect(Object.keys(placeItems(board, { wrong: LAYOUTS.wrong }, text.en))).toEqual(['wrong']);
    expect(Object.keys(placeItems(board, LAYOUTS, text.en))).toEqual([
      'wrong',
      'fix',
      'why',
      'run',
    ]);
  });

  it('places a note whose item is gone in the column', () => {
    const board: BoardScene = {
      items: [{ kind: 'note', id: 'why', text: 'Here.', near: { item: 'gone', el: 'start' } }],
      focus: null,
      rev: 1,
    };

    expect(placeItems(board, LAYOUTS, text.en).why).toMatchObject({ x: 0, y: 0 });
  });
});

describe('itemSize', () => {
  it("is an automaton's layout size, plus 28 px for a title row", () => {
    const board = scene(
      { kind: 'board.automaton', item: 'wrong', spec: WRONG },
      { kind: 'board.automaton', item: 'fix', spec: CORRECT, title: 'A DFA that works' },
    );

    expect(itemSize(board.items[0], LAYOUTS, text.en)).toEqual({
      w: LAYOUTS.wrong.width,
      h: LAYOUTS.wrong.height,
    });
    expect(itemSize(board.items[1], LAYOUTS, text.en)).toEqual({
      w: LAYOUTS.fix.width,
      h: LAYOUTS.fix.height + 28,
    });
    expect(itemSize(board.items[1], {}, text.en)).toBeNull();
  });

  it("sizes a trace for every step of its run and its verdict, in the session's language", () => {
    const board = scene(
      { kind: 'board.trace', item: 'run', spec: WRONG, input: '00', subject: 'student' },
      { kind: 'board.verdict', item: 'run', got: 'reject', note: SPANISH },
    );
    const run = board.items[0] as TraceItem;

    expect(run.run.steps).toHaveLength(2);
    expect(itemSize(run, LAYOUTS, text.es)).toEqual(
      traceSize('00', 2, ['Tu AFD: rechaza', SPANISH], measure),
    );
  });
});

describe('traceSize', () => {
  it("traceSize('1010', 4, verdict) is { w: 480, h: 356 }: 440 px of content in a 480 px card", () => {
    expect(TRACE_CARD.contentWidth).toBe(440);
    expect(
      traceSize('1010', 4, ['Your DFA: accept', 'Starts with 010? No → reject'], measure),
    ).toEqual({ w: 480, h: 356 });
  });

  it('is 132 + 42 per row without a verdict', () => {
    expect(traceSize('1010', 4, [], measure)).toEqual({ w: 480, h: 300 });
    expect(traceSize('', 0, [], measure)).toEqual({ w: 480, h: 132 });
  });

  it('widens by 52 px a symbol past 8 symbols', () => {
    expect(traceSize('010101010', 9, [], measure).w).toBe(40 + 52 * 9);
    expect(traceSize('0'.repeat(64), 64, [], measure).w).toBe(40 + 52 * 64);
  });

  it.each([
    ['Spanish', SPANISH],
    ['Korean', KOREAN],
  ])(
    'wraps a 280-character %s verdict note onto a row of its own, at its measured height',
    (_, note) => {
      const pill = measure(note, 'verdict', 440 - 2 * VERDICT_ROW.padX);
      expect(pill.h).toBeGreaterThan(LINE.verdict);

      expect(traceSize('1010', 4, ['Tu AFD: acepta', note], measure)).toEqual({
        w: 480,
        h: 132 + 42 * 4 + 16 + 40 + 8 + (pill.h + 20),
      });
    },
  );
});

describe('noteSize', () => {
  it('fits a short note to its text, inside 10×16 padding', () => {
    expect(noteSize('Here.', measure)).toEqual({ w: 5 * 9 + 32, h: 24 + 20 });
  });

  it.each([
    ['Spanish', SPANISH],
    ['Korean', KOREAN],
  ])('wraps a 280-character %s note at 320 px, at its measured height', (_, note) => {
    const lines = measure(note, 'note', NOTE_BOX.maxWidth - 2 * NOTE_BOX.padX);
    const size = noteSize(note, measure);

    expect(lines.h).toBeGreaterThan(LINE.note * 4);
    expect(size.w).toBeLessThanOrEqual(320);
    expect(size).toEqual({ w: lines.w + 32, h: lines.h + 20 });
  });
});

describe('verdictPills', () => {
  const traced = (subject: 'student' | 'tutor', verdict?: BoardAction) =>
    scene(
      { kind: 'board.trace', item: 'run', spec: WRONG, input: '1010', subject },
      ...(verdict ? [verdict] : []),
    ).items[0] as TraceItem;
  const accept: BoardAction = {
    kind: 'board.verdict',
    item: 'run',
    got: 'accept',
    note: 'Starts with 010? No → reject',
  };

  it("names hers 'Your DFA' and Ada's 'This DFA', in the session's language", () => {
    expect(verdictPills(traced('student', accept), text.en.t)).toEqual([
      'Your DFA: accept',
      'Starts with 010? No → reject',
    ]);
    expect(verdictPills(traced('student', accept), text.es.t)[0]).toBe('Tu AFD: acepta');
    expect(verdictPills(traced('student', accept), text.ko.t)[0]).toBe('내 DFA: 수락');
    expect(
      verdictPills(
        traced('tutor', { kind: 'board.verdict', item: 'run', got: 'reject' }),
        text.en.t,
      ),
    ).toEqual(['This DFA: reject']);
  });

  it('is empty before the verdict', () => {
    expect(verdictPills(traced('tutor'), text.en.t)).toEqual([]);
  });
});
