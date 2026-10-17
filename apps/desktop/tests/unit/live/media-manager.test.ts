// @vitest-environment jsdom
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import { describe, expect, it, vi } from 'vitest';
import { TasselMediaManager } from '../../../src/renderer/src/tutor/live/media-manager';
import { Mic } from '../../../src/renderer/src/tutor/live/mic';
import { micHarness } from './audio-fakes';

function setup() {
  const h = micHarness();
  const mic = new Mic(h.deps);
  const audio = { setSinks: vi.fn(async () => ({})), presenterSinkId: 'presenter' };
  return { ...h, mic, audio, manager: new TasselMediaManager(mic, audio) };
}
describe('TasselMediaManager', () => {
  it('SDK initialization preserves an existing mute across new managers and reports direct mic changes', async () => {
    const { mic, audio } = setup();
    await mic.open({ deviceId: null, processing: true });
    mic.setEnabled(false);
    const manager = new TasselMediaManager(mic, audio);
    const transport = new SmallWebRTCTransport({ mediaManager: manager as never });
    transport.initialize({ transport, enableMic: true, enableCam: false }, () => {});
    await manager.connect();
    expect(mic.sentLevel()).toBe(0);
    expect(manager.isMicEnabled).toBe(false);
    mic.setEnabled(true);
    expect(manager.isMicEnabled).toBe(true);
    mic.close();
  });

  it('implements every public member of the 1.11.0 media manager', () => {
    const { manager } = setup();
    for (const name of [
      'setUserAudioCallback',
      'setClientOptions',
      'initialize',
      'connect',
      'disconnect',
      'interruptBotAudio',
      'bufferBotAudio',
      'getAllMics',
      'getAllCams',
      'getAllSpeakers',
      'updateMic',
      'updateCam',
      'updateSpeaker',
      'enableMic',
      'enableCam',
      'enableScreenShare',
      'tracks',
    ])
      expect(typeof Reflect.get(manager, name)).toBe('function');
    for (const name of [
      'selectedMic',
      'selectedCam',
      'selectedSpeaker',
      'isCamEnabled',
      'isMicEnabled',
      'isSharingScreen',
      'supportsScreenShare',
      'mediaSupport',
    ])
      expect(Reflect.get(manager, name)).toBeDefined();
  });
  it('initialize and connect supply a live silent track without opening capture or claiming permission', async () => {
    const { manager, mic, media } = setup();
    const onMicUpdated = vi.fn();
    manager.setClientOptions({
      transport: new SmallWebRTCTransport({ mediaManager: manager as never }),
      callbacks: { onMicUpdated },
    });
    await manager.initialize();
    await manager.connect();
    expect(manager.tracks().local.audio).toBe(mic.sendTrack());
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(onMicUpdated).not.toHaveBeenCalled();
    mic.sendTrack().stop();
    await manager.connect();
    expect(manager.tracks().local.audio?.readyState).toBe('live');
    mic.close();
  });
  it('enableMic(false) mutes and updateMic switches capture', async () => {
    const { manager, mic, media } = setup();
    await mic.open({ deviceId: null, processing: true });
    manager.enableMic(false);
    expect(manager.isMicEnabled).toBe(false);
    expect(mic.sentLevel()).toBe(0);
    await manager.updateMic('mic-2');
    expect(media.getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'mic-2' } }) }),
    );
    mic.close();
  });
  it('updateSpeaker changes the primary while retaining presenter', async () => {
    const { manager, audio } = setup();
    await manager.updateSpeaker('speaker');
    expect(audio.setSinks).toHaveBeenCalledWith({ primary: 'speaker', presenter: 'presenter' });
  });
  it('reports no cameras or screen share even when asked to enable them', async () => {
    const { manager } = setup();
    manager.enableCam(true);
    manager.enableScreenShare(true);
    expect(await manager.getAllCams()).toEqual([]);
    expect(manager.selectedCam).toEqual({});
    expect(manager.isCamEnabled).toBe(false);
    expect(manager.isSharingScreen).toBe(false);
    expect(manager.supportsScreenShare).toBe(false);
    expect(manager.mediaSupport).toEqual({ mic: true, cam: false, screenShare: false });
  });
  it('a denied mic still connects with silence and leaves caller-owned capture lifecycle alone', async () => {
    const { manager, mic, media } = setup();
    media.getUserMedia.mockRejectedValue(new DOMException('', 'NotAllowedError'));
    await mic.open({ deviceId: null, processing: true });
    await expect(manager.connect()).resolves.toBeUndefined();
    expect(mic.sentLevel()).toBe(0);
    await manager.disconnect();
    expect(mic.sendTrack().readyState).toBe('live');
    mic.close();
  });
});
