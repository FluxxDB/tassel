import type { VoiceFailure } from '../types';

/** Safe, local reason codes; server bodies and provider details never become UI copy. */
export class VoiceConnectionError extends Error {
  constructor(readonly reason: VoiceFailure) {
    super(reason);
  }
}
