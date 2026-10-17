// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorAudio } from '../../../src/renderer/src/tutor/live/tutor-audio';
import { FakeContext, FakeStream, FakeTrack } from './audio-fakes';

function setup() {
  const element = document.createElement('audio');
  const play = vi.spyOn(element, 'play').mockResolvedValue();
  const pause = vi.spyOn(element, 'pause').mockImplementation(() => {});
  const setSinkId = vi.fn(async (_id: string) => {});
  Object.assign(element, { setSinkId });
  const contexts: FakeContext[] = [];
  const createContext = vi.fn((_opts?: { sinkId?: string }) => {
    const c = new FakeContext();
    contexts.push(c);
    return c.asContext();
  });
  const audio = new TutorAudio({ createAudio: () => element, createContext });
  return { audio, element, play, pause, setSinkId, contexts, createContext };
}
beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeStream);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
describe('TutorAudio', () => {
  it('plays the bot track on the primary sink and measures its RMS', async () => {
    const { audio, element, play, setSinkId } = setup();
    const track = new FakeTrack().asTrack();
    expect(await audio.setSinks({ primary: 'speaker', presenter: null })).toEqual({
      primary: 'ok',
      presenter: 'off',
    });
    audio.attach(track);
    expect((element.srcObject as MediaStream).getTracks()).toEqual([track]);
    expect(play).toHaveBeenCalled();
    expect(setSinkId).toHaveBeenCalledWith('speaker');
    expect(element.dataset.testid).toBe('tutor-audio');
    expect(element.hidden).toBe(true);
    expect(document.body.contains(element)).toBe(true);
    expect(audio.level()).toBeCloseTo(0.5);
    audio.dispose();
  });
  it('presenter adds a second sink context and keeps the element playing', async () => {
    const { audio, element, createContext, play, contexts } = setup();
    audio.attach(new FakeTrack().asTrack());
    expect(await audio.setSinks({ primary: 'one', presenter: 'two' })).toEqual({
      primary: 'ok',
      presenter: 'ok',
    });
    expect(createContext).toHaveBeenCalledWith({ sinkId: 'two' });
    expect(element.dataset.presenterSink).toBe('two');
    expect(audio.presenterSinkId).toBe('two');
    expect(play).toHaveBeenCalled();
    expect(contexts[1]?.destination.signal()).toBeCloseTo(0.5);
    audio.dispose();
  });
  it('a failing setSinkId falls back to default', async () => {
    const { audio, setSinkId } = setup();
    setSinkId.mockRejectedValueOnce(new DOMException('', 'NotFoundError'));
    expect(await audio.setSinks({ primary: 'unplugged', presenter: null })).toEqual({
      primary: 'fallback',
      presenter: 'off',
    });
    expect(setSinkId.mock.calls.map(([id]) => id)).toEqual(['unplugged', '']);
    audio.dispose();
  });
  it('turning presenter off closes its context', async () => {
    const { audio, contexts } = setup();
    await audio.setSinks({ primary: 'one', presenter: 'two' });
    await audio.setSinks({ primary: 'one', presenter: null });
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
    expect(audio.presenterSinkId).toBeNull();
    expect(audio.element.dataset.presenterSink).toBe('');
    audio.dispose();
  });
  it.each([
    ['one', 'one'],
    [null, 'default'],
  ])('refuses the same device for both outputs (%s, %s)', async (primary, presenter) => {
    const { audio, createContext } = setup();
    expect(await audio.setSinks({ primary, presenter })).toEqual({
      primary: 'ok',
      presenter: 'off',
    });
    expect(createContext).not.toHaveBeenCalled();
    audio.dispose();
  });
  it('a missing presenter returns fallback and does not double default playback', async () => {
    const { audio, createContext } = setup();
    createContext.mockImplementationOnce(() => {
      throw new DOMException('', 'NotFoundError');
    });
    expect(await audio.setSinks({ primary: null, presenter: 'gone' })).toEqual({
      primary: 'ok',
      presenter: 'fallback',
    });
    expect(audio.presenterSinkId).toBeNull();
    audio.dispose();
  });
  it('duck lowers both outputs, ramps presenter for 60ms, restores, and notifies once per change', async () => {
    const { audio, element, contexts } = setup();
    const listener = vi.fn();
    const off = audio.onDuck(listener);
    audio.attach(new FakeTrack().asTrack());
    await audio.setSinks({ primary: 'one', presenter: 'two' });
    audio.duck(true);
    audio.duck(true);
    expect(element.volume).toBe(0.25);
    expect(contexts[1]?.destination.signal()).toBeCloseTo(0.125);
    expect(contexts[1]?.gains[0]?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.25, 2.06);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true, expect.any(Number));
    audio.duck(false);
    expect(element.volume).toBe(1);
    expect(contexts[1]?.destination.signal()).toBeCloseTo(0.5);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    audio.duck(true);
    expect(listener).toHaveBeenCalledTimes(2);
    audio.dispose();
  });
  it('replacing a track disconnects the old graph and preserves current duck', async () => {
    const { audio, contexts } = setup();
    audio.attach(new FakeTrack().asTrack());
    await audio.setSinks({ primary: 'one', presenter: 'two' });
    audio.duck(true);
    audio.attach(new FakeTrack('next').asTrack());
    expect(contexts[1]?.destination.signal()).toBeCloseTo(0.125);
    expect(contexts[0]?.sources[0]?.outputs.size).toBe(0);
    audio.dispose();
  });
  it('dispose stops playback, removes the element and closes every context without stopping transport tracks', async () => {
    const { audio, element, contexts, pause } = setup();
    const track = new FakeTrack();
    audio.attach(track.asTrack());
    await audio.setSinks({ primary: 'one', presenter: 'two' });
    audio.dispose();
    audio.dispose();
    expect(pause).toHaveBeenCalledOnce();
    expect(element.srcObject).toBeNull();
    expect(document.body.contains(element)).toBe(false);
    for (const c of contexts) expect(c.close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
    expect(audio.level()).toBe(0);
  });
});
