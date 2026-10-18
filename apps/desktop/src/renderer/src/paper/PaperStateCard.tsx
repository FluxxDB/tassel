// Every paper state but idle and live: a glyph, what happened in plain words, and what she can do
// about it. A fixed 320px block on the paper, centered: as the panel narrows in the stage's
// reflow, it's clipped, never reflowed (P1 checklist §4.3). No spinner: starting is static text.
import { type ComponentType, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { useStageStore } from '../features/session/stage-store';
import {
  AlertGlyph,
  CameraGlyph,
  CameraLostGlyph,
  CameraOffGlyph,
  DeskViewGlyph,
  type GlyphProps,
  LockGlyph,
  WindowGlyph,
} from './glyphs';
import { usePaperStore } from './paper-store';
import { openDeskViewSetup } from './sources/helper-protocol';
import type { PaperStatus } from './types';

export type CardStatus = Exclude<PaperStatus, 'idle' | 'live'>;

const LOOK: Record<CardStatus, { glyph: ComponentType<GlyphProps>; body: boolean }> = {
  starting: { glyph: CameraGlyph, body: false },
  off: { glyph: CameraOffGlyph, body: true },
  denied: { glyph: LockGlyph, body: true },
  unavailable: { glyph: DeskViewGlyph, body: true },
  lost: { glyph: CameraLostGlyph, body: true },
  ended: { glyph: WindowGlyph, body: true },
  error: { glyph: AlertGlyph, body: true },
};

interface Action {
  label: string;
  /** A promise keeps the button busy until it settles. */
  run(): unknown;
}

/** The paper bridge, read when an action runs: P1's unit tests stub window.tassel without it. */
const paperBridge = () => (globalThis as { tassel?: Partial<Window['tassel']> }).tassel?.paper;

function useActions(status: CardStatus): Action[] {
  const { t } = useTranslation();
  const retry = usePaperStore((state) => state.retry);
  const switchSource = usePaperStore((state) => state.useInstead);
  const toggleCamera = useStageStore((state) => state.toggleCamera);
  const kind = usePaperStore((state) => state.kind);
  const retryAction: Action = { label: t('common.retry'), run: retry };
  if (kind === 'webcam' && (status === 'unavailable' || status === 'denied')) return [retryAction];
  switch (status) {
    case 'starting':
      return [];
    case 'off':
      return [{ label: t('paper.state.off.action'), run: toggleCamera }];
    case 'denied':
      return [
        {
          label: t('paper.state.denied.settings'),
          run: () => paperBridge()?.openCameraSettings(),
        },
        retryAction,
      ];
    case 'unavailable':
      return [
        {
          label: t('paper.state.unavailable.setup'),
          // Unavailable is settled: the failed start has already let go of the helper (Task 10).
          run: async () => {
            const bridge = paperBridge();
            if (!bridge) return;
            const result = await openDeskViewSetup({ bridge, WebSocketCtor: WebSocket });
            if (result === 'failed') console.warn("[paper] Desk View's setup didn't open");
          },
        },
        {
          label: t('paper.state.unavailable.useWindow'),
          run: () => switchSource('window-capture'),
        },
      ];
    case 'lost':
    case 'error':
      return [retryAction];
    case 'ended':
      return [{ label: t('paper.state.ended.action'), run: retry }];
  }
}

export function PaperStateCard({ status }: { status: CardStatus }) {
  const { t } = useTranslation();
  const { glyph: Glyph, body } = LOOK[status];
  const actions = useActions(status);
  const kind = usePaperStore((state) => state.kind);
  const webcamError = kind === 'webcam' && (status === 'denied' || status === 'unavailable');
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div role="status" className="flex w-[320px] flex-col items-center text-center">
        <Glyph className="mb-4 size-8 shrink-0 text-smoke-text" />
        <h2 className="text-[17px] leading-[22px] font-w520 text-balance text-ink ko:leading-[1.6]">
          {t(webcamError ? `paper.webcam.${status}.title` : `paper.state.${status}.title`)}
        </h2>
        {body && (
          <p className="mt-2 text-[14px] leading-5 text-pretty text-smoke-text ko:leading-[1.6]">
            {t(webcamError ? `paper.webcam.${status}.body` : `paper.state.${status}.body`)}
          </p>
        )}
        {actions.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-2">
            {actions.map((action, index) => (
              <ActionButton key={action.label} action={action} primary={index === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One pill: the first action is the ink primary, the rest are ghost. A slow action acts once. */
function ActionButton({ action, primary }: { action: Action; primary: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={primary ? 'primary' : 'ghost'}
      size="lg"
      busy={busy}
      onClick={() => {
        const pending = action.run();
        if (!(pending instanceof Promise)) return;
        setBusy(true);
        pending
          .catch((error: unknown) => console.warn('[paper] The action failed:', error))
          .finally(() => setBusy(false));
      }}
    >
      {action.label}
    </Button>
  );
}
