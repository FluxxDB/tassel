import type { Session } from '@tassel/shared/api';
import { describe, expect, it } from 'vitest';
import { groupByTopic } from '../../src/renderer/src/features/library/group-by-topic';

function session(id: string, subject: string | null): Session {
  return {
    id,
    title: null,
    title_source: null,
    subject,
    type: 'homework',
    language: 'en',
    source: 'paper',
    created_at: '2026-10-17T12:00:00.000000Z',
    last_activity_at: '2026-10-17T12:00:00.000000Z',
  };
}

describe('groupByTopic', () => {
  it('groupByTopic puts null subjects last under the label', () => {
    const none1 = session('1', null);
    const calculus = session('2', 'Calculus');
    const none2 = session('3', null);
    const automata = session('4', 'Automata · DFA');
    expect(groupByTopic([none1, calculus, none2, automata], 'No topic')).toEqual([
      { topic: 'Automata · DFA', items: [automata] },
      { topic: 'Calculus', items: [calculus] },
      { topic: 'No topic', items: [none1, none2] },
    ]);
  });

  it('orders topics A to Z ignoring case, keeping the given order inside each topic', () => {
    const biologyNew = session('1', 'biology');
    const calculus = session('2', 'Calculus');
    const biologyOld = session('3', 'biology');
    const automata = session('4', 'automata');
    expect(groupByTopic([biologyNew, calculus, biologyOld, automata], 'No topic')).toEqual([
      { topic: 'automata', items: [automata] },
      { topic: 'biology', items: [biologyNew, biologyOld] },
      { topic: 'Calculus', items: [calculus] },
    ]);
  });

  it('files subjects that differ only in case under one topic, spelled as the first one', () => {
    const recent = session('1', 'Cálculo');
    const older = session('2', 'cálculo');
    const other = session('3', 'Calculo');
    expect(groupByTopic([recent, older, other], 'Sin tema')).toEqual([
      { topic: 'Calculo', items: [other] },
      { topic: 'Cálculo', items: [recent, older] },
    ]);
  });

  it('keeps a subject that happens to read like the label apart from the sessions without one', () => {
    const named = session('1', 'No topic');
    const none = session('2', null);
    expect(groupByTopic([none, named], 'No topic')).toEqual([
      { topic: 'No topic', items: [named] },
      { topic: 'No topic', items: [none] },
    ]);
  });

  it('has no groups for no sessions', () => {
    expect(groupByTopic([], 'No topic')).toEqual([]);
  });
});
