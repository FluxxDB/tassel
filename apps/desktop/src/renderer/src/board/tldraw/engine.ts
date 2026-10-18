// The tldraw engine behind Ada's board (BoardEngine). It draws her scene by diffing her last desired
// board against her next (planSync), so it changes only what she changed. Her changes go in as
// remote changes outside the undo history, so they never count as the student's (Task 6) and she
// can't undo them. Effects play on an overlay; the camera fits her focus. Its snapshot is the whole
// page as a PNG, for Ada's board turn.
import { type Pt, parseElementRef } from '@tassel/shared/beats';
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
import type { BoardLayout } from '../layout/types';
import { prefersReducedMotion } from '../motion';
import { type BoardText, focusBox, placeItems } from '../scene/placement';
import type { BoardEffect, BoardScene } from '../scene/types';
import { fitCamera, onSettledResize } from './camera';
import { createCameraControl } from './camera-control';
import { bindCameraGestures } from './camera-gestures';
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
import { screenCamera, screenDesired } from './screen';

/** Page units around the board's shapes in its snapshot. */
const SNAPSHOT_PADDING = 32;
/** The most a snapshot scales a small board up. */
const SNAPSHOT_MAX_SCALE = 2;

/** i18next's t: a key in a language. */
type Translate = (key: string, opts: Record<string, unknown> & { lng: Lang }) => string;

export interface TldrawEngine extends BoardEngine {
  /** The session's language changed: Ada's text is worded and measured again. */
  setLang(lang: Lang): void;
}

export function createTldrawEngine(
  editor: Editor,
  opts: {
    overlay?: boolean;
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
  let drawn: { scene: BoardScene; layouts: Readonly<Record<string, BoardLayout>> } | null = null;
  /** What the camera fitted last: an item (or null for everything) and its box. */
  let fitted: string | null = null;

  /**
   * The camera on `item`'s box, or on every item's for null, clear of what the stage lays over the
   * board; false when there's nothing to fit, or no room yet. The container says how it fitted
   * (data-fit: clear, no-captions or plain), so specs can tell.
   */
  const frame = (item: string | null, animate: boolean): boolean => {
    if (opts.overlay || !drawn) return false;
    const boxes = placeItems(drawn.scene, drawn.layouts, text());
    // Her notes with it, so none is cut off at the panel's edge.
    const bounds = focusBox(drawn.scene, boxes, item);
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

  const control = createCameraControl(
    () => {
      if (drawn) frame(drawn.scene.focus, fitted !== null);
    },
    () => editor.stopCameraAnimation(),
  );
  const stopGestures = opts.overlay ? () => {} : bindCameraGestures(editor, control, reduced);
  if (opts.overlay) {
    editor.setCamera({ x: 0, y: 0, z: 1 });
    editor.setCameraOptions({ isLocked: true, wheelBehavior: 'none' });
  }
  let screenShown: Desired = NO_SHAPES;
  let screenFrame: Parameters<NonNullable<BoardEngine['screen']>> | null = null;
  const syncScreenCamera = () => {
    if (!screenFrame) return;
    const bounds = editor.getViewportScreenBounds();
    editor.setCamera(
      screenCamera(screenFrame[1], {
        width: bounds.w,
        height: bounds.h,
        screenX: typeof window === 'undefined' ? 0 : window.screenX,
        screenY: typeof window === 'undefined' ? 0 : window.screenY,
      }),
      { force: true },
    );
  };
  // The parent's ResizeObserver may run before tldraw updates its own viewport record.
  // Reconcile against the editor's measurement as well, rather than retaining the old zoom.
  if (opts.overlay) editor.on('resize', syncScreenCamera);

  /** Fits Ada's focus again when it, or the box it fits, has changed. */
  const followFocus = () => {
    if (opts.overlay || !drawn) return;
    const item = drawn.scene.focus;
    const boxes = placeItems(drawn.scene, drawn.layouts, text());
    // Her notes with it, so none is cut off at the panel's edge.
    const bounds = focusBox(drawn.scene, boxes, item);
    if (bounds && JSON.stringify([item, bounds]) !== fitted) {
      control.refit(() => frame(item, fitted !== null));
    }
  };

  const stopWatching = onSettledResize(opts.container ?? editor.getContainer(), () => {
    if (opts.overlay) syncScreenCamera();
    else control.refit();
  });

  const render = (scene: BoardScene, layouts: Readonly<Record<string, BoardLayout>>) => {
    drawn = { scene, layouts };
    const next = desiredBoard(scene, layouts, text(), lang);
    apply(editor, planSync(shown, next));
    shown = next;
    followFocus();
  };

  const screen: NonNullable<BoardEngine['screen']> = (marks, viewport, board) => {
    if (
      ![viewport.width, viewport.height].every(Number.isFinite) ||
      !(viewport.width > 0 && viewport.height > 0)
    )
      return;
    screenFrame = [marks, viewport, board];
    const next = screenDesired(marks, viewport.width, viewport.height);
    if (board) {
      const desired = desiredBoard(board.scene, board.layouts, text(), lang);
      const boxes = placeItems(board.scene, board.layouts, text());
      for (const shape of desired.shapes.values()) {
        const box = boxes[shape.meta.item];
        const region = Object.hasOwn(board.placements, shape.meta.item)
          ? board.placements[shape.meta.item]
          : undefined;
        if (!box || !region) continue;
        // Scale each complete whiteboard item through tldraw's native shape scale. No camera fit.
        const scale = Math.min(
          (region.w * viewport.width) / box.w,
          (region.h * viewport.height) / box.h,
        );
        next.shapes.set(shape.id, {
          ...shape,
          x: region.x * viewport.width + (shape.x - box.x) * scale,
          y: region.y * viewport.height + (shape.y - box.y) * scale,
          meta: { ...shape.meta, screenScale: scale, screenColor: region.color ?? 'violet' },
          props:
            shape.type === 'arrow'
              ? {
                  ...shape.props,
                  scale,
                  start: scalePoint(shape.props.start, scale),
                  end: scalePoint(shape.props.end, scale),
                  bend: Number(shape.props.bend ?? 0) * scale,
                  color: region.color ?? 'violet',
                  labelColor: region.color ?? 'violet',
                }
              : {
                  ...shape.props,
                  w: Number(shape.props.w) * scale,
                  h: Number(shape.props.h) * scale,
                },
        });
      }
      for (const [id, binding] of desired.bindings) {
        if (next.shapes.has(binding.arrow) && next.shapes.has(binding.to))
          next.bindings.set(id, binding);
      }
    }
    apply(editor, planSync(screenShown, next));
    screenShown = next;
    syncScreenCamera();
  };

  return {
    screen,
    render,
    camera: {
      adaAction: control.adaAction,
      fit: () => control.fit(() => frame(null, true)),
      zoom(direction) {
        control.studentMove();
        const options = reduced() ? undefined : { animation: { duration: 160 } };
        if (direction === 'in') editor.zoomIn(undefined, options);
        else editor.zoomOut(undefined, options);
      },
    },
    setLang(next) {
      if (next === lang) return;
      lang = next;
      if (drawn) render(drawn.scene, drawn.layouts);
      if (screenFrame) screen(...screenFrame);
    },
    async play(effect: BoardEffect) {
      if (reduced()) return;
      if (effect.type === 'pulse') {
        const shape = editor.getShape(adaShapeId(effect.item, effect.el) as TLShapeId);
        if (shape?.type === 'tassel-node') {
          // Around a diagram's card: a ring that clears its corners. The overlay adds its 4 px.
          const bounds = editor.getShapePageBounds(shape);
          if (!bounds) return;
          const center = { x: bounds.center.x, y: bounds.center.y };
          await effects.play({ type: 'pulse', center, r: Math.hypot(bounds.w, bounds.h) / 2 });
          return;
        }
        // Around the state's own circle: its page bounds come from a polygon, a little smaller.
        const state = shape;
        if (state?.type !== 'tassel-state') return;
        const r = state.props.w / 2;
        const center = editor.getShapePageTransform(state).applyToPoint({ x: r, y: r });
        await effects.play({ type: 'pulse', center: { x: center.x, y: center.y }, r });
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
      control.refit(() => frame(item, animate));
    },
    async snapshot(maxSide) {
      const ids = [...editor.getCurrentPageShapeIds()];
      const bounds = editor.getCurrentPageBounds();
      if (ids.length === 0 || !bounds) return null;
      // Fixed padding, so the long side comes out at maxSide; a small board grows at most 2x.
      const long = Math.max(bounds.w, bounds.h) + 2 * SNAPSHOT_PADDING;
      const scale = Math.min(SNAPSHOT_MAX_SCALE, maxSide / long);
      const { blob } = await editor.toImage(ids, {
        format: 'png',
        background: true,
        padding: SNAPSHOT_PADDING,
        pixelRatio: 1,
        scale,
        darkMode: false,
      });
      return blob;
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
      if (opts.overlay) editor.off('resize', syncScreenCamera);
      stopGestures();
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
    // Read-only applies to student input; Ada alone may write during this synchronous batch.
    const readonly = editor.getIsReadonly();
    editor.updateInstanceState({ isReadonly: false });
    try {
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
    } finally {
      editor.updateInstanceState({ isReadonly: readonly });
    }
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

function centerOf(editor: Editor, id: string): Pt | null {
  const bounds = editor.getShapePageBounds(id as TLShapeId);
  return bounds ? { x: bounds.center.x, y: bounds.center.y } : null;
}

function scalePoint(value: unknown, scale: number) {
  const p = value as { x: number; y: number };
  return { x: p.x * scale, y: p.y * scale };
}
