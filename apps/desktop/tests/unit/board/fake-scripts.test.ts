import { describe, expect, it } from 'vitest';
import { createTutorClient } from '../../../src/renderer/src/tutor/create-client';
import { FakeTutorClient } from '../../../src/renderer/src/tutor/fake-client';
import type { AppConfig } from '../../../src/shared/bridge';

const config: AppConfig = {
  serverUrl: 'http://127.0.0.1:8799',
  uiLanguage: 'en',
  tutorMode: 'fake',
  fakeScript: 'dfa-opening',
  fakeSpeed: 20,
  tokenReset: false,
};

describe("P5's fake tutor scripts", () => {
  it.each([
    'board-demo',
    'marks-demo',
    'diagram-demo',
    'board-snapshot',
    'image-demo',
    'trace-demo',
  ])('runs %s, by its TASSEL_FAKE_SCRIPT name', (name) => {
    expect(createTutorClient({ ...config, fakeScript: name })).toBeInstanceOf(FakeTutorClient);
  });
});
