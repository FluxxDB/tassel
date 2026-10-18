/** Local development never selects paid TTS merely because a key exists. */
export function devVoiceEnv(env) {
  return { ...env, TASSEL_TTS_PROVIDER: env.TASSEL_TTS_PROVIDER || 'fake' };
}
