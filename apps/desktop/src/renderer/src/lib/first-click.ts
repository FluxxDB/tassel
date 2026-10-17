// A double click acts once. Its second click, and a triple click's third, is ignored: it lands
// wherever the first click led, such as another session's card after End, the dock after a
// card, or the scrim of the sheet the first click opened. Enter and Space click with no count
// (detail 0), so the keyboard always acts.
export function firstClickOnly<E extends { detail: number }>(
  handler: ((event: E) => void) | undefined,
): ((event: E) => void) | undefined {
  if (!handler) return undefined;
  return (event) => {
    if (event.detail <= 1) handler(event);
  };
}
