import type { Editor, TLEventInfo } from 'tldraw';
import type { createCameraControl } from './camera-control';

/** Observe native tldraw navigation, never camera records (Ada writes those too). */
export function bindCameraGestures(
  editor: Editor,
  control: ReturnType<typeof createCameraControl>,
  reducedMotion: () => boolean,
): () => void {
  let disposed = false;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  const before = (event: TLEventInfo) => {
    if (event.name === 'pointer_up') {
      // tldraw consumes pointer_up during pinch without emitting its after-event.
      // Defer until the tool has finished (including any inertial pan it starts).
      queueMicrotask(() => {
        if (disposed) return;
        if (reducedMotion()) editor.stopCameraAnimation();
        control.end(`pointer:${event.pointerId}`);
      });
    }
    if (event.name === 'pointer_down') control.begin(`pointer:${event.pointerId}`);
    if (event.name === 'pinch_start') control.begin('pinch');
    if (event.type === 'wheel') {
      // Both macOS Command-scroll and trackpad Ctrl-wheel pinch zoom.
      event.ctrlKey = event.ctrlKey || event.metaKey;
      control.begin('wheel');
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => control.end('wheel'), 160);
    }
  };
  const after = (event: TLEventInfo) => {
    if (event.name === 'pinch_end') {
      if (reducedMotion()) editor.stopCameraAnimation();
      control.end('pinch');
    }
    if (event.name === 'cancel') {
      control.cancel();
      // Escape must not leave the read-only board in the selection tool.
      if (editor.getCurrentToolId() === 'select') editor.setCurrentTool('hand');
    }
  };
  const cancel = () => {
    editor.stopCameraAnimation();
    editor.cancel();
    control.cancel();
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') cancel();
  };
  const container = editor.getContainer();
  // Pointer cancellation and window blur must not leave an Ada fit held forever.
  container.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', visibility);
  editor.on('before-event', before);
  editor.on('event', after);
  return () => {
    disposed = true;
    clearTimeout(wheelTimer);
    editor.off('before-event', before);
    editor.off('event', after);
    container.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', visibility);
  };
}
