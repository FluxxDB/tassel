import { beforeEach, describe, expect, it } from 'vitest';
import { usePaperStore } from '../../../../src/renderer/src/paper/paper-store';
import type { PaperFeed } from '../../../../src/renderer/src/paper/types';

const state = () => usePaperStore.getState();

const INITIAL = {
  kind: null,
  status: 'idle',
  stream: null,
  contentRect: null,
  devices: [],
  deviceId: null,
  override: null,
  restartNonce: 0,
  retrying: false,
  stats: null,
  uploads: { sent: 0, pending: 0, failed: 0, lastError: null },
};

const FEED: PaperFeed = {
  kind: 'window-capture',
  stream: { id: 'window' } as unknown as MediaStream,
  contentRect: { x: 0, y: 0.05, w: 1, h: 0.95 },
  devices: [{ id: 'mac-desk', name: 'MacBook Pro Desk View Camera', builtIn: true }],
  onEnd: () => () => {},
  stop: () => {},
};

beforeEach(() => state().reset());

describe('usePaperStore', () => {
  it('starts idle, with nothing chosen', () => {
    expect(state()).toMatchObject(INITIAL);
  });

  it('retry bumps restartNonce and sets retrying', () => {
    state().retry();
    expect(state()).toMatchObject({ restartNonce: 1, retrying: true });
    state().retry();
    expect(state().restartNonce).toBe(2);
  });

  it('a settled status clears retrying', () => {
    state().retry();
    state().setStatus('starting');
    expect(state().retrying).toBe(true);
    state().setStatus('live');
    expect(state()).toMatchObject({ status: 'live', retrying: false });
    state().retry();
    state().setStatus('denied');
    expect(state().retrying).toBe(false);
  });

  it('useInstead sets the override and bumps restartNonce', () => {
    state().useInstead('window-capture');
    expect(state()).toMatchObject({ override: 'window-capture', restartNonce: 1 });
  });

  it('useDevice sets deviceId and bumps restartNonce', () => {
    state().useDevice('phone-desk');
    expect(state()).toMatchObject({ deviceId: 'phone-desk', restartNonce: 1 });
  });

  it('setFeed takes the feed’s kind, stream, crop and devices; null drops them but keeps the kind', () => {
    state().setFeed(FEED);
    expect(state()).toMatchObject({
      kind: 'window-capture',
      stream: FEED.stream,
      contentRect: FEED.contentRect,
      devices: FEED.devices,
    });
    state().setFeed(null);
    expect(state()).toMatchObject({
      kind: 'window-capture',
      stream: null,
      contentRect: null,
      devices: [],
    });
  });

  it('reset clears everything', () => {
    state().setFeed(FEED);
    state().setStatus('live');
    state().useInstead('screen');
    state().useDevice('phone-desk');
    state().retry();
    state().setStats({
      t: 1,
      busy: false,
      occluded: false,
      quiet: 0,
      cols: 0,
      rows: 0,
      changed: [],
      solid: [],
      quad: null,
      refAgeMs: null,
      triggers: 0,
      opencv: true,
    });
    state().setUploads({ sent: 3, pending: 1, failed: 1, lastError: 'offline' });
    state().reset();
    expect(state()).toMatchObject(INITIAL);
  });
});
