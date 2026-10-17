// The demo's two DFAs for "binary strings that start with 010" (spec §9): the student's WRONG one,
// whose loop on 1 at q0 lets 1010 in, and the CORRECT reference, with its explicit dead state qd.
import type { AutomatonSpec } from '@tassel/shared/beats';

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
