import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  OverlayIntent,
  OverlayState,
  ScreenMark,
  ScreenPoint,
} from '../../../shared/screen-bridge';
import { Avatar } from '../avatar/Avatar';
import { readAvatar } from '../avatar/catalog';
import { Board, Mic, MicOff } from '../components/icons';
import './overlay.css';

const action = (intent: OverlayIntent) => window.tassel.screen.intent(intent);

export function MarkLayer({ marks }: { marks: ScreenMark[] }) {
  return (
    <svg
      className="screen-ink"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="screen-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0 0L7 3.5L0 7" fill="none" stroke="currentColor" />
        </marker>
      </defs>
      {marks.map((mark) => {
        const a = mark.points[0];
        if (!a) return null;
        const b = mark.points[1] ?? a;
        if (mark.kind === 'circle')
          return (
            <ellipse
              key={mark.id}
              cx={(a.x + b.x) * 500}
              cy={(a.y + b.y) * 500}
              rx={Math.max(5, Math.abs(b.x - a.x) * 500)}
              ry={Math.max(5, Math.abs(b.y - a.y) * 500)}
            />
          );
        if (mark.kind === 'pointer')
          return <circle key={mark.id} cx={a.x * 1000} cy={a.y * 1000} r="9" />;
        return (
          <polyline
            key={mark.id}
            points={mark.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
            markerEnd={mark.kind === 'arrow' ? 'url(#screen-arrow)' : undefined}
          />
        );
      })}
    </svg>
  );
}
export function Overlay({ kind }: { kind: 'hud' | 'ink' }) {
  const { t } = useTranslation();
  const [state, setState] = useState<OverlayState | null>(null);
  const [stroke, setStroke] = useState<ScreenPoint[]>([]);
  const pending = useRef<ScreenPoint[]>([]);
  const seq = useRef(-1);
  useEffect(() => {
    document.documentElement.dataset.overlay = kind;
    const off = window.tassel.screen.onState((next) => {
      if (next.sequence > seq.current) {
        seq.current = next.sequence;
        setState(next);
        if (!next.draw) {
          pending.current = [];
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
      if (!pending.current.length) return;
      window.tassel.screen.stroke(pending.current);
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
          if (!state?.draw) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pending.current = [point(event)];
          setStroke([...pending.current]);
        }}
        onPointerMove={(event) => {
          if (!state?.draw || !pending.current.length || pending.current.length >= 4096) return;
          pending.current.push(point(event));
          setStroke([...pending.current]);
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          pending.current = [];
          setStroke([]);
        }}
      >
        <MarkLayer
          marks={[
            ...(state?.marks ?? []),
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
        <div className="overlay-main">
          <span className="overlay-avatar">
            <Avatar
              profile={readAvatar(state?.avatar)}
              speaking={state?.tutorState === 'speaking'}
            />
          </span>
          <div className="overlay-caption" aria-live="polite">
            <span className="overlay-status">{t(`screen.${status}`)}</span>
            <p>{state?.caption || t('screen.ready')}</p>
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
          <button type="button" onClick={() => action('pause')}>
            {t(state?.status === 'paused' ? 'screen.resume' : 'screen.pause')}
          </button>
          <button
            type="button"
            aria-pressed={state?.draw ?? false}
            disabled={state?.status !== 'sharing'}
            onClick={() => action('draw')}
          >
            {t('screen.draw')}
          </button>
          <button type="button" onClick={() => action('undo')}>
            {t('screen.undo')}
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
