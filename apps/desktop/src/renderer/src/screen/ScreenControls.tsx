import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Pause, Play } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { MarkLayer } from '../overlay/Overlay';
import { containRect } from './geometry';
import { screenActions, useScreen } from './store';

export function ScreenPicker() {
  const state = useScreen();
  const { t } = useTranslation();
  return (
    <Sheet
      open={state.status === 'selecting' && !state.stream}
      onOpenChange={(open) => {
        if (!open) void screenActions()?.stop();
      }}
      title={t('screen.choose')}
    >
      <div className="flex flex-col gap-2">
        {state.displays.map((display) => (
          <Button key={display.id} onClick={() => void screenActions()?.start(display.id)}>
            {display.name}
          </Button>
        ))}
        {!state.displays.length && <p>{t('screen.noDisplays')}</p>}
        <Button variant="ghost" onClick={() => void screenActions()?.stop()}>
          {t('common.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
export function ScreenPanel() {
  const { t } = useTranslation();
  const state = useScreen();
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = state.stream;
    const measure = () => {
      const box = container.current;
      if (box)
        setRect(
          containRect(element.videoWidth, element.videoHeight, box.clientWidth, box.clientHeight),
        );
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (container.current) observer?.observe(container.current);
    element.addEventListener('loadedmetadata', measure);
    measure();
    if (state.stream) void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
      observer?.disconnect();
      element.removeEventListener('loadedmetadata', measure);
    };
  }, [state.stream]);
  return (
    <div className="relative flex h-full items-center justify-center" data-testid="screen-panel">
      {state.stream ? (
        <div ref={container} className="relative h-full w-full">
          <video ref={video} muted autoPlay className="h-full w-full object-contain" />
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
          >
            <MarkLayer marks={state.marks} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p>{t('screen.ready')}</p>
          <Button onClick={() => void screenActions()?.choose()}>{t('screen.choose')}</Button>
        </div>
      )}
      {state.notice && (
        <p role="status" className="absolute top-14 rounded-card bg-bone px-4 py-2">
          {t(`screen.${state.notice}`)}
        </p>
      )}
      {state.selected && (
        <div className="absolute right-4 bottom-4 flex gap-2">
          {state.status === 'error' && (
            <Button onClick={() => void screenActions()?.reset()}>{t('common.retry')}</Button>
          )}
          <Button
            aria-label={t(state.status === 'paused' ? 'screen.resume' : 'screen.pause')}
            title={t(state.status === 'paused' ? 'screen.resume' : 'screen.pause')}
            onClick={() => void screenActions()?.pause()}
          >
            {state.status === 'paused' ? <Play /> : <Pause />}
          </Button>
          <Button onClick={() => void screenActions()?.reset()}>{t('screen.reset')}</Button>
          <Button onClick={() => void screenActions()?.collapse()}>{t('screen.collapse')}</Button>
          <Button variant="ghost" onClick={() => void screenActions()?.stop()}>
            {t('screen.stop')}
          </Button>
        </div>
      )}
    </div>
  );
}
