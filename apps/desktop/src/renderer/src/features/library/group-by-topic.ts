// The Topic sort's sections: one per subject, A to Z, with the sessions that have no subject last.
import type { Session } from '@tassel/shared/api';

export interface TopicGroup {
  topic: string;
  items: Session[];
}

// Case doesn't separate topics, accents do: "biology" joins "Biology", "Calculo" isn't "Cálculo".
const subjects = new Intl.Collator(undefined, { sensitivity: 'accent' });

function compareSubjects(a: string | null, b: string | null): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return subjects.compare(a, b);
}

/**
 * Groups sessions by subject. Topics run A to Z (ignoring case, as the server's topic sort does),
 * and sessions without a subject come last under `noTopicLabel`. Each group keeps the order the
 * sessions came in, so the server's newest-activity-first order holds inside a topic. Subjects
 * that differ only in case share one group, labeled with the first one's spelling.
 */
export function groupByTopic(items: Session[], noTopicLabel: string): TopicGroup[] {
  // Array.prototype.sort is stable, so equal subjects keep their order.
  const sorted = [...items].sort((a, b) => compareSubjects(a.subject, b.subject));
  const groups: TopicGroup[] = [];
  let previous: Session | undefined;
  for (const session of sorted) {
    if (previous && compareSubjects(previous.subject, session.subject) === 0) {
      groups[groups.length - 1].items.push(session);
    } else {
      groups.push({ topic: session.subject ?? noTopicLabel, items: [session] });
    }
    previous = session;
  }
  return groups;
}
