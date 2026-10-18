// board.diagram in the scene: a diagram item, replaced in place by the same item, and its pieces
// (node:ID, group:ID, edge:A>B) revealed, highlighted, pulsed and noted like an automaton's.
import type { BoardAction, DiagramSpec } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import {
  diagramEdges,
  diagramElements,
  diagramSizes,
  GROUP_LABEL,
  NODE_CARD,
} from '../../../../src/renderer/src/board/scene/diagram';
import type { MeasureText } from '../../../../src/renderer/src/board/scene/placement';
import {
  EMPTY_SCENE,
  isRevealed,
  reduceBoard,
} from '../../../../src/renderer/src/board/scene/reduce';
import type {
  BoardEffect,
  BoardScene,
  DiagramItem,
  NoteItem,
} from '../../../../src/renderer/src/board/scene/types';
import { CORRECT, FLOW, NETWORK } from '../fixtures';

function run(scene: BoardScene, ...actions: BoardAction[]) {
  const effects: BoardEffect[] = [];
  const problems: string[] = [];
  let current = scene;
  for (const action of actions) {
    const result = reduceBoard(current, action);
    current = result.scene;
    effects.push(...result.effects);
    if (result.problem !== null) problems.push(result.problem);
  }
  return { scene: current, effects, problems };
}

const draw = (spec: DiagramSpec, reveal?: 'all' | 'none', item = 'net'): BoardAction => ({
  kind: 'board.diagram',
  item,
  spec,
  ...(reveal && { reveal }),
});

function diagram(scene: BoardScene, id = 'net'): DiagramItem {
  const found = scene.items.find((i) => i.id === id);
  expect(found?.kind).toBe('diagram');
  return found as DiagramItem;
}

describe('diagram elements', () => {
  it("lists a diagram's groups, then nodes, then its edges as edge:A>B", () => {
    expect(diagramElements(FLOW)).toEqual([
      'node:start',
      'node:check',
      'node:db',
      'edge:start>check',
      'edge:check>db',
    ]);
    const all = diagramElements(NETWORK);
    expect(all.slice(0, 3)).toEqual(['group:zoneA', 'group:zoneB', 'group:zoneC']);
    expect(all).toContain('node:core');
    expect(all).toContain('edge:core>rA');
    expect(all).toHaveLength(3 + 10 + 9);
  });

  it('draws one edge per ordered pair, and no self-loop', () => {
    const spec: DiagramSpec = {
      ...FLOW,
      edges: [
        { from: 'start', to: 'check', directed: true, style: 'solid' },
        { from: 'start', to: 'check', label: 'again', directed: true, style: 'dashed' },
        { from: 'db', to: 'db', directed: true, style: 'solid' },
      ],
    };
    expect(diagramEdges(spec)).toEqual([
      { from: 'start', to: 'check', directed: true, style: 'solid' },
    ]);
  });
});

describe('board.diagram', () => {
  it('puts a diagram on the board, all shown by default, and focuses it', () => {
    const { scene, problems } = run(EMPTY_SCENE, draw(NETWORK));
    expect(problems).toEqual([]);
    const net = diagram(scene);
    expect(net).toEqual({
      kind: 'diagram',
      id: 'net',
      title: 'Subnets 192.168.1.0/24',
      spec: NETWORK,
      revealed: 'all',
      highlighted: [],
    });
    expect(scene.focus).toBe('net');
  });

  it('hidden with reveal none, then revealed piece by piece with what each needs', () => {
    const { scene, problems } = run(
      EMPTY_SCENE,
      draw(NETWORK, 'none'),
      { kind: 'board.reveal', item: 'net', els: ['node:core'] },
      // An edge brings its two nodes, and a node its group.
      { kind: 'board.reveal', item: 'net', els: ['edge:core>rA'] },
    );
    expect(problems).toEqual([]);
    const net = diagram(scene);
    expect(net.revealed).toEqual(['node:core', 'group:zoneA', 'node:rA', 'edge:core>rA']);
    expect(isRevealed(net, 'node:pcA1')).toBe(false);
  });

  it('revealing a group shows the zone and every node in it', () => {
    const { scene } = run(EMPTY_SCENE, draw(NETWORK, 'none'), {
      kind: 'board.reveal',
      item: 'net',
      els: ['group:zoneB'],
    });
    expect(diagram(scene).revealed).toEqual(['group:zoneB', 'node:rB', 'node:pcB1', 'node:pcB2']);
  });

  it('takes an undirected edge either way round, and names it as drawn', () => {
    const { scene, problems } = run(
      EMPTY_SCENE,
      draw(NETWORK, 'none'),
      { kind: 'board.reveal', item: 'net', els: ['edge:rA>core'] },
      { kind: 'board.highlight', item: 'net', el: 'edge:pcA1>rA', on: true },
    );
    expect(problems).toEqual([]);
    expect(diagram(scene).revealed).toContain('edge:core>rA');
    expect(diagram(scene).highlighted).toEqual(['edge:rA>pcA1']);
    // A directed edge only its own way.
    const flow = run(EMPTY_SCENE, draw(FLOW, 'none', 'flow'), {
      kind: 'board.reveal',
      item: 'flow',
      els: ['edge:check>start'],
    });
    expect(flow.problems).toEqual(['unknown element edge:check>start']);
  });

  it('a reveal of something not in the diagram says so, and the rest still applies', () => {
    const { scene, problems } = run(EMPTY_SCENE, draw(NETWORK, 'none'), {
      kind: 'board.reveal',
      item: 'net',
      els: ['node:nope', 'state:q0', 'node:core'],
    });
    expect(problems).toEqual(['unknown element node:nope, state:q0']);
    expect(diagram(scene).revealed).toEqual(['node:core']);
  });

  it('reveal with no els shows everything', () => {
    const { scene } = run(EMPTY_SCENE, draw(NETWORK, 'none'), {
      kind: 'board.reveal',
      item: 'net',
    });
    expect(diagram(scene).revealed).toBe('all');
  });

  it('highlights nodes, groups and edges, and turns them off', () => {
    const { scene, problems } = run(
      EMPTY_SCENE,
      draw(NETWORK),
      { kind: 'board.highlight', item: 'net', el: 'node:rA', on: true },
      { kind: 'board.highlight', item: 'net', el: 'group:zoneC', on: true },
      { kind: 'board.highlight', item: 'net', el: 'edge:core>rB', on: true },
      { kind: 'board.highlight', item: 'net', el: 'node:rA', on: false },
    );
    expect(problems).toEqual([]);
    expect(diagram(scene).highlighted).toEqual(['group:zoneC', 'edge:core>rB']);
    const bad = run(scene, { kind: 'board.highlight', item: 'net', el: 'state:q0', on: true });
    expect(bad.problems).toEqual(['unknown element state:q0']);
    expect(bad.scene).toBe(scene);
  });

  it('pulses a shown node, with no change to the scene', () => {
    const shown = run(EMPTY_SCENE, draw(NETWORK)).scene;
    const result = reduceBoard(shown, { kind: 'board.pulse', item: 'net', el: 'node:core' });
    expect(result.scene).toBe(shown);
    expect(result.effects).toEqual([{ type: 'pulse', item: 'net', el: 'node:core' }]);
    const hidden = run(EMPTY_SCENE, draw(NETWORK, 'none')).scene;
    expect(reduceBoard(hidden, { kind: 'board.pulse', item: 'net', el: 'node:core' }).problem).toBe(
      'not shown node:core',
    );
  });

  it('the same item again replaces the diagram in place, keeping what is still there', () => {
    const before = run(
      EMPTY_SCENE,
      draw(FLOW, undefined, 'title'),
      draw(NETWORK, 'none'),
      { kind: 'board.reveal', item: 'net', els: ['edge:core>rA', 'node:rB'] },
      { kind: 'board.highlight', item: 'net', el: 'node:rA', on: true },
      { kind: 'board.highlight', item: 'net', el: 'node:rB', on: true },
    ).scene;
    // Ada drops zone B and adds a firewall in front of the core.
    const edited: DiagramSpec = {
      ...NETWORK,
      groups: NETWORK.groups.filter((g) => g.id !== 'zoneB'),
      nodes: [
        ...NETWORK.nodes.filter((n) => n.group !== 'zoneB'),
        { id: 'fw', label: 'Firewall', icon: 'firewall' },
      ],
      edges: [
        ...NETWORK.edges.filter((e) => !['rB'].includes(e.from) && e.to !== 'rB'),
        { from: 'fw', to: 'core', directed: false, style: 'solid' },
      ],
    };
    const { scene, problems } = run(before, draw(edited, 'none'));
    expect(problems).toEqual([]);
    // Still second on the board, where it was.
    expect(scene.items.map((i) => i.id)).toEqual(['title', 'net']);
    const net = diagram(scene);
    expect(net.spec).toEqual(edited);
    // What she had shown and is still there stays shown; the new firewall waits for her.
    expect(net.revealed).toEqual(['node:core', 'group:zoneA', 'node:rA', 'edge:core>rA']);
    expect(net.highlighted).toEqual(['node:rA']);
    // Without reveal: none, the new version shows whole.
    expect(diagram(run(before, draw(edited)).scene).revealed).toBe('all');
  });

  it('a note sits by a diagram element, and goes with the diagram when it is cleared', () => {
    const { scene, problems } = run(
      EMPTY_SCENE,
      draw(NETWORK),
      {
        kind: 'board.note',
        item: 'gw',
        text: 'Each router is its zone’s gateway',
        near: { item: 'net', el: 'node:rA' },
      },
      { kind: 'board.note', item: 'bad', text: 'x', near: { item: 'net', el: 'node:zz' } },
    );
    expect(problems).toEqual(['unknown element node:zz']);
    expect((scene.items[1] as NoteItem).near).toEqual({ item: 'net', el: 'node:rA' });
    const cleared = run(scene, { kind: 'board.clear', item: 'net' }).scene;
    expect(cleared.items.map((i) => i.id)).toEqual(['bad']);
    expect(cleared.focus).toBeNull();
  });

  it('focus and clear take a diagram like any item', () => {
    const drawn = run(EMPTY_SCENE, draw(NETWORK), draw(FLOW, undefined, 'flow')).scene;
    expect(drawn.focus).toBe('flow');
    const focused = run(drawn, { kind: 'board.focus', item: 'net' });
    expect(focused.problems).toEqual([]);
    expect(focused.scene.focus).toBe('net');
    expect(run(focused.scene, { kind: 'board.clear' }).scene.items).toEqual([]);
  });

  it('an automaton action on a diagram, or a trace on one, is refused', () => {
    const drawn = run(EMPTY_SCENE, draw(NETWORK)).scene;
    expect(reduceBoard(drawn, { kind: 'board.addState', item: 'net', id: 'q9' }).problem).toBe(
      'unknown item net',
    );
    const trace = reduceBoard(drawn, {
      kind: 'board.trace',
      item: 't',
      spec: CORRECT,
      input: '01',
      on: 'net',
    });
    expect(trace.problem).toBe('unknown item net');
  });
});

describe('diagramSizes', () => {
  /** A fixed-width stand-in: 8 px a character, 0 for none. */
  const measure: MeasureText = (text, _style) => ({ w: [...text].length * 8, h: 16 });

  it('sizes each node card from its icon, label and sublabel, never under its minimum', () => {
    const sizes = diagramSizes(NETWORK, measure);
    const { padLeft, icon, iconGap, padRight, padY, labelLine, subGap, subLine, minW } = NODE_CARD;
    const chrome = padLeft + icon + iconGap + padRight;
    // "Core switch": 11 × 8 = 88 beside its icon; no sublabel, so one line tall.
    expect(sizes.nodes.core).toEqual({
      w: Math.max(minW, 88 + chrome),
      h: 2 * padY + Math.max(icon, labelLine),
    });
    expect(sizes.nodes.rA.w).toBe(Math.max(minW, 11 * 8 + chrome));
    expect(sizes.nodes.pcC1.w).toBe(Math.max(minW, 13 * 8 + chrome));
    expect(sizes.nodes.rA.h).toBe(2 * padY + labelLine + subGap + subLine);
    expect(sizes.nodes.rA.h).toBeGreaterThan(sizes.nodes.core.h);
    expect(sizes.nodes.pcA1.w).toBeGreaterThanOrEqual(minW);
    // A group's label block: label and sublabel, one line each.
    // A group's label block: its label, then its sublabel on the same line.
    const { pad, line, gap, below } = GROUP_LABEL;
    expect(sizes.groups.zoneA).toEqual({
      w: pad + 6 * 8 + gap + 14 * 8 + pad,
      h: pad + line + below,
    });
    expect(sizes.groups.zoneA.h).toBe(
      diagramSizes({ ...NETWORK, groups: [{ id: 'zoneA', label: 'Zone A' }] }, measure).groups.zoneA
        .h,
    );
  });

  it('stands in a width estimate when the measure gives none (no layout engine)', () => {
    const blind: MeasureText = () => ({ w: 0, h: 0 });
    const sizes = diagramSizes(NETWORK, blind);
    expect(sizes.nodes.pcC1.w).toBeGreaterThan(NODE_CARD.minW);
    expect(sizes.groups.zoneC.w).toBeGreaterThan(100);
  });
});
