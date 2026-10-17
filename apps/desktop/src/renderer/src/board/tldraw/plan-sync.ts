// What to change on the board to go from Ada's last desired board to her next one. It diffs her
// two boards, never her board against the editor's: a state the student moved stays where she
// put it, and a shape she erased isn't drawn again, unless Ada herself changes it. Pure.
import type { Desired, DesiredBinding, DesiredShape } from './desired';

export interface SyncPlan {
  create: DesiredShape[];
  /** Each carries only what changed, with `props` and `meta` as partials. */
  update: Array<{ id: string; type: string } & Partial<DesiredShape>>;
  remove: string[];
  /** New bindings, and the new versions of changed ones (which `unbind` drops first). */
  bind: DesiredBinding[];
  unbind: string[];
}

export function planSync(prev: Desired, next: Desired): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [], bind: [], unbind: [] };
  const followsBindings = boundAtBothEnds(next);

  for (const [id, before] of prev.shapes) {
    const after = next.shapes.get(id);
    if (!after || after.type !== before.type) plan.remove.push(id);
  }
  for (const [id, after] of next.shapes) {
    const before = prev.shapes.get(id);
    if (!before || before.type !== after.type) {
      plan.create.push(after);
      continue;
    }
    const update = changes(before, after, followsBindings.has(id));
    if (update) plan.update.push(update);
  }

  for (const [id, before] of prev.bindings) {
    const after = next.bindings.get(id);
    if (!after || !same(before, after)) plan.unbind.push(id);
  }
  for (const [id, after] of next.bindings) {
    const before = prev.bindings.get(id);
    if (!before || !same(before, after)) plan.bind.push(after);
  }
  return plan;
}

/**
 * The fields of `after` that differ from `before`, or null when none does. An arrow bound at both
 * ends follows its shapes, so where its origin sits is never Ada's to move.
 */
function changes(
  before: DesiredShape,
  after: DesiredShape,
  followsBindings: boolean,
): SyncPlan['update'][number] | null {
  const update: SyncPlan['update'][number] = { id: after.id, type: after.type };
  let changed = false;
  if (!followsBindings) {
    if (before.x !== after.x) {
      update.x = after.x;
      changed = true;
    }
    if (before.y !== after.y) {
      update.y = after.y;
      changed = true;
    }
  }
  if (before.opacity !== after.opacity) {
    update.opacity = after.opacity;
    changed = true;
  }
  const props = changedEntries(before.props, after.props);
  if (props) {
    update.props = props;
    changed = true;
  }
  if (!same(before.meta, after.meta)) {
    update.meta = after.meta;
    changed = true;
  }
  return changed ? update : null;
}

/** The entries of `after` whose values differ from `before`'s, or null when none does. */
function changedEntries(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> | null {
  const changed = Object.entries(after).filter(([key, value]) => !same(before[key], value));
  return changed.length > 0 ? Object.fromEntries(changed) : null;
}

/** The ids of arrows that have both a start and an end binding. */
function boundAtBothEnds(board: Desired): Set<string> {
  const ends = new Map<string, Set<string>>();
  for (const binding of board.bindings.values()) {
    const terminals = ends.get(binding.arrow) ?? new Set<string>();
    terminals.add(binding.terminal);
    ends.set(binding.arrow, terminals);
  }
  return new Set([...ends].filter(([, terminals]) => terminals.size === 2).map(([id]) => id));
}

/** Structural equality for the plain data of a desired board: numbers, strings, arrays, objects. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
