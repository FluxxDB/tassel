import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('only registers the fixture while the explicit fake marks tutor is connected in a built app', async () => {
  vi.stubEnv('MODE', 'production');
  vi.resetModules();
  const { snapshotSourceFor } = await import(
    '../../../../src/renderer/src/board/marks/snapshot-sources'
  );
  const { createTutorClient } = await import('../../../../src/renderer/src/tutor/create-client');
  expect(snapshotSourceFor('fixture')).toBeUndefined();
  const tutor = createTutorClient({
    serverUrl: 'http://localhost:8852',
    uiLanguage: 'en',
    tutorMode: 'fake',
    fakeScript: 'marks-demo',
    fakeSpeed: 20,
    tokenReset: false,
  });
  try {
    await tutor.connect('test-session');
    expect(snapshotSourceFor('fixture')).toBeDefined();
  } finally {
    await tutor.disconnect();
  }
  expect(snapshotSourceFor('fixture')).toBeUndefined();
});

it('a reconnect keeps its fixture source when the previous disconnect is still settling', async () => {
  vi.stubEnv('MODE', 'production');
  vi.resetModules();
  const { snapshotSourceFor } = await import(
    '../../../../src/renderer/src/board/marks/snapshot-sources'
  );
  const { createTutorClient } = await import('../../../../src/renderer/src/tutor/create-client');
  const tutor = createTutorClient({
    serverUrl: 'http://localhost:8852',
    uiLanguage: 'en',
    tutorMode: 'fake',
    fakeScript: 'marks-demo',
    fakeSpeed: 20,
    tokenReset: false,
  });
  try {
    await tutor.connect('test-session');
    const disconnecting = tutor.disconnect();
    await tutor.connect('test-session');
    await disconnecting;
    expect(snapshotSourceFor('fixture')).toBeDefined();
  } finally {
    await tutor.disconnect();
  }
  expect(snapshotSourceFor('fixture')).toBeUndefined();
});
