// Her paper, live: the feed's video at its native size, placed in the panel by cropTransform and
// clipped to the feed's content, so a window capture's title bar never shows.
import { useEffect, useRef } from 'react';
import { cropClipPath, type FeedTransform, type Size } from './crop-transform';
import type { NormRect } from './types';

export interface PaperVideoProps {
  stream: MediaStream;
  crop: NormRect | null;
  /** The video's native size (0 × 0 until it has a frame). */
  video: Size;
  transform: FeedTransform;
  /** The video's native size, whenever it's known or changes. */
  onSize(size: Size): void;
}

export function PaperVideo({ stream, crop, video, transform, onSize }: PaperVideoProps) {
  const element = useRef<HTMLVideoElement>(null);
  const reportSize = useRef(onSize);
  reportSize.current = onSize;

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    el.srcObject = stream;
    const measure = () => reportSize.current({ w: el.videoWidth || 0, h: el.videoHeight || 0 });
    // A source can change size mid-stream (the helper's frames follow the camera's).
    el.addEventListener('loadedmetadata', measure);
    el.addEventListener('resize', measure);
    measure();
    return () => {
      el.removeEventListener('loadedmetadata', measure);
      el.removeEventListener('resize', measure);
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={element}
      data-testid="paper-video"
      autoPlay
      muted
      playsInline
      disablePictureInPicture
      className="absolute top-0 left-0 max-w-none origin-top-left"
      style={{
        width: `${video.w}px`,
        height: `${video.h}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        clipPath: cropClipPath(crop),
      }}
    />
  );
}
