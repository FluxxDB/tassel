// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AVATAR } from '../../../src/renderer/src/avatar/catalog';
import { useAvatar } from '../../../src/renderer/src/avatar/store';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { useLiveVoice } from '../../../src/renderer/src/features/voice/live-voice';
import { useScreenController } from '../../../src/renderer/src/screen/controller';
import { screenActions, useScreen } from '../../../src/renderer/src/screen/store';
import type { AppConfig } from '../../../src/shared/bridge';
import type { OverlayIntent, ScreenBridge, ScreenPoint } from '../../../src/shared/screen-bridge';

const config: AppConfig = {
  serverUrl: 'http://localhost:8863',
  uiLanguage: 'en',
  tutorMode: 'fake',
  fakeScript: 'dfa-opening',
  fakeSpeed: 1,
  tokenReset: false,
};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  useStageStore.getState().reset();
  useAvatar.setState({ profile: { ...DEFAULT_AVATAR, hair: 'long', outfit: 'dress' } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useLiveVoice.getState().clear();
});
function harness() {
  let intent: (value: OverlayIntent) => void = () => {};
  let stroke: (points: ScreenPoint[]) => void = () => {};
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const capture = vi.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: capture },
  });
  const bridge = {
    displays: vi.fn(async () => [
      { id: 'test', name: 'Test', bounds: { x: 0, y: 0, width: 1280, height: 720 } },
    ]),
    select: vi.fn(async () => ({
      id: 'test',
      name: 'Test',
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    })),
    collapse: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    publish: vi.fn(),
    onIntent: (next: typeof intent) => {
      intent = next;
      return () => {};
    },
    onStroke: (next: typeof stroke) => {
      stroke = next;
      return () => {};
    },
  } as unknown as ScreenBridge;
  vi.stubGlobal('tassel', { screen: bridge });
  const interrupt = vi.fn();
  useLiveVoice.setState({
    client: {
      connect: async () => {},
      disconnect: async () => {},
      sendText: () => {},
      on: () => () => {},
      interrupt,
    },
  });
  const hook = renderHook(() => useScreenController('session', config));
  return {
    hook,
    bridge,
    track,
    capture,
    interrupt,
    intent: (value: OverlayIntent) => intent(value),
    stroke: (points: ScreenPoint[]) => stroke(points),
  };
}
describe('screen controller lifecycle', () => {
  it('mirrors the selected avatar and clears ink while interrupting the same client', async () => {
    const h = harness();
    await act(async () => screenActions()?.start('test'));
    expect(h.bridge.collapse).toHaveBeenCalledOnce();
    await act(async () => screenActions()?.restore());
    await act(async () => screenActions()?.collapse());
    expect(h.bridge.collapse).toHaveBeenCalledTimes(2);
    expect(h.bridge.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        avatar: expect.objectContaining({ hair: 'long', outfit: 'dress' }),
      }),
    );
    act(() => {
      screenActions()?.draw();
      h.stroke([
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
      ]);
    });
    expect(useScreen.getState().marks).toHaveLength(1);
    await act(async () => screenActions()?.reset());
    expect(useScreen.getState().marks).toEqual([]);
    expect(useScreen.getState().draw).toBe(false);
    expect(h.interrupt).toHaveBeenCalledTimes(2);
    await act(async () => screenActions()?.pause());
    await act(async () => screenActions()?.reset());
    expect(useScreen.getState().status).toBe('paused');
    await act(async () => screenActions()?.stop());
    expect(h.track.stop).toHaveBeenCalled();
    expect(useScreen.getState().selected).toBeNull();
    h.hook.unmount();
  });
  it('stops a late stream when selection was cancelled during capture', async () => {
    const h = harness();
    let resolve: (stream: MediaStream) => void = () => {};
    h.capture.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
    );
    let starting: Promise<void> | undefined;
    await act(async () => {
      starting = screenActions()?.start('test');
      await Promise.resolve();
    });
    await act(async () => screenActions()?.stop());
    const late = { getTracks: () => [h.track] } as unknown as MediaStream;
    await act(async () => {
      resolve(late);
      await starting;
    });
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.bridge.collapse).not.toHaveBeenCalled();
    h.hook.unmount();
  });
});

it('pause and resume preserve speech and student ink', async () => {
  const h = harness();
  await act(async () => screenActions()?.start('test'));
  act(() =>
    h.stroke([
      { x: 0.2, y: 0.3 },
      { x: 0.4, y: 0.5 },
    ]),
  );
  const interruptions = h.interrupt.mock.calls.length;
  await act(async () => screenActions()?.pause());
  expect(useScreen.getState().marks).toHaveLength(1);
  expect(h.interrupt).toHaveBeenCalledTimes(interruptions);
  await act(async () => screenActions()?.pause());
  expect(useScreen.getState().marks).toHaveLength(1);
  expect(h.interrupt).toHaveBeenCalledTimes(interruptions);
  h.hook.unmount();
});
