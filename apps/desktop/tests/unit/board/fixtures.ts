// The demo's two DFAs for "binary strings that start with 010" (spec §9): the student's WRONG one,
// whose loop on 1 at q0 lets 1010 in, and the CORRECT reference, with its explicit dead state qd.
import type { AutomatonSpec, DiagramSpec } from '@tassel/shared/beats';

export const WRONG: AutomatonSpec = {
  kind: 'dfa',
  states: [{ id: 'q0' }, { id: 'q1' }, { id: 'q2' }, { id: 'q3', accept: true }],
  start: 'q0',
  transitions: [
    { from: 'q0', to: 'q1', symbols: ['0'] },
    { from: 'q1', to: 'q2', symbols: ['1'] },
    { from: 'q2', to: 'q3', symbols: ['0'] },
    { from: 'q3', to: 'q3', symbols: ['0', '1'] },
    { from: 'q0', to: 'q0', symbols: ['1'] },
  ],
};

/**
 * State ids DOT can't take bare: digit-led ones, which the contract allows (M19), and one of
 * DOT's reserved words.
 */
export const ODD_IDS: AutomatonSpec = {
  kind: 'dfa',
  states: [{ id: '0' }, { id: '1' }, { id: '10' }, { id: '0a', accept: true }, { id: 'node' }],
  start: '0',
  transitions: [
    { from: '0', to: '1', symbols: ['a'] },
    { from: '1', to: '10', symbols: ['b'] },
    { from: '10', to: '0a', symbols: ['a'] },
    { from: '0a', to: '0a', symbols: ['a', 'b'] },
    { from: '0', to: 'node', symbols: ['b'] },
    { from: 'node', to: '0', symbols: ['a'] },
  ],
};

export const CORRECT: AutomatonSpec = {
  kind: 'dfa',
  states: [{ id: 'q0' }, { id: 'q1' }, { id: 'q2' }, { id: 'q3', accept: true }, { id: 'qd' }],
  start: 'q0',
  transitions: [
    { from: 'q0', to: 'q1', symbols: ['0'] },
    { from: 'q1', to: 'q2', symbols: ['1'] },
    { from: 'q2', to: 'q3', symbols: ['0'] },
    { from: 'q3', to: 'q3', symbols: ['0', '1'] },
    { from: 'q0', to: 'qd', symbols: ['1'] },
    { from: 'q1', to: 'qd', symbols: ['0'] },
    { from: 'q2', to: 'qd', symbols: ['1'] },
    { from: 'qd', to: 'qd', symbols: ['0', '1'] },
  ],
};

/**
 * A network as Ada draws it with board.diagram: three zones (/26, /27, /28), each a router and two
 * PCs with their addresses, the routers wired to a core switch on labelled ports.
 */
export const NETWORK: DiagramSpec = {
  title: 'Subnets 192.168.1.0/24',
  direction: 'LR',
  groups: [
    { id: 'zoneA', label: 'Zone A', sublabel: '192.168.1.0/26' },
    { id: 'zoneB', label: 'Zone B', sublabel: '192.168.1.64/27' },
    { id: 'zoneC', label: 'Zone C', sublabel: '192.168.1.96/28' },
  ],
  nodes: [
    { id: 'core', label: 'Core switch', icon: 'switch' },
    { id: 'rA', label: 'Router A', sublabel: '192.168.1.1', icon: 'router', group: 'zoneA' },
    { id: 'pcA1', label: 'PC A1', sublabel: '192.168.1.10', icon: 'pc', group: 'zoneA' },
    { id: 'pcA2', label: 'PC A2', sublabel: '192.168.1.11', icon: 'pc', group: 'zoneA' },
    { id: 'rB', label: 'Router B', sublabel: '192.168.1.65', icon: 'router', group: 'zoneB' },
    { id: 'pcB1', label: 'PC B1', sublabel: '192.168.1.70', icon: 'pc', group: 'zoneB' },
    { id: 'pcB2', label: 'PC B2', sublabel: '192.168.1.71', icon: 'laptop', group: 'zoneB' },
    { id: 'rC', label: 'Router C', sublabel: '192.168.1.97', icon: 'router', group: 'zoneC' },
    { id: 'pcC1', label: 'PC C1', sublabel: '192.168.1.100', icon: 'pc', group: 'zoneC' },
    { id: 'pcC2', label: 'PC C2', sublabel: '192.168.1.101', icon: 'pc', group: 'zoneC' },
  ],
  edges: [
    { from: 'core', to: 'rA', label: 'Gi0/1', directed: false, style: 'solid' },
    { from: 'core', to: 'rB', label: 'Gi0/2', directed: false, style: 'solid' },
    { from: 'core', to: 'rC', label: 'Gi0/3', directed: false, style: 'solid' },
    { from: 'rA', to: 'pcA1', directed: false, style: 'solid' },
    { from: 'rA', to: 'pcA2', directed: false, style: 'solid' },
    { from: 'rB', to: 'pcB1', directed: false, style: 'solid' },
    { from: 'rB', to: 'pcB2', directed: false, style: 'dashed' },
    { from: 'rC', to: 'pcC1', directed: false, style: 'solid' },
    { from: 'rC', to: 'pcC2', directed: false, style: 'solid' },
  ],
};

/** A small flowchart: directed edges top to bottom, no groups. */
export const FLOW: DiagramSpec = {
  direction: 'TB',
  groups: [],
  nodes: [
    { id: 'start', label: 'Request', icon: 'circle' },
    { id: 'check', label: 'Firewall', icon: 'firewall' },
    { id: 'db', label: 'Orders', icon: 'database' },
  ],
  edges: [
    { from: 'start', to: 'check', directed: true, style: 'solid' },
    { from: 'check', to: 'db', label: 'allowed', directed: true, style: 'dashed' },
  ],
};
