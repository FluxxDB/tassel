import type { Lang } from '@tassel/shared/i18n';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  nudgeDelta,
  type OverlayIntent,
  type OverlayState,
  type ScreenBoard,
  type ScreenMark,
  type ScreenPoint,
} from '../../../shared/screen-bridge';
import { Avatar } from '../avatar/Avatar';
import { readAvatar } from '../avatar/catalog';
import { useAvatar } from '../avatar/store';
import type { BoardEngine } from '../board/engine';
import { Board, Grip, Mic, MicOff, Pause, Pencil, Play, UndoRound } from '../components/icons';
import './overlay.css';

const action = (intent: OverlayIntent) => window.tassel.screen.intent(intent);

export function ScrollCaption({ text }: { text: string }) {
  const element = useRef<HTMLParagraphElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const node = element.current;
    if (!text) follow.current = true;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [text]);
  return (
    <p
      ref={element}
      onScroll={() => {
        const node = element.current;
        if (node) follow.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 12;
      }}
    >
      {text}
    </p>
  );
}

const ScreenCanvas = lazy(() =>
  import('../board/tldraw/TldrawCanvas').then((module) => ({ default: module.TldrawCanvas })),
);
const noStage = () => null;

export function MarkLayer({
  marks,
  board,
  viewport,
  language,
}: {
  marks: ScreenMark[];
  board?: ScreenBoard;
  language?: Lang;
  viewport?: { width: number; height: number };
}) {
  const { i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const engine = useRef<BoardEngine | null>(null);
  const latest = useRef({ marks, board, viewport });
  latest.current = { marks, board, viewport };
  const draw = useCallback(() => {
    const node = root.current;
    if (!node) return;
    const { marks, board, viewport } = latest.current;
    engine.current?.screen?.(
      marks,
      viewport ?? { width: node.clientWidth, height: node.clientHeight },
      board,
    );
  }, []);
  const mount = useCallback(
    (next: BoardEngine | null) => {
      engine.current = next;
      draw();
    },
    [draw],
  );
  useLayoutEffect(() => {
    engine.current?.screen?.(
      marks,
      viewport ?? {
        width: root.current?.clientWidth ?? 0,
        height: root.current?.clientHeight ?? 0,
      },
      board,
    );
  }, [marks, board, viewport]);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(draw);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [draw]);
  const lang =
    language ??
    (i18n.resolvedLanguage === 'ko' ? 'ko' : i18n.resolvedLanguage === 'es' ? 'es' : 'en');
  return (
    <div
      ref={root}
      className="screen-ink"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <ScreenCanvas overlay lang={lang} onEngine={mount} stage={noStage} />
      </Suspense>
    </div>
  );
}
export function Overlay({ kind }: { kind: 'hud' | 'ink' }) {
  const { t } = useTranslation();
  const [state, setState] = useState<OverlayState | null>(null);
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => window.tassel.screen.onArrived?.(() => setArrivals((value) => value + 1)), []);
  const [stroke, setStroke] = useState<ScreenPoint[]>([]);
  const pending = useRef<ScreenPoint[]>([]);
  const activePointer = useRef<number | null>(null);
  const [completed, setCompleted] = useState<Array<ScreenMark & { receipt: number }>>([]);
  const issuedStroke = useRef(0);
  const seq = useRef(-1);
  useEffect(() => {
    document.documentElement.dataset.overlay = kind;
    const off = window.tassel.screen.onState((next) => {
      if (next.sequence > seq.current) {
        seq.current = next.sequence;
        setState(next);
        issuedStroke.current = Math.max(issuedStroke.current, next.strokeReceipt ?? 0);
        // Keep optimistic ink until the owner confirms its geometry or acknowledges rejection.
        setCompleted((marks) =>
          next.draw
            ? marks.filter(
                (mark) =>
                  mark.receipt > (next.strokeReceipt ?? 0) &&
                  !next.marks.some(
                    (saved) =>
                      saved.author === 'student' &&
                      JSON.stringify(saved.points) === JSON.stringify(mark.points),
                  ),
              )
            : [],
        );
        useAvatar.setState({ profile: readAvatar(next.avatar) });
        if (!next.draw) {
          pending.current = [];
          activePointer.current = null;
          setStroke([]);
        }
      }
    });
    window.tassel.screen.ready();
    return () => {
      off();
      delete document.documentElement.dataset.overlay;
    };
  }, [kind]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        action('escape');
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Backspace') {
        event.preventDefault();
        action('reset');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (kind === 'ink') {
    const point = (event: React.PointerEvent) => ({
      x: Math.max(0, Math.min(1, event.clientX / window.innerWidth)),
      y: Math.max(0, Math.min(1, event.clientY / window.innerHeight)),
    });
    const end = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pending.current.length || activePointer.current !== event.pointerId) return;
      const points = [...pending.current, point(event)];
      activePointer.current = null;
      const completedMark = {
        id: `pending-${crypto.randomUUID()}`,
        receipt: ++issuedStroke.current,
        kind: 'freehand' as const,
        author: 'student' as const,
        points,
      };
      setCompleted((marks) => [...marks, completedMark]);
      window.tassel.screen.stroke(points);
      pending.current = [];
      setStroke([]);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    };
    return (
      <div
        className={`screen-drawing ${state?.draw ? 'is-drawing' : ''}`}
        data-testid="screen-drawing"
        onPointerDown={(event) => {
          if (!state?.draw || event.button !== 0 || activePointer.current !== null) return;
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          pending.current = [point(event)];
          setStroke([...pending.current]);
        }}
        onPointerMove={(event) => {
          if (
            !state?.draw ||
            activePointer.current !== event.pointerId ||
            !(event.buttons & 1) ||
            !pending.current.length ||
            pending.current.length >= 4095
          )
            return;
          pending.current.push(point(event));
          setStroke([...pending.current]);
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          pending.current = [];
          activePointer.current = null;
          setStroke([]);
        }}
      >
        <MarkLayer
          language={state?.language}
          board={state?.board}
          viewport={state?.viewport}
          marks={[
            ...(state?.marks ?? []),
            ...completed,
            ...(stroke.length
              ? [
                  {
                    id: 'pending',
                    kind: 'freehand' as const,
                    author: 'student' as const,
                    points: stroke,
                  },
                ]
              : []),
          ]}
        />
        {state?.draw && <div className="screen-draw-hint">{t('screen.drawHint')}</div>}
      </div>
    );
  }
  const status =
    state?.status === 'paused'
      ? 'paused'
      : state?.status === 'error'
        ? 'failed'
        : state?.tutorState === 'speaking'
          ? 'speaking'
          : state?.tutorState === 'thinking'
            ? 'thinking'
            : 'listening';
  return (
    <div className="overlay-shell" data-testid="screen-overlay">
      <div className="overlay-bar">
        {arrivals > 0 && (
          <div key={arrivals} className="overlay-arrival avatar-rainbow" aria-hidden="true" />
        )}
        <div className="overlay-main">
          <button
            type="button"
            className="overlay-icon overlay-grip"
            aria-label={t('screen.move')}
            title={t('screen.moveHint')}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            onKeyDown={(event) => {
              const delta = nudgeDelta(event.key, event.shiftKey);
              if (!delta) return;
              event.preventDefault();
              window.tassel.screen.move(delta.dx, delta.dy);
            }}
          >
            <Grip />
          </button>
          <span className="overlay-avatar">
            <Avatar
              profile={readAvatar(state?.avatar)}
              speaking={state?.tutorState === 'speaking'}
            />
          </span>
          <div className="overlay-caption" aria-live="polite">
            <span className="overlay-status">{t(`screen.${status}`)}</span>
            <ScrollCaption
              text={
                state?.caption ||
                t(
                  state?.status === 'sharing'
                    ? 'screen.visibleIdle'
                    : state?.status === 'paused'
                      ? 'screen.pausedIdle'
                      : 'screen.ready',
                )
              }
            />
          </div>
          <div className="overlay-controls">
            <button type="button" onClick={() => action('reset')} title={t('screen.resetHint')}>
              {t('screen.reset')}
            </button>
            <button
              type="button"
              className="overlay-icon"
              aria-label={t(state?.micOn ? 'screen.micOn' : 'screen.micOff')}
              title={t(state?.micOn ? 'screen.micOn' : 'screen.micOff')}
              aria-pressed={state?.micOn ?? true}
              onClick={() => action('mic')}
            >
              {state?.micOn ? <Mic /> : <MicOff />}
            </button>
            <button
              type="button"
              className="overlay-icon"
              aria-label={t('screen.restore')}
              title={t('screen.restore')}
              onClick={() => action('restore')}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8" />
              </svg>
            </button>
          </div>
        </div>
        <div className="overlay-secondary">
          <span className="overlay-sharing">
            <i data-paused={state?.status === 'paused'} />
            {t(state?.status === 'paused' ? 'screen.paused' : 'screen.sharing')}
          </span>
          <button
            type="button"
            className="overlay-icon"
            onClick={() => action('pause')}
            aria-label={t(state?.status === 'paused' ? 'screen.resume' : 'screen.pause')}
            title={t(state?.status === 'paused' ? 'screen.resume' : 'screen.pause')}
          >
            {state?.status === 'paused' ? <Play /> : <Pause />}
          </button>
          <button
            type="button"
            className="overlay-icon"
            aria-label={t('screen.draw')}
            title={t('screen.draw')}
            aria-pressed={state?.draw ?? false}
            disabled={state?.status !== 'sharing'}
            onClick={() => action('draw')}
          >
            <Pencil />
          </button>
          <button
            type="button"
            className="overlay-icon"
            onClick={() => action('undo')}
            aria-label={t('screen.undo')}
            title={t('screen.undo')}
          >
            <UndoRound />
          </button>
          <button
            type="button"
            disabled={state?.status !== 'sharing'}
            onClick={() => action('look')}
          >
            {t('screen.look')}
          </button>
          {state?.boardHint && (
            <button
              type="button"
              className="overlay-icon"
              aria-label={t('screen.board')}
              title={t('screen.board')}
              onClick={() => action('board')}
            >
              <Board />
            </button>
          )}
          <button type="button" onClick={() => action('stop')}>
            {t('screen.stop')}
          </button>
        </div>
        <div className="overlay-feedback" role="status">
          {state?.notice ? t(`screen.${state.notice}`) : ''}
        </div>
      </div>
    </div>
  );
}
