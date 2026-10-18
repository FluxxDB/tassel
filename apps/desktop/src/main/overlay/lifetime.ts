/** Electron emits closed after native destruction. Optional chaining alone is insufficient. */
export function hideAlive(window: { isDestroyed(): boolean; hide(): void } | null) {
  if (window && !window.isDestroyed()) window.hide();
}
export function destroyAlive(window: { isDestroyed(): boolean; destroy(): void } | null) {
  if (window && !window.isDestroyed()) window.destroy();
}
