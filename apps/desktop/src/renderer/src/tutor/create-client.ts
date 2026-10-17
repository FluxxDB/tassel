// Which tutor a session gets, from the launch config: P1 has only the scripted fake.
import type { AppConfig } from '../../../shared/bridge';
import { compileScript } from '../board/script/compile';
import type { AuthoredScript } from '../board/script/types';
import { FakeTutorClient } from './fake-client';
import boardDemo from './scripts/board-demo.json';
import dfaOpening from './scripts/dfa-opening.json';
import marksDemo from './scripts/marks-demo.json';
import type { FakeScript, TutorClient } from './types';

/**
 * The fake tutor's scripts, by their TASSEL_FAKE_SCRIPT name: FakeScripts, and authored scripts
 * that compile into one (P5), so Ada's beats keep time with her words.
 */
export const SCRIPTS: Record<string, AuthoredScript | FakeScript> = {
  'dfa-opening': dfaOpening as FakeScript,
  // P5: Ada's board (Task 5) and her marks on the paper (Tasks 7 and 8).
  'board-demo': boardDemo as FakeScript,
  'marks-demo': marksDemo as AuthoredScript,
};

export function createTutorClient(cfg: AppConfig): TutorClient {
  if (cfg.tutorMode === 'live') throw new Error('live tutor arrives in P2');
  const script = Object.hasOwn(SCRIPTS, cfg.fakeScript) ? SCRIPTS[cfg.fakeScript] : undefined;
  if (!script) throw new Error(`Unknown fake tutor script "${cfg.fakeScript}"`);
  // Compiled when it's chosen, so a script with a mistake fails only its own session.
  return new FakeTutorClient(compileScript(script, cfg.fakeScript), {
    speed: cfg.fakeSpeed,
    lang: cfg.uiLanguage,
  });
}
