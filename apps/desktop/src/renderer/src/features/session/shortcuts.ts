// The session screen's keyboard shortcuts. P1 binds M (mic), B (the Board control) and C
// (captions), R18, and T the chat sidebar. P2 adds Space for push-to-talk (tutor/live/push-to-talk.ts) and, in unpackaged
// builds, Ctrl+Shift+L (Cmd+Shift+L on macOS) for the latency HUD. S arrives with P7.
import { useEffect } from 'react';
import { toggleChat } from '../chat/toggle';
import { cycleBoardView, useStageStore } from './stage-store';

const ACTIONS = {
  m: () => useStageStore.getState().toggleMic(),
  b: cycleBoardView,
  c: () => useStageStore.getState().toggleCaptions(),
  t: toggleChat,
} as const;

type Shortcut = keyof typeof ACTIONS;

/** The key that each control shows in its tooltip. */
export const SHORTCUT_KEYS = { mic: 'M', board: 'B', captions: 'C', chat: 'T' } as const;

// Under a layout without Latin letters (Korean 2-set types ㅡ for M), the key's position decides.
const BY_POSITION: Record<string, Shortcut> = { KeyM: 'm', KeyB: 'b', KeyC: 'c', KeyT: 't' };

/**
 * The shortcut a key press means, or null: never with a modifier, a held-down repeat or IME
 * composition, never while she types in a field, and never while a sheet is open.
 */
export function shortcutFor(event: KeyboardEvent): Shortcut | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (isTyping(event.target)) return null;
  if (document.querySelector('[role="dialog"]')) return null;
  const key = event.key.toLowerCase();
  if (key in ACTIONS) return key as Shortcut;
  if (/^[a-z]$/.test(key)) return null;
  return BY_POSITION[event.code] ?? null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Listens for the shortcuts while the session screen is mounted. */
export function useSessionShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      event.preventDefault();
      ACTIONS[shortcut]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Ctrl+Shift+L, or Cmd+Shift+L on macOS: the latency HUD. Either modifier works everywhere, and
 * the key's position counts under a layout without Latin letters.
 */
export function isHudShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey) return false;
  if (!event.shiftKey || !(event.ctrlKey || event.metaKey)) return false;
  return event.key.toLowerCase() === 'l' || event.code === 'KeyL';
}
