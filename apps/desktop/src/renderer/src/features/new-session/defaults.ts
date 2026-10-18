// The new session sheet's starting choices.
import type { Source } from '@tassel/shared/api';
import type { Platform } from '../../../../shared/bridge';

/** Windows has no Desk View, so a session there starts from screen share; elsewhere, paper. */
export function defaultSource(platform: Platform): Source {
  return platform === 'win32' ? 'screen' : 'paper';
}

/**
 * Whether Paper can't be chosen: on Windows, which has no Desk View, unless a dev or E2E run plays
 * the fake clip (R11). The default source and the Windows notice stay as they are either way.
 */
export function paperUnavailable(platform: Platform, paperFakeClip: boolean): boolean {
  return platform === 'win32' && !paperFakeClip;
}
