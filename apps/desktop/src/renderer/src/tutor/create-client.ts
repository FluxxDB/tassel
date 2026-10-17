// Which tutor a session gets, from the launch config: P1 has only the scripted fake.
import type { AppConfig } from '../../../shared/bridge';
import { FakeTutorClient } from './fake-client';
import boardDemo from './scripts/board-demo.json';
import dfaOpening from './scripts/dfa-opening.json';
import marksDemo from './scripts/marks-demo.json';
import type { FakeScript, TutorClient } from './types';

/** The fake tutor's scripts, by their TASSEL_FAKE_SCRIPT name. */
const SCRIPTS: Record<string, FakeScript> = {
  'dfa-opening': dfaOpening as FakeScript,
  // P5: Ada's board (Task 5) and her marks on the paper (Task 7).
  'board-demo': boardDemo as FakeScript,
  'marks-demo': marksDemo as FakeScript,
};

export function createTutorClient(cfg: AppConfig): TutorClient {
  if (cfg.tutorMode === 'live') throw new Error('live tutor arrives in P2');
  const script = SCRIPTS[cfg.fakeScript];
  if (!script) throw new Error(`Unknown fake tutor script "${cfg.fakeScript}"`);
  return new FakeTutorClient(script, { speed: cfg.fakeSpeed, lang: cfg.uiLanguage });
}
