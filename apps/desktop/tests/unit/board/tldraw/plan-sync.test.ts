// planSync diffs Ada's last desired board against her next one, never against the editor, so
// she changes only what she changed: what the student moved or erased stays as she left it.
import { describe, expect, it } from 'vitest';
import {
  adaShapeId,
  type Desired,
  type DesiredBinding,
  type DesiredShape,
  NO_SHAPES,
} from '../../../../src/renderer/src/board/tldraw/desired';
import { planSync } from '../../../../src/renderer/src/board/tldraw/plan-sync';

const R = 32;

function state(item: string, id: string, x: number, y: number, hidden = false): DesiredShape {
  const el = `state:${id}`;
  return {
    id: adaShapeId(item, el),
    type: 'tassel-state',
    x: x - R,
    y: y - R,
    opacity: hidden ? 0 : 1,
    props: { w: 2 * R, h: 2 * R, label: id, accept: false, ring: 'none' },
    meta: { ada: true, item, el, hidden },
  };
}

function arrow(item: string, el: string, x: number, y: number, bend = 0): DesiredShape {
  return {
    id: adaShapeId(item, el),
    type: 'arrow',
    x,
    y,
    opacity: 1,
    props: { kind: 'arc', bend, label: '0', color: 'black' },
    meta: { ada: true, item, el, hidden: false },
  };
}

function binding(
  item: string,
  el: string,
  terminal: 'start' | 'end',
  to: string,
  normalizedAnchor = { x: 0.5, y: 0.5 },
): DesiredBinding {
  return {
    id: `binding:ada.${item}.${el}.${terminal}`,
    arrow: adaShapeId(item, el),
    to: adaShapeId(item, `state:${to}`),
    terminal,
    normalizedAnchor,
    isPrecise: false,
  };
}

function board(shapes: DesiredShape[], bindings: DesiredBinding[] = []): Desired {
  return {
    shapes: new Map(shapes.map((shape) => [shape.id, shape])),
    bindings: new Map(bindings.map((b) => [b.id, b])),
  };
}

/** q0 -0-> q1 with its start arrow, laid out with q0 at (x0, 100) and q1 at (x1, 100). */
function fix(opts: { x0?: number; x1?: number; bend?: number; q1Hidden?: boolean } = {}) {
  const { x0 = 100, x1 = 220, bend = 0, q1Hidden = false } = opts;
  const shapes = [
    arrow('fix', 'start', x0 - 80, 100),
    state('fix', 'q0', x0, 100),
    state('fix', 'q1', x1, 100, q1Hidden),
    arrow('fix', 'edge:q0>q1', x0, 100, bend),
  ];
  const bindings = [
    binding('fix', 'start', 'end', 'q0'),
    binding('fix', 'edge:q0>q1', 'start', 'q0'),
    binding('fix', 'edge:q0>q1', 'end', 'q1'),
  ];
  return { shapes, bindings };
}

const EMPTY_PLAN = { create: [], update: [], remove: [], bind: [], unbind: [] };

describe('planSync', () => {
  it('an unchanged board plans nothing', () => {
    expect(planSync(NO_SHAPES, NO_SHAPES)).toEqual(EMPTY_PLAN);
    const a = fix();
    const b = fix();
    expect(planSync(board(a.shapes, a.bindings), board(b.shapes, b.bindings))).toEqual(EMPTY_PLAN);
  });

  it('creates and binds what is new, in that order of business', () => {
    const { shapes, bindings } = fix();
    const plan = planSync(NO_SHAPES, board(shapes, bindings));
    expect(plan.create.map((shape) => shape.id)).toEqual(shapes.map((shape) => shape.id));
    expect(plan.bind).toEqual(bindings);
    expect([plan.update, plan.remove, plan.unbind]).toEqual([[], [], []]);
  });

  it('a reveal updates only opacity', () => {
    const before = fix({ q1Hidden: true });
    const after = fix();
    const plan = planSync(
      board(before.shapes, before.bindings),
      board(after.shapes, after.bindings),
    );
    const q1 = adaShapeId('fix', 'state:q1');
    // Only what the reveal changes: q1's opacity and its hidden mark (P5-R5, I2).
    expect(plan.update).toEqual([
      {
        id: q1,
        type: 'tassel-state',
        opacity: 1,
        meta: { ada: true, item: 'fix', el: 'state:q1', hidden: false },
      },
    ]);
    expect([plan.create, plan.remove, plan.bind, plan.unbind]).toEqual([[], [], [], []]);
  });

  it('a removed item removes its shapes and bindings', () => {
    const { shapes, bindings } = fix();
    const note: DesiredShape = {
      id: adaShapeId('n1', 'note'),
      type: 'tassel-note',
      x: 0,
      y: 400,
      opacity: 1,
      props: { w: 200, h: 44, text: 'Look at q0', variant: 'note' },
      meta: { ada: true, item: 'n1', el: 'note', hidden: false },
    };
    const plan = planSync(board([...shapes, note], bindings), board([note]));
    expect(plan.remove).toEqual(shapes.map((shape) => shape.id));
    expect(plan.unbind).toEqual(bindings.map((b) => b.id));
    expect([plan.create, plan.update, plan.bind]).toEqual([[], [], []]);
  });

  it("Ada's later changes never move a state back", () => {
    // The student dragged q0 somewhere in the editor. Ada then highlights q1: her plan touches
    // q1's ring and nothing else, so q0 stays where the student put it.
    const before = fix();
    const after = fix();
    const q1 = after.shapes[2];
    after.shapes[2] = { ...q1, props: { ...q1.props, ring: 'highlight' } };
    const plan = planSync(
      board(before.shapes, before.bindings),
      board(after.shapes, after.bindings),
    );
    expect(plan.update).toEqual([
      { id: adaShapeId('fix', 'state:q1'), type: 'tassel-state', props: { ring: 'highlight' } },
    ]);
    expect(plan.update.some((update) => update.id === adaShapeId('fix', 'state:q0'))).toBe(false);
  });

  it('a re-laid-out automaton moves only its states', () => {
    const before = fix({ x0: 100, x1: 220, bend: 0 });
    const after = fix({ x0: 140, x1: 300, bend: -24 });
    const plan = planSync(
      board(before.shapes, before.bindings),
      board(after.shapes, after.bindings),
    );
    expect([plan.create, plan.remove, plan.bind, plan.unbind]).toEqual([[], [], [], []]);
    const moved = plan.update.filter((update) => 'x' in update || 'y' in update);
    // The states move; an edge bound at both ends follows them, so only its bend changes. The
    // start arrow's tail is free, so it moves with q0.
    expect(moved.map((update) => update.id).sort()).toEqual(
      [
        adaShapeId('fix', 'start'),
        adaShapeId('fix', 'state:q0'),
        adaShapeId('fix', 'state:q1'),
      ].sort(),
    );
    expect(plan.update.find((update) => update.id === adaShapeId('fix', 'edge:q0>q1'))).toEqual({
      id: adaShapeId('fix', 'edge:q0>q1'),
      type: 'arrow',
      props: { bend: -24 },
    });
  });

  it('a moved anchor rebinds that end only', () => {
    const before = fix();
    const after = fix();
    after.bindings[2] = binding('fix', 'edge:q0>q1', 'end', 'q1', { x: 0.3, y: 0.06 });
    const plan = planSync(
      board(before.shapes, before.bindings),
      board(after.shapes, after.bindings),
    );
    expect(plan.unbind).toEqual([after.bindings[2].id]);
    expect(plan.bind).toEqual([after.bindings[2]]);
    expect([plan.create, plan.update, plan.remove]).toEqual([[], [], []]);
  });

  it('a shape that changes type is replaced', () => {
    const shape = state('n1', 'q0', 100, 100);
    const swapped: DesiredShape = { ...shape, type: 'tassel-note', props: { w: 1, h: 1 } };
    const plan = planSync(board([shape]), board([swapped]));
    expect(plan.remove).toEqual([shape.id]);
    expect(plan.create).toEqual([swapped]);
    expect(plan.update).toEqual([]);
  });
});

describe('adaShapeId', () => {
  it('names a shape by its item and element', () => {
    expect(adaShapeId('fix', 'state:q0')).toBe('shape:ada.fix.state:q0');
    expect(adaShapeId('fix', 'edge:q3>q3')).toBe('shape:ada.fix.edge:q3>q3');
  });
});
