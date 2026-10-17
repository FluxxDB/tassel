// Ada's effects on the board: a pulse around a state, and a token gliding along edges. An overlay
// draws them on tldraw's canvas, so nothing is stored in the document, nor counts as an edit.
import type { Pt } from '@tassel/shared/beats';
import { type Atom, atom, type Editor, OverlayUtil, type TLOverlay } from 'tldraw';
import { MOTION } from '../motion';
import { glideTokenAt, pulseRingAt } from './effect-frames';

export type AdaEffect =
  | { type: 'pulse'; center: Pt; r: number }
  /** Each edge is a path of points, walked in turn. */
  | { type: 'glide'; edges: Pt[][] };

interface Running {
  id: number;
  effect: AdaEffect;
  started: number;
  ms: number;
  done(): void;
}

type EffectFrame =
  | { kind: 'ring'; x: number; y: number; r: number; alpha: number }
  | { kind: 'token'; x: number; y: number };

interface AdaEffectOverlay extends TLOverlay {
  props: EffectFrame;
}

/** iris-ink: Ada's marks only (DESIGN.md). The canvas can't read the CSS token. */
const IRIS_INK = '#7d4fc4';
/** The glide's token: a 10 px dot. */
const TOKEN_R = 5;

/** One editor's running effects, and the clock their frames are drawn at. */
class Effects {
  readonly running: Atom<Running[]> = atom('ada effects', []);
  readonly now: Atom<number> = atom('ada effects clock', 0);
  private nextId = 1;
  private ticking = false;

  constructor(private readonly editor: Editor) {}

  /** Plays `effect`; resolves when it ends. */
  play(effect: AdaEffect): Promise<void> {
    const ms = effect.type === 'pulse' ? MOTION.pulseMs : MOTION.glideMs * effect.edges.length;
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const started = performance.now();
      this.now.set(started);
      this.running.update((list) => [
        ...list,
        { id: this.nextId++, effect, started, ms, done: resolve },
      ]);
      if (!this.ticking) {
        this.ticking = true;
        this.editor.on('tick', this.tick);
      }
    });
  }

  /** Ends every effect at once, as when the board goes away. */
  stop(): void {
    for (const effect of this.running.get()) effect.done();
    this.running.set([]);
    this.editor.off('tick', this.tick);
    this.ticking = false;
  }

  private readonly tick = () => {
    const now = performance.now();
    this.now.set(now);
    const list = this.running.get();
    const left = list.filter((effect) => now - effect.started < effect.ms);
    if (left.length === list.length) return;
    for (const effect of list) if (!left.includes(effect)) effect.done();
    this.running.set(left);
    if (left.length === 0) {
      this.editor.off('tick', this.tick);
      this.ticking = false;
    }
  };
}

const byEditor = new WeakMap<Editor, Effects>();

/** The effects player of `editor`, made on first use. */
export function effectsOf(editor: Editor): Effects {
  let effects = byEditor.get(editor);
  if (!effects) {
    effects = new Effects(editor);
    byEditor.set(editor, effects);
  }
  return effects;
}

/** Draws each running effect's frame: rings and tokens in iris-ink, in page space. */
export class AdaEffectsOverlayUtil extends OverlayUtil<AdaEffectOverlay> {
  static override type = 'ada-effects';
  override options = { zIndex: 150 };

  override isActive(): boolean {
    return effectsOf(this.editor).running.get().length > 0;
  }

  override getOverlays(): AdaEffectOverlay[] {
    const effects = effectsOf(this.editor);
    const now = effects.now.get();
    return effects.running.get().flatMap((running) => {
      const frame = frameOf(running.effect, now - running.started);
      return frame ? [{ id: `ada-effect:${running.id}`, type: 'ada-effects', props: frame }] : [];
    });
  }

  override render(ctx: CanvasRenderingContext2D, overlays: AdaEffectOverlay[]): void {
    ctx.save();
    for (const { props } of overlays) {
      ctx.beginPath();
      if (props.kind === 'ring') {
        ctx.globalAlpha = props.alpha;
        ctx.strokeStyle = IRIS_INK;
        ctx.lineWidth = 2;
        ctx.arc(props.x, props.y, props.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = IRIS_INK;
        ctx.arc(props.x, props.y, TOKEN_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function frameOf(effect: AdaEffect, elapsed: number): EffectFrame | null {
  if (effect.type === 'pulse') {
    const { r, alpha } = pulseRingAt(effect.r, elapsed);
    return { kind: 'ring', x: effect.center.x, y: effect.center.y, r, alpha };
  }
  const token = glideTokenAt(effect.edges, elapsed);
  return token && { kind: 'token', x: token.x, y: token.y };
}
