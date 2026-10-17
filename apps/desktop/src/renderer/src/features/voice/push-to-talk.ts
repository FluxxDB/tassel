/** Space belongs to PTT only while bound. Releasing always wins over focus changes. */
export function bindPushToTalk(target: Window, onHeld: (held: boolean) => void): () => void {
  let held = false;
  const release = () => {
    if (held) {
      held = false;
      onHeld(false);
    }
  };
  const down = (e: KeyboardEvent) => {
    if (
      e.code !== 'Space' ||
      e.defaultPrevented ||
      e.isComposing ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey
    )
      return;
    const el = e.target;
    if (
      el instanceof HTMLElement &&
      (el.isContentEditable || el.closest('input, textarea, select, [contenteditable]'))
    )
      return;
    if (
      target.document.querySelector(
        '[role="dialog"], [data-state="open"][data-radix-popper-content-wrapper]',
      )
    )
      return;
    e.preventDefault();
    if (!held && !e.repeat) {
      held = true;
      onHeld(true);
    }
  };
  const up = (e: KeyboardEvent) => {
    if (e.code === 'Space' && held) {
      e.preventDefault();
      release();
    }
  };
  const visibility = () => {
    if (target.document.hidden) release();
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', release);
  target.document.addEventListener('visibilitychange', visibility);
  return () => {
    release();
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', release);
    target.document.removeEventListener('visibilitychange', visibility);
  };
}
