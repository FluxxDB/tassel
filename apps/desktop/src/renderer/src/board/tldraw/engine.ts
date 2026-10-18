// The tldraw engine behind Ada's board (BoardEngine). It draws her scene by diffing her last desired
// board against her next (planSync), so it changes only what she changed. Her changes go in as
// remote changes outside the undo history, so they never count as the student's (Task 6) and she
// can't undo them. Effects play on an overlay; the camera fits her focus.
import type { Pt } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import {
  type Editor,
  getIndexAbove,
  getIndexBetween,
  type IndexKey,
  type TLBindingCreate,
  type TLBindingId,
  type TLShapeId,
  type TLShapePartial,
  toRichText,
} from 'tldraw';
import type { BoardEngine, StageGeometry, StudentBoardEdit } from '../engine';
import type { AutomatonLayout } from '../layout/types';
import { prefersReducedMotion } from '../motion';
import { type BoardText, type Box, placeItems } from '../scene/placement';
import type { BoardEffect, BoardScene } from '../scene/types';
import { fitCamera, onSettledResize } from './camera';
import {
  adaShapeId,
  type Desired,
  type DesiredBinding,
  type DesiredShape,
  desiredBoard,
  NO_SHAPES,
} from './desired';
import { arrowPath, effectsOf } from './effects';
import { createTextMeasure } from './measure';
import { planSync, type SyncPlan } from './plan-sync';

/** i18next's t: a key in a language. */
type Translate = (key: string, opts: Record<string, unknown> & { lng: Lang }) => string;

export interface TldrawEngine extends BoardEngine {
  /** The session's language changed: Ada's text is worded and measured again. */
  setLang(lang: Lang): void;
}

export function createTldrawEngine(
  editor: Editor,
  opts: {
    lang: Lang;
    t: Translate;
    reducedMotion?: () => boolean;
    /** What to watch for size changes; the editor's container by default. */
    container?: HTMLElement;
    /**
     * Where the stage lays things over the board (P5-R9), measured when the camera fits. Without
     * it, or while it's null, the camera makes the plain fit.
     */
    stage?: () => StageGeometry | null;
  },
): TldrawEngine {
  let lang = opts.lang;
  const reduced = opts.reducedMotion ?? prefersReducedMotion;
  const measure = createTextMeasure(editor.getContainer(), () => lang);
  const text = (): BoardText => ({
    measure: measure.measure,
    t: (key, values) => opts.t(key, { ...values, lng: lang }),
  });
  const effects = effectsOf(editor);
  const listeners = new Set<(edit: StudentBoardEdit) => void>();

  /** What Ada's board holds now, and what it was drawn from. */
  let shown: Desired = NO_SHAPES;
  let drawn: { scene: BoardScene; layouts: Readonly<Record<string, AutomatonLayout>> } | null =
    null;
  /** What the camera fitted last: an item (or null for everything) and its box. */
  let fitted: string | null = null;

  /**
   * The camera on `item`'s box, or on every item's for null, clear of what the stage lays over the
   * board; false when there's nothing to fit, or no room yet. The container says how it fitted
   * (data-fit: clear, no-captions or plain), so specs can tell.
   */
  const frame = (item: string | null, animate: boolean): boolean => {
    if (!drawn) return false;
    const boxes = placeItems(drawn.scene, drawn.layouts, text());
    const bounds = item === null ? union(Object.values(boxes)) : boxes[item];
    if (!bounds) return false;
    const key = JSON.stringify([item, bounds]);
    const fit = fitCamera(editor, bounds, {
      animate: animate && !reduced(),
      stage: opts.stage?.() ?? null,
    });
    if (!fit) return false;
    editor.getContainer().dataset.fit = fit.stage;
    fitted = key;
    return true;
  };

  /** Fits Ada's focus again when it, or the box it fits, has changed. */
  const followFocus = () => {
    if (!drawn) return;
    const item = drawn.scene.focus;
    const boxes = placeItems(drawn.scene, drawn.layouts, text());
    const bounds = item === null ? union(Object.values(boxes)) : boxes[item];
    if (bounds && JSON.stringify([item, bounds]) !== fitted) frame(item, fitted !== null);
  };

  const stopWatching = onSettledResize(opts.container ?? editor.getContainer(), () => {
    if (drawn) frame(drawn.scene.focus, true);
  });

  const render = (scene: BoardScene, layouts: Readonly<Record<string, AutomatonLayout>>) => {
    // A new step/run or removed drawing invalidates the old token. Copy and verdict updates
    // keep its clock, so a fast arriving verdict cannot cut a glide short.
    const invalidated = drawn?.scene.items.some((before) => {
      const next = scene.items.find((item) => item.id === before.id);
      return (
        !next ||
        next.kind !== before.kind ||
        (before.kind === 'trace' &&
          next.kind === 'trace' &&
          (before.run !== next.run || before.shown !== next.shown)) ||
        (before.kind === 'automaton' && next.kind === 'automaton' && before.spec !== next.spec)
      );
    });
    if (invalidated) effects.stop();
    drawn = { scene, layouts };
    const next = desiredBoard(scene, layouts, text(), lang);
    apply(editor, planSync(shown, next));
    shown = next;
    followFocus();
  };

  return {
    render,
    setLang(next) {
      if (next === lang) return;
      lang = next;
      if (drawn) render(drawn.scene, drawn.layouts);
    },
    async play(effect: BoardEffect) {
      if (effect.type === 'pulse') {
        if (reduced()) return;
        // Around the state's own circle: its page bounds come from a polygon, a little smaller.
        const state = editor.getShape(adaShapeId(effect.item, effect.el) as TLShapeId);
        if (state?.type !== 'tassel-state') return;
        const r = state.props.w / 2;
        const center = editor.getShapePageTransform(state).applyToPoint({ x: r, y: r });
        await effects.play({ type: 'pulse', center: { x: center.x, y: center.y }, r });
        return;
      }
      const edges = effect.edges.flatMap((ref): Pt[][] => {
        const arrow = editor.getShape(adaShapeId(effect.item, ref) as TLShapeId);
        if (arrow?.type !== 'arrow') return [];
        const path = arrowPath(editor, arrow);
        return path.length > 0 ? [path] : [];
      });
      if (edges.length > 0) await effects.play({ type: 'glide', edges }, reduced());
    },
    focus(item, { animate }) {
      frame(item, animate);
    },
    onStudentEdit(listener) {
      // Task 6 reports her edits; until then there are none to report.
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      stopWatching();
      effects.stop();
      measure.dispose();
      listeners.clear();
    },
  };
}

/** Applies a plan as Ada's: a remote change, outside the undo history, past any shape lock. */
function apply(editor: Editor, plan: SyncPlan): void {
  const nothing =
    plan.create.length +
      plan.update.length +
      plan.remove.length +
      plan.bind.length +
      plan.unbind.length ===
    0;
  if (nothing) return;
  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        // A changed binding is replaced under its own id, so the old one goes first.
        const unbind = plan.unbind.filter((id) => editor.getBinding(id as TLBindingId));
        if (unbind.length > 0) editor.deleteBindings(unbind as TLBindingId[]);
        const remove = plan.remove.filter((id) => editor.getShape(id as TLShapeId));
        if (remove.length > 0) editor.deleteShapes(remove as TLShapeId[]);
        // What the student erased stays erased: its updates and bindings are skipped.
        const exists = (id: string) => editor.getShape(id as TLShapeId) !== undefined;
        const create = plan.create.filter((shape) => !exists(shape.id));
        const shapes = create.filter((shape) => shape.type !== 'arrow');
        if (shapes.length > 0) editor.createShapes(shapes.map(shapePartial));
        const arrows = create.filter((shape) => shape.type === 'arrow');
        if (arrows.length > 0) editor.createShapes(placeArrows(editor, arrows, plan.bind));
        const update = [
          ...plan.update.filter((change) => exists(change.id)),
          ...plan.create.filter((shape) => exists(shape.id) && !create.includes(shape)),
        ];
        if (update.length > 0) editor.updateShapes(update.map(shapePartial));
        const bind = plan.bind.filter((binding) => exists(binding.arrow) && exists(binding.to));
        if (bind.length > 0) editor.createBindings(bind.map(bindingCreate));
      },
      { history: 'ignore', ignoreShapeLock: true },
    );
  });
}

/**
 * Ada's new arrows where tldraw keeps an arrow it binds: just above the highest shape it binds,
 * below the next shape that isn't an arrow (ArrowBindingUtil's reparentArrow). Binding them then
 * moves nothing. A move would be tldraw's own change after Ada's, which the store attributes to
 * the user: it would count as the student's edit (Task 6) and land in her undo history.
 */
function placeArrows(
  editor: Editor,
  arrows: readonly DesiredShape[],
  bindings: readonly DesiredBinding[],
): TLShapePartial[] {
  // The page's shapes in z-order, the arrows joining them as they're placed.
  const siblings = editor.getSortedChildIdsForParent(editor.getCurrentPageId()).flatMap((id) => {
    const shape = editor.getShape(id);
    return shape
      ? [{ id: shape.id as string, index: shape.index, arrow: shape.type === 'arrow' }]
      : [];
  });
  return arrows.map((arrow) => {
    const bound = bindings
      .filter((binding) => binding.arrow === arrow.id)
      .flatMap((binding) => siblings.filter((sibling) => sibling.id === binding.to));
    // An arrow bound to nothing that exists goes on top, where tldraw puts it.
    if (bound.length === 0) return shapePartial(arrow);
    const highest = bound.reduce((a, b) => (a.index > b.index ? a : b));
    let next = siblings.indexOf(highest) + 1;
    while (next < siblings.length && siblings[next].arrow) next += 1;
    // Above the arrows already over the highest bound shape, in the order Ada drew them.
    const below = siblings[next - 1].index;
    const index: IndexKey =
      next < siblings.length ? getIndexBetween(below, siblings[next].index) : getIndexAbove(below);
    siblings.splice(next, 0, { id: arrow.id, index, arrow: true });
    return { ...shapePartial(arrow), index } as TLShapePartial;
  });
}

/** A desired shape, or a change to one, as tldraw takes it: an arrow's label is rich text. */
function shapePartial(shape: { id: string; type: string } & Partial<DesiredShape>): TLShapePartial {
  const { id, type, x, y, opacity, props, meta } = shape;
  let tlProps = props;
  if (type === 'arrow' && props && 'label' in props) {
    const { label, ...rest } = props;
    tlProps = { ...rest, richText: toRichText(String(label)) };
  }
  return {
    id: id as TLShapeId,
    type,
    ...(x !== undefined && { x }),
    ...(y !== undefined && { y }),
    ...(opacity !== undefined && { opacity }),
    ...(tlProps && { props: tlProps }),
    ...(meta && { meta }),
  } as TLShapePartial;
}

function bindingCreate(binding: DesiredBinding): TLBindingCreate {
  return {
    id: binding.id as TLBindingId,
    type: 'arrow',
    fromId: binding.arrow as TLShapeId,
    toId: binding.to as TLShapeId,
    props: {
      terminal: binding.terminal,
      normalizedAnchor: binding.normalizedAnchor,
      isPrecise: binding.isPrecise,
      isExact: false,
      snap: 'none',
    },
  } as TLBindingCreate;
}

function union(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}
