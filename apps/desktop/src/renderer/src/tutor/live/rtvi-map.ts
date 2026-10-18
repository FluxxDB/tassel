import type { TransportState } from '@pipecat-ai/client-js';
import type { Lang } from '@tassel/shared/i18n';
import { parseServerEvent } from '@tassel/shared/voice';
import type { TutorEvent } from '../types';

export type RtviInput =
  | { kind: 'transport'; state: TransportState }
  | { kind: 'bot-ready' }
  | { kind: 'user-started' }
  | { kind: 'user-stopped' }
  | { kind: 'bot-started' }
  | { kind: 'bot-stopped' }
  | { kind: 'user-text'; text: string; final: boolean }
  | {
      kind: 'bot-output';
      segmentId: string;
      status: 'new' | 'in-progress' | 'completed' | null;
      text: string;
      accumulated: string | null;
    }
  | { kind: 'server'; data: unknown };
export type Effect =
  | { type: 'duck'; on: boolean }
  | { type: 'reconnect'; when: 'now' | 'after-bot-stops' };
export interface MapState {
  lang: Lang;
  botSpeaking: boolean;
  done: string[];
  segment: { id: string; spoken: string } | null;
}
export function initialMapState(lang: Lang): MapState {
  return { lang, botSpeaking: false, done: [], segment: null };
}
export function mapRtvi(
  previous: MapState,
  input: RtviInput,
): { state: MapState; events: TutorEvent[]; effects: Effect[] } {
  const state: MapState = {
    ...previous,
    done: [...previous.done],
    segment: previous.segment ? { ...previous.segment } : null,
  };
  const events: TutorEvent[] = [];
  const effects: Effect[] = [];
  const caption = (final: boolean) => {
    const text = [...state.done, state.segment?.spoken ?? ''].filter(Boolean).join(' ');
    if (text) events.push({ type: 'caption', speaker: 'tutor', text, final, lang: state.lang });
  };
  switch (input.kind) {
    case 'transport':
      events.push(
        { type: 'connection', status: 'connecting' },
        { type: 'state', state: 'connecting' },
      );
      break;
    case 'bot-ready':
      events.push(
        { type: 'connection', status: 'connected' },
        { type: 'state', state: 'listening' },
      );
      break;
    case 'user-started':
      events.push({ type: 'state', state: 'listening' });
      break;
    case 'user-stopped':
      events.push({ type: 'state', state: 'thinking' });
      break;
    case 'bot-started':
      state.botSpeaking = true;
      state.done = [];
      state.segment = null;
      events.push({ type: 'state', state: 'speaking' });
      break;
    case 'bot-stopped':
      state.botSpeaking = false;
      events.push({ type: 'state', state: 'listening' });
      caption(true);
      state.done = [];
      state.segment = null;
      effects.push({ type: 'duck', on: false });
      break;
    case 'user-text':
      events.push({
        type: 'caption',
        speaker: 'student',
        text: input.text,
        final: input.final,
        lang: state.lang,
      });
      break;
    case 'bot-output': {
      if (!input.status) break;
      if (input.status === 'new' || state.segment?.id !== input.segmentId) {
        if (state.segment?.spoken) state.done.push(state.segment.spoken);
        state.segment = { id: input.segmentId, spoken: '' };
      }
      if (input.status === 'new') break;
      const before = words(state.segment?.spoken ?? '');
      const spoken = input.accumulated ?? (input.status === 'completed' ? input.text : '');
      // Each word says where it sits (P5-R7): its segment, and its 0-based index there, so the
      // beat player finds its document even after an earlier sentence's tail went unheard.
      const heard = words(spoken);
      for (let index = before.length; index < heard.length; index++)
        events.push({
          type: 'word',
          text: heard[index] as string,
          lang: state.lang,
          ...(input.segmentId && { segment: input.segmentId, index }),
        });
      if (input.status === 'completed') {
        if (spoken) state.done.push(spoken);
        state.segment = null;
      } else state.segment = { id: input.segmentId, spoken };
      caption(false);
      break;
    }
    case 'server': {
      const event = parseServerEvent(input.data);
      if (!event) break;
      switch (event.kind) {
        case 'title':
          events.push({ type: 'title', title: event.title, subject: event.subject });
          break;
        case 'paper-frame':
          events.push({ type: 'paper-request' });
          break;
        case 'board-snapshot':
          events.push({ type: 'board-snapshot' });
          break;
        case 'stage':
          events.push({
            type: 'stage',
            mode: event.view,
            ...(event.pinned && { pinned: true as const }),
          });
          break;
        case 'actions':
          events.push({ type: 'actions', actions: event.actions });
          break;
        case 'beat':
          events.push({ type: 'beat', beat: event.beat });
          break;
        case 'message': {
          const { kind: _kind, ...message } = event;
          events.push({ type: 'message', message });
          break;
        }
        case 'language':
          state.lang = event.lang;
          events.push({ type: 'language', lang: event.lang });
          effects.push({ type: 'reconnect', when: state.botSpeaking ? 'after-bot-stops' : 'now' });
          break;
        case 'vad':
          if (!event.speaking || state.botSpeaking)
            effects.push({ type: 'duck', on: event.speaking });
          break;
        case 'backchannel':
          events.push({ type: 'voice-debug', event });
          effects.push({ type: 'duck', on: false });
          break;
        case 'route':
        case 'turn-metrics':
          events.push({ type: 'voice-debug', event });
          break;
      }
    }
  }
  return { state, events, effects };
}
function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/u) : [];
}
