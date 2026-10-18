// Her desk camera, small, while Ada's board fills the stage: the same stream as her paper panel
// in a second video, floating in the stage's bottom right corner until she moves it. A double
// click, or Enter, pins paper and board side by side. It only borrows the stream: hiding it lets
// go of the video, and never stops the camera.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FloatingTile } from '../../components/FloatingTile';
import { cropTransform, type Size } from '../../paper/crop-transform';
import { PaperVideo } from '../../paper/PaperVideo';
import { usePaperStore } from '../../paper/paper-store';
import { useStageStore } from './stage-store';

const NO_SIZE: Size = { w: 0, h: 0 };

export function CameraPip({
  stream,
  inset,
  bottomClearance,
}: {
  stream: MediaStream;
  inset: number;
  bottomClearance: number;
}) {
  const { t } = useTranslation();
  const crop = usePaperStore((state) => state.contentRect);
  const pin = useStageStore((state) => state.pin);
  const [video, setVideo] = useState<Size>(NO_SIZE);
  return (
    <FloatingTile
      id="desk-pip"
      label={t('session.pip.label')}
      hint={t('session.pip.hint')}
      defaultCorner="bottom-right"
      defaultSize={{ w: 240, h: 150 }}
      minWidth={160}
      maxWidth={480}
      inset={inset}
      bottomClearance={bottomClearance}
      onActivate={() => pin('split')}
    >
      {(box) => (
        <div
          data-testid="camera-pip"
          className="absolute inset-0 overflow-hidden rounded-card bg-desk"
        >
          <PaperVideo
            stream={stream}
            crop={crop}
            video={video}
            transform={cropTransform(video, crop, box)}
            onSize={(size) =>
              setVideo((old) => (old.w === size.w && old.h === size.h ? old : size))
            }
          />
          <span className="absolute bottom-2 left-2 flex h-[22px] items-center gap-1.5 rounded-pill bg-paper px-2">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-live" />
            <span className="mono text-[11px] leading-[14px] whitespace-nowrap text-ink">
              {t('session.pip.label')}
            </span>
            <span className="mono text-[11px] leading-[14px] whitespace-nowrap text-smoke-text">
              {t('session.pip.live')}
            </span>
          </span>
        </div>
      )}
    </FloatingTile>
  );
}
