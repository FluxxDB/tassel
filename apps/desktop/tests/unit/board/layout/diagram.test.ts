// A diagram laid out: as DOT (a cluster per group, rankdir from its direction, undirected edges
// with dir=none), by Graphviz, and by the grid fallback, each to the same DiagramLayout contract.
import type { DiagramSpec } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { diagramToDot } from '../../../../src/renderer/src/board/layout/dot';
import { fallbackDiagramLayout } from '../../../../src/renderer/src/board/layout/fallback';
import type { DiagramLayout, DiagramSizes } from '../../../../src/renderer/src/board/layout/types';
import { layoutDiagramWithViz } from '../../../../src/renderer/src/board/layout/viz';
import { diagramSizes } from '../../../../src/renderer/src/board/scene/diagram';
import type { MeasureText } from '../../../../src/renderer/src/board/scene/placement';
import { FLOW, NETWORK } from '../fixtures';

const measure: MeasureText = (text) => ({ w: [...text].length * 8, h: 16 });
const NETWORK_SIZES: DiagramSizes = diagramSizes(NETWORK, measure);
const FLOW_SIZES: DiagramSizes = diagramSizes(FLOW, measure);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** Every rule a layout keeps: in its box, nodes apart, each group around its nodes and label. */
function expectReadable(layout: DiagramLayout, spec: DiagramSpec, sizes: DiagramSizes) {
  const whole = { x: 0, y: 0, w: layout.width, h: layout.height };
  const nodes = spec.nodes.map((node) => ({ node, box: layout.nodes[node.id] }));
  for (const { node, box } of nodes) {
    expect(box, node.id).toBeDefined();
    expect(box.w).toBe(sizes.nodes[node.id].w);
    expect(box.h).toBe(sizes.nodes[node.id].h);
    expect(inside(box, whole), node.id).toBe(true);
  }
  for (const [i, a] of nodes.entries()) {
    for (const b of nodes.slice(i + 1)) {
      expect(overlaps(a.box, b.box), `${a.node.id} and ${b.node.id}`).toBe(false);
    }
  }
  for (const group of spec.groups) {
    const frame = layout.groups[group.id];
    expect(frame, group.id).toBeDefined();
    expect(inside(frame, whole), group.id).toBe(true);
    // Its label block sits at its top-left, clear of every node.
    const label = { x: frame.x, y: frame.y, ...sizes.groups[group.id] };
    expect(label.w).toBeLessThanOrEqual(frame.w);
    for (const { node, box } of nodes) {
      if (node.group === group.id)
        expect(inside(box, frame), `${node.id} in ${group.id}`).toBe(true);
      else expect(overlaps(box, frame), `${node.id} outside ${group.id}`).toBe(false);
      expect(overlaps(box, label), `${node.id} under ${group.id}'s label`).toBe(false);
    }
  }
  for (const [i, a] of spec.groups.entries()) {
    for (const b of spec.groups.slice(i + 1)) {
      expect(overlaps(layout.groups[a.id], layout.groups[b.id]), `${a.id}, ${b.id}`).toBe(false);
    }
  }
  for (const edge of spec.edges) expect(layout.edges[`${edge.from}>${edge.to}`]).toBeDefined();
}

describe('diagramToDot', () => {
  it('writes a cluster per group with room for its label, nodes sized as measured', () => {
    const dot = diagramToDot(NETWORK, NETWORK_SIZES);
    expect(dot).toContain('rankdir=LR');
    expect(dot.match(/subgraph "cluster_zone[ABC]"/g)).toHaveLength(3);
    const zoneA = NETWORK_SIZES.groups.zoneA;
    expect(dot).toContain(`width="${zoneA.w}" height="${zoneA.h}"`);
    expect(dot).toMatch(/subgraph "cluster_zoneA" \{[^}]*"rA" \[width=[\d.]+, height=[\d.]+\];/);
    const core = NETWORK_SIZES.nodes.core;
    expect(dot).toContain(
      `"core" [width=${(core.w / 72).toFixed(4)}, height=${(core.h / 72).toFixed(4)}];`,
    );
    // Undirected: no arrowhead, and its label for the room it takes.
    expect(dot).toContain('"core" -> "rA" [id="core>rA", dir=none, label="Gi0/1"];');
    expect(dot).toContain('"rA" -> "pcA1" [id="rA>pcA1", dir=none];');
    expect(diagramToDot(NETWORK, NETWORK_SIZES)).toBe(dot);
  });

  it('runs top to bottom for TB, directed edges with their heads', () => {
    const dot = diagramToDot(FLOW, FLOW_SIZES);
    expect(dot).toContain('rankdir=TB');
    expect(dot).not.toContain('subgraph');
    expect(dot).toContain('"start" -> "check" [id="start>check"];');
    expect(dot).toContain('"check" -> "db" [id="check>db", label="allowed"];');
  });

  it('quotes what DOT would read otherwise', () => {
    const spec: DiagramSpec = {
      direction: 'LR',
      groups: [{ id: 'node', label: 'a "quoted" \\ label' }],
      nodes: [{ id: '0a', label: 'x', icon: 'box', group: 'node' }],
      edges: [],
    };
    const dot = diagramToDot(spec, diagramSizes(spec, measure));
    expect(dot).toContain('subgraph "cluster_node"');
    expect(dot).toContain('"0a" [width=');
    expect(dot).not.toContain('quoted');
  });
});

describe('layoutDiagramWithViz', () => {
  it('lays the network out readably: zones around their nodes, nothing overlapping', async () => {
    const layout = await layoutDiagramWithViz(NETWORK, NETWORK_SIZES);
    expect(layout.kind).toBe('diagram');
    expectReadable(layout, NETWORK, NETWORK_SIZES);
    // Left to right: the core switch, then the routers, then their PCs.
    const x = (id: string) => layout.nodes[id].x;
    expect(x('core')).toBeLessThan(x('rA'));
    expect(x('rA')).toBeLessThan(x('pcA1'));
  });

  it('lays the flowchart out top to bottom', async () => {
    const layout = await layoutDiagramWithViz(FLOW, FLOW_SIZES);
    expectReadable(layout, FLOW, FLOW_SIZES);
    expect(layout.nodes.start.y).toBeLessThan(layout.nodes.check.y);
    expect(layout.nodes.check.y).toBeLessThan(layout.nodes.db.y);
  });
});

describe('fallbackDiagramLayout', () => {
  it('puts each group in a column for LR, ungrouped nodes first, nothing overlapping', () => {
    const layout = fallbackDiagramLayout(NETWORK, NETWORK_SIZES);
    expectReadable(layout, NETWORK, NETWORK_SIZES);
    const { zoneA, zoneB, zoneC } = layout.groups;
    expect(layout.nodes.core.x + layout.nodes.core.w).toBeLessThan(zoneA.x);
    expect(zoneA.x + zoneA.w).toBeLessThan(zoneB.x);
    expect(zoneB.x + zoneB.w).toBeLessThan(zoneC.x);
    // A zone's nodes stack down its column.
    expect(layout.nodes.rA.y).toBeLessThan(layout.nodes.pcA1.y);
    expect(Object.values(layout.edges).every((edge) => edge.bend === 0)).toBe(true);
  });

  it('puts each group in a row for TB', () => {
    const tb: DiagramSpec = { ...NETWORK, direction: 'TB' };
    const layout = fallbackDiagramLayout(tb, NETWORK_SIZES);
    expectReadable(layout, tb, NETWORK_SIZES);
    const { zoneA, zoneB } = layout.groups;
    expect(zoneA.y + zoneA.h).toBeLessThan(zoneB.y);
    expect(layout.nodes.rA.x).toBeLessThan(layout.nodes.pcA1.x);
  });

  it('lays out a diagram with no groups in one band', () => {
    expectReadable(fallbackDiagramLayout(FLOW, FLOW_SIZES), FLOW, FLOW_SIZES);
  });
});
