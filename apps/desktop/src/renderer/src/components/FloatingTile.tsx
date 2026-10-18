// A tile that floats over the stage, Discord's floating video: drag it anywhere, resize it from
// its inner corner with its aspect ratio locked, and on release it snaps to the nearest corner
// another tile doesn't hold. Focused, the arrows move it to another corner and Shift with the
// arrows resizes it. It keeps `inset` from the stage's edges and, at the bottom, clear of the
// captions band (`bottomClearance`). Its corner and width are remembered per tile id, when
// storage works. It lays itself out in its parent, which must be positioned.
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { MOTION } from '../board/motion';
import { cn } from '../lib/cn';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface TileSize {
  w: number;
  h: number;
}

export interface FloatingTileProps {
  /** Its storage key, and its name among the stage's tiles. */
  id: string;
  /** Its accessible name. */
  label: string;
  /** What else it does, after how to move it: read with its name. */
  hint?: string;
  defaultCorner: Corner;
  /** Its size until she resizes it, which also fixes its aspect ratio. */
  defaultSize: TileSize;
  minWidth: number;
  maxWidth: number;
  /** From the stage's edges, in px. */
  inset?: number;
  /** From the stage's bottom edge, for the bottom corners: the captions band and a gap. */
  bottomClearance?: number;
  /** A double click, or Enter while it has focus. */
  onActivate?(): void;
  className?: string;
  children: ReactNode | ((size: TileSize) => ReactNode);
}

/** Where each floating tile is, so tiles never snap into one another (and others can avoid them). */
export interface FloatingTiles {
  tiles: Record<string, { corner: Corner } & TileSize>;
  place(id: string, place: { corner: Corner } & TileSize): void;
  remove(id: string): void;
}

export const useFloatingTiles: UseBoundStore<StoreApi<FloatingTiles>> = create<FloatingTiles>()(
  (set) => ({
    tiles: {},
    place: (id, place) => set((state) => ({ tiles: { ...state.tiles, [id]: place } })),
    remove: (id) =>
      set((state) => {
        const { [id]: _gone, ...tiles } = state.tiles;
        return { tiles };
      }),
  }),
);

/** A press that moves less than this is a click, not a drag. */
const DRAG_SLOP = 3;
/** Shift and an arrow grows or shrinks the tile by this much width. */
const KEY_STEP = 16;

interface Saved {
  corner: Corner;
  width: number;
}

const storageKey = (id: string) => `tassel.tile.${id}`;

function load(id: string): Partial<Saved> {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return {};
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(CORNERS.includes(value.corner as Corner) && { corner: value.corner as Corner }),
      ...(typeof value.width === 'number' &&
        Number.isFinite(value.width) && { width: value.width }),
    };
  } catch {
    return {};
  }
}

function save(id: string, saved: Saved): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(saved));
  } catch {
    // Without storage it still works; it just starts in its default corner next time.
  }
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), Math.max(min, max));

interface Gesture {
  kind: 'move' | 'resize';
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  moved: boolean;
}

export function FloatingTile({
  id,
  label,
  hint,
  defaultCorner,
  defaultSize,
  minWidth,
  maxWidth,
  inset = 16,
  bottomClearance = inset,
  onActivate,
  className,
  children,
}: FloatingTileProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const element = useRef<HTMLDivElement>(null);
  const [saved] = useState(() => load(id));
  const [corner, setCorner] = useState<Corner>(saved.corner ?? defaultCorner);
  const [width, setWidth] = useState(saved.width ?? defaultSize.w);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [bounds, setBounds] = useState<TileSize>({ w: 0, h: 0 });
  const gesture = useRef<Gesture | null>(null);
  const lastDragAt = useRef(0);

  // The stage's size, kept current as the window resizes it.
  useLayoutEffect(() => {
    const parent = element.current?.parentElement;
    if (!parent) return;
    const measure = () =>
      setBounds((old) =>
        old.w === parent.clientWidth && old.h === parent.clientHeight
          ? old
          : { w: parent.clientWidth, h: parent.clientHeight },
      );
    measure();
    window.addEventListener('resize', measure);
    // jsdom has no ResizeObserver; the window's resize event still re-measures.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  // Where it may go: the stage, less the inset and, at the bottom, the captions band.
  const area = {
    left: inset,
    top: inset,
    right: bounds.w - inset,
    bottom: bounds.h - bottomClearance,
  };
  const aspect = defaultSize.w / defaultSize.h;
  const fitWidth = (w: number) =>
    Math.round(
      clamp(
        w,
        minWidth,
        Math.min(maxWidth, area.right - area.left, (area.bottom - area.top) * aspect),
      ),
    );
  const w = fitWidth(width);
  const size = { w, h: Math.round((w * defaultSize.h) / defaultSize.w) };
  const at = (c: Corner) => ({
    left: c.endsWith('left') ? area.left : Math.max(area.left, area.right - size.w),
    top: c.startsWith('top') ? area.top : Math.max(area.top, area.bottom - size.h),
  });
  const position = drag ?? at(corner);

  /**
   * The free corners, nearest to `from` first. Ties (before the stage has a size) go to the
   * corner on the same side as its own, above or below it, then beside it.
   */
  const freeCorners = (from: { left: number; top: number }) => {
    const held = new Set(
      Object.entries(useFloatingTiles.getState().tiles)
        .filter(([other]) => other !== id)
        .map(([, tile]) => tile.corner),
    );
    const distance = (c: Corner) => Math.hypot(at(c).left - from.left, at(c).top - from.top);
    const [v, h] = corner.split('-');
    const rank = (c: Corner) =>
      (c.endsWith(h as string) ? 0 : 2) + (c.startsWith(v as string) ? 0 : 1);
    return CORNERS.filter((c) => !held.has(c)).sort(
      (a, b) => distance(a) - distance(b) || rank(a) - rank(b),
    );
  };

  // Hold its corner among the stage's tiles; one another tile already holds sends it to the
  // nearest free corner.
  const place = useFloatingTiles((state) => state.place);
  const remove = useFloatingTiles((state) => state.remove);
  useLayoutEffect(() => {
    const free = freeCorners(at(corner));
    if (free.length > 0 && !free.includes(corner)) {
      setCorner(free[0] as Corner);
      return;
    }
    const held = useFloatingTiles.getState().tiles[id];
    if (held?.corner !== corner || held.w !== size.w || held.h !== size.h) {
      place(id, { corner, ...size });
    }
  });
  useEffect(() => () => remove(id), [id, remove]);

  const snapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(snapTimer.current), []);
  /** Moves or resizes it with the camera's motion (instant under reduced motion). */
  const settleTo = (next: Saved) => {
    setSnapping(true);
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => setSnapping(false), MOTION.cameraMs);
    setCorner(next.corner);
    setWidth(next.width);
    save(id, next);
  };

  // The latest of everything the window's pointer listeners read.
  const latest = useRef({ area, size, position, w, corner, fitWidth, freeCorners, settleTo });
  latest.current = { area, size, position, w, corner, fitWidth, freeCorners, settleTo };

  const listeners = useRef<(() => void) | null>(null);
  useEffect(() => () => listeners.current?.(), []);

  const begin = (event: PointerEvent, kind: Gesture['kind']) => {
    gesture.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top,
      width: w,
      moved: false,
    };
    const onMove = (move: globalThis.PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dx = move.clientX - g.x;
      const dy = move.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      g.moved = true;
      const now = latest.current;
      if (g.kind === 'move') {
        setSnapping(false);
        setDrag({
          left: clamp(g.left + dx, now.area.left, now.area.right - now.size.w),
          top: clamp(g.top + dy, now.area.top, now.area.bottom - now.size.h),
        });
        return;
      }
      // Out from its anchored corner grows it: left and down for the top right, and so on.
      const sx = now.corner.endsWith('right') ? -1 : 1;
      const sy = now.corner.startsWith('bottom') ? -1 : 1;
      setWidth(now.fitWidth(g.width + (sx * dx + sy * dy * aspect) / 2));
    };
    const onUp = () => {
      const g = gesture.current;
      end();
      if (!g?.moved) return;
      lastDragAt.current = performance.now();
      const now = latest.current;
      setDrag(null);
      now.settleTo({
        corner: g.kind === 'move' ? (now.freeCorners(now.position)[0] ?? now.corner) : now.corner,
        width: now.w,
      });
    };
    const end = () => {
      gesture.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      listeners.current = null;
    };
    listeners.current?.();
    listeners.current = end;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Its own controls (Retry on Ada's tile) stay clicks.
    if (event.target instanceof Element && event.target.closest('button')) return;
    begin(event, 'move');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Enter') {
      if (!onActivate) return;
      event.preventDefault();
      event.stopPropagation();
      onActivate();
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      settleTo({ corner, width: fitWidth(w + arrow.grow * KEY_STEP) });
      return;
    }
    const next = arrow.toward(corner);
    if (next !== corner && freeCorners(at(corner)).includes(next))
      settleTo({ corner: next, width });
  };

  const handle = INNER_CORNER[corner];
  return (
    // biome-ignore lint/a11y/useSemanticElements: a movable tile of its own content, not a fieldset.
    <div
      ref={element}
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: it takes focus for its arrow-key moves.
      tabIndex={0}
      data-corner={corner}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={(event) => {
        if (!onActivate) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        // The second click of a drag's release isn't a double click.
        if (performance.now() - lastDragAt.current < 300) return;
        onActivate();
      }}
      className={cn(
        'group absolute z-10 touch-none rounded-card shadow-[0_0_0_1px_var(--color-hairline)] select-none',
        drag ? 'cursor-grabbing' : 'cursor-grab',
        snapping && 'motion-safe:transition-[left,top,width,height]',
        className,
      )}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        ...(snapping && {
          transitionDuration: `${MOTION.cameraMs}ms`,
          transitionTimingFunction: MOTION.ease,
        }),
      }}
    >
      {typeof children === 'function' ? children(size) : children}
      <span id={hintId} className="sr-only">
        {hint ? `${t('session.tile.hint')} ${hint}` : t('session.tile.hint')}
      </span>
      {/* Pointer only: Shift and the arrows resize it from the keyboard. */}
      <span
        aria-hidden="true"
        data-resize-handle={handle}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          begin(event, 'resize');
        }}
        className={cn(
          'absolute z-20 size-5',
          HANDLE_PLACE[handle],
          handle === 'top-left' || handle === 'bottom-right'
            ? 'cursor-nwse-resize'
            : 'cursor-nesw-resize',
        )}
      >
        <svg
          viewBox="0 0 10 10"
          className={cn(
            'absolute size-2.5 text-ink/60 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100',
            GLYPH_PLACE[handle],
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9 2 2 9M9 6 6 9" />
        </svg>
      </span>
    </div>
  );
}

const ARROWS: Record<string, { grow: number; toward(c: Corner): Corner }> = {
  ArrowLeft: { grow: -1, toward: (c) => c.replace('right', 'left') as Corner },
  ArrowRight: { grow: 1, toward: (c) => c.replace('left', 'right') as Corner },
  ArrowUp: { grow: 1, toward: (c) => c.replace('bottom', 'top') as Corner },
  ArrowDown: { grow: -1, toward: (c) => c.replace('top', 'bottom') as Corner },
};

/** The handle sits in the corner across from the one it's anchored to, facing the stage. */
const INNER_CORNER: Record<Corner, Corner> = {
  'top-left': 'bottom-right',
  'top-right': 'bottom-left',
  'bottom-left': 'top-right',
  'bottom-right': 'top-left',
};

const HANDLE_PLACE: Record<Corner, string> = {
  'top-left': 'top-0 left-0',
  'top-right': 'top-0 right-0',
  'bottom-left': 'bottom-0 left-0',
  'bottom-right': 'right-0 bottom-0',
};

// The glyph is drawn for the bottom right corner and mirrored into the others.
const GLYPH_PLACE: Record<Corner, string> = {
  'top-left': 'top-1 left-1 -scale-100',
  'top-right': 'top-1 right-1 -scale-y-100',
  'bottom-left': 'bottom-1 left-1 -scale-x-100',
  'bottom-right': 'right-1 bottom-1',
};
