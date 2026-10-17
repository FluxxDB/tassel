// The tldraw engine behind Ada's board (BoardEngine). It draws her scene by diffing her last desired
// board against her next (planSync), so it changes only what she changed. Her changes go in as
// remote changes outside the undo history, so they never count as the student's (Task 6) and she
// can't undo them. Effects play on an overlay; the camera fits her focus.
import { type Pt, parseElementRef } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import {
  type Editor,
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
import { effectsOf } from './effects';
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
      if (reduced()) return;
      if (effect.type === 'pulse') {
        const bounds = editor.getShapePageBounds(adaShapeId(effect.item, effect.el) as TLShapeId);
        if (!bounds) return;
        await effects.play({
          type: 'pulse',
          center: bounds.center,
          r: Math.min(bounds.w, bounds.h) / 2,
        });
        return;
      }
      // Each edge from its tail state's center to its head's, where they are now (Task 10 follows
      // the arrow's own path).
      const edges = effect.edges.flatMap((ref): Pt[][] => {
        const edge = parseElementRef(ref);
        if (edge?.kind !== 'edge') return [];
        const from = centerOf(editor, adaShapeId(effect.item, `state:${edge.from}`));
        const to = centerOf(editor, adaShapeId(effect.item, `state:${edge.to}`));
        return from && to ? [[from, to]] : [];
      });
      if (edges.length > 0) await effects.play({ type: 'glide', edges });
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
        if (create.length > 0) editor.createShapes(create.map(shapePartial));
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

function centerOf(editor: Editor, id: string): Pt | null {
  const bounds = editor.getShapePageBounds(id as TLShapeId);
  return bounds ? { x: bounds.center.x, y: bounds.center.y } : null;
}

function union(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}
