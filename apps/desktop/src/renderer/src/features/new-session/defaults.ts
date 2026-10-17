// The new session sheet's starting choices.
import type { Source } from '@tassel/shared/api';
import type { Platform } from '../../../../shared/bridge';

/** Windows has no Desk View, so a session there starts from screen share; elsewhere, paper. */
export function defaultSource(platform: Platform): Source {
  return platform === 'win32' ? 'screen' : 'paper';
}
