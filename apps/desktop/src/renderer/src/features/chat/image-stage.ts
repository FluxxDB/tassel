// The one hook between the chat and the stage's image side: an action row on one of her images
// (side "image") calls showImageOnStage. The image stage panel registers itself here when it
// mounts; until one does, showImageOnStage answers false and the chat opens the image in its own
// viewer instead.
type Show = (attachmentId: string) => void;

let show: Show | null = null;

/** Makes `next` what shows her image on the stage. Returns its unregister. */
export function registerImageStage(next: Show): () => void {
  show = next;
  return () => {
    if (show === next) show = null;
  };
}

/** Shows attachment `attachmentId` on the stage; false when no image stage is there to. */
export function showImageOnStage(attachmentId: string): boolean {
  if (!show) return false;
  show(attachmentId);
  return true;
}
