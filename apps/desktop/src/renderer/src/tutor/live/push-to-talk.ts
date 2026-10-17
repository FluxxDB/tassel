/** Bind only while push-to-talk is on. Mic's separate mute gain always wins over this gate. */
export function bindPushToTalk(target: Window, onHeld: (held: boolean) => void): () => void {
  const document = target.document;
  let held = false;
  let bound = true;
  const release = () => {
    if (held) {
      held = false;
      onHeld(false);
    }
  };
  const down = (event: KeyboardEvent) => {
    if (event.code !== 'Space') return;
    // Suppress the whole accepted key sequence, including repeats, so a focused button cannot click.
    if (held) {
      event.preventDefault();
      return;
    }
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('[role="dialog"]')) return;
    event.preventDefault();
    held = true;
    onHeld(true);
  };
  const up = (event: KeyboardEvent) => {
    // Ignore keyups for presses we did not accept: dialogs and text fields keep native Space.
    if (event.code !== 'Space' || !held) return;
    event.preventDefault();
    release();
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') release();
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', release);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', release);
    document.removeEventListener('visibilitychange', visibility);
    release();
  };
}
