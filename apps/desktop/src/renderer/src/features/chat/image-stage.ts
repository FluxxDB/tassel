// The chat's way onto the stage: an action row with side "image", or a click in the sidebar's
// image viewer, asks the stage to show the student's image. Until a stage registers (the
// session screen's paper panel), the sidebar opens the image in its own viewer instead.

type Show = (attachmentId: string) => void;

let registered: Show | null = null;

/** Shows the attachment on the stage. False when no stage is up to show it. */
export function showImageOnStage(attachmentId: string): boolean {
  if (!registered) return false;
  registered(attachmentId);
  return true;
}

/**
 * Makes `show` the stage that shows images. Returns the unregister, which brings back the one
 * it replaced, if any.
 */
export function registerImageStage(show: Show): () => void {
  const previous = registered;
  registered = show;
  return () => {
    if (registered !== show) return;
    registered = previous;
  };
}
