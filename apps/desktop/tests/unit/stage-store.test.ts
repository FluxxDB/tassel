import { beforeEach, describe, expect, it } from 'vitest';
import { cycleBoardView, useStageStore } from '../../src/renderer/src/features/session/stage-store';

const state = () => useStageStore.getState();

beforeEach(() => state().reset());

describe('useStageStore', () => {
  it('starts on her paper, following Ada, with Ada connecting and mic, camera and captions on', () => {
    expect(state()).toMatchObject({
      mode: 'paper',
      pinned: null,
      requested: 'paper',
      tutorState: 'connecting',
      captionsOn: true,
      micOn: true,
      cameraOn: true,
      caption: {},
    });
  });

  it('follows the requested mode while nothing is pinned', () => {
    state().requestMode('split');
    expect(state()).toMatchObject({ mode: 'split', requested: 'split', pinned: null });
  });

  it('requestMode is ignored while pinned but remembered', () => {
    state().pin('paper');
    state().requestMode('split');
    expect(state()).toMatchObject({ mode: 'paper', pinned: 'paper', requested: 'split' });
  });

  it('unpin restores the latest requested mode', () => {
    state().pin('board');
    state().requestMode('split');
    state().requestMode('paper');
    state().unpin();
    expect(state()).toMatchObject({ mode: 'paper', pinned: null, requested: 'paper' });
  });

  it('pushCaption shifts current to previous', () => {
    state().pushCaption('student', "Hi Ada, I'm working on a DFA.");
    expect(state().caption).toEqual({
      current: { speaker: 'student', text: "Hi Ada, I'm working on a DFA." },
    });
    state().pushCaption('tutor', 'Great, draw it on paper.', 'en');
    expect(state().caption).toEqual({
      previous: { speaker: 'student', text: "Hi Ada, I'm working on a DFA." },
      current: { speaker: 'tutor', text: 'Great, draw it on paper.', lang: 'en' },
    });
  });

  it('sets the tutor state and toggles captions, mic and camera', () => {
    state().setTutorState('speaking');
    state().toggleCaptions();
    state().toggleMic();
    state().toggleCamera();
    expect(state()).toMatchObject({
      tutorState: 'speaking',
      captionsOn: false,
      micOn: false,
      cameraOn: false,
    });
    state().toggleMic();
    expect(state().micOn).toBe(true);
  });

  it('reset returns to the start', () => {
    state().pin('split');
    state().pushCaption('tutor', 'Before you move on…');
    state().setTutorState('watching');
    state().reset();
    expect(state()).toMatchObject({ mode: 'paper', pinned: null, tutorState: 'connecting' });
    expect(state().caption).toEqual({});
  });
});

describe('cycleBoardView (R17)', () => {
  it('pins paper, then split, then board, then follows Ada again', () => {
    state().requestMode('split');
    const seen = [];
    for (let step = 0; step < 4; step += 1) {
      cycleBoardView();
      seen.push([state().pinned, state().mode]);
    }
    expect(seen).toEqual([
      ['paper', 'paper'],
      ['split', 'split'],
      ['board', 'board'],
      // Following Ada again shows what she asked for last.
      [null, 'split'],
    ]);
    cycleBoardView();
    expect(state()).toMatchObject({ pinned: 'paper', mode: 'paper' });
  });
});

it('interim updates and the final replace in place, retaining each language', () => {
  state().pushCaption('tutor', 'Hello', 'en');
  state().showInterim('student', '안', 'ko');
  state().showInterim('student', '안녕', 'ko');
  expect(state().caption).toEqual({
    previous: { speaker: 'tutor', text: 'Hello', lang: 'en' },
    current: { speaker: 'student', text: '안녕', lang: 'ko', interim: true },
  });
  state().pushCaption('student', '안녕하세요', 'ko');
  expect(state().caption.previous?.text).toBe('Hello');
  expect(state().caption.current?.interim).toBeUndefined();
  state().pushCaption('tutor', 'Hola', 'es');
  expect(state().caption.previous).toEqual({ speaker: 'student', text: '안녕하세요', lang: 'ko' });
});
