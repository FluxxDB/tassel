import type { ApiClient } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { useEffect, useRef, useState } from 'react';
import type { AppConfig } from '../../../../shared/bridge';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import { createTutorClient } from '../../tutor/create-client';
import { LatencyMeter, startLatencySampler } from '../../tutor/live/latency';
import { Mic } from '../../tutor/live/mic';
import { bindPushToTalk } from '../../tutor/live/push-to-talk';
import { TutorAudio } from '../../tutor/live/tutor-audio';
import type { TutorClient } from '../../tutor/types';
import { useStageStore } from '../session/stage-store';
import { useAudioPrefs } from './audio-prefs';
import { useVoiceDebug } from './voice-debug';

export interface VoiceSessionResources {
  mic: Mic;
  audio: TutorAudio;
  meter: LatencyMeter;
}
interface Binding {
  resources: VoiceSessionResources | null;
  client: TutorClient | null;
}

/** Construct browser resources in an effect, never during React render (including StrictMode).
 * Fake sessions allocate no audio resources. Live resources are null until the effect runs. */
export function useVoiceSession(opts: {
  sessionId: string;
  lang: Lang;
  app: AppConfig;
  config: VoiceConfig;
  api: ApiClient;
}): Binding {
  const latest = useRef(opts);
  latest.current = opts;
  const [binding, setBinding] = useState<Binding>({ resources: null, client: null });
  const { sessionId, app, api } = opts;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each session must own fresh resources, even with identical launch config
  useEffect(() => {
    useVoiceDebug.getState().reset();
    if (app.tutorMode === 'fake') {
      const client = createTutorClient(app);
      setBinding({ resources: null, client });
      return () => {
        void client.disconnect();
      };
    }
    const mic = new Mic({ media: navigator.mediaDevices, createContext: () => new AudioContext() });
    const audio = new TutorAudio({
      createAudio: () => document.createElement('audio'),
      createContext: (options) => new AudioContext({ latencyHint: 'interactive', ...options }),
    });
    const meter = new LatencyMeter();
    const resources = { mic, audio, meter };
    const client = createTutorClient(app, {
      api,
      bridge: window.tassel,
      voice: resources,
      lang: () => latest.current.lang,
      micOptions: () => ({
        deviceId: useAudioPrefs.getState().inputId,
        processing: !latest.current.config.fakeMic,
      }),
      offerData: () => {
        const { sensitivity, pushToTalk } = useAudioPrefs.getState();
        return { scenario: app.fakeScript, sensitivity, ptt: pushToTalk };
      },
    });
    let held = false;
    let unbind = () => {};
    const talking = () => {
      const allowed = held && useStageStore.getState().micOn;
      if (useAudioPrefs.getState().pushToTalk) client.voice?.setTalking(allowed);
      mic.setGate(!useAudioPrefs.getState().pushToTalk || allowed);
    };
    const bind = () => {
      unbind();
      held = false;
      talking();
      unbind = useAudioPrefs.getState().pushToTalk
        ? bindPushToTalk(window, (next) => {
            held = next;
            talking();
          })
        : () => {};
    };
    const sinks = () => {
      const prefs = useAudioPrefs.getState();
      void audio
        .setSinks({
          primary: prefs.outputId,
          presenter: prefs.presenter ? (prefs.presenterOutputId ?? '') : null,
        })
        .catch(() => {});
    };
    mic.setEnabled(useStageStore.getState().micOn);
    void mic.setDevice(useAudioPrefs.getState().inputId);
    sinks();
    bind();
    const offStage = useStageStore.subscribe((state, previous) => {
      if (state.micOn !== previous.micOn) {
        mic.setEnabled(state.micOn);
        talking();
      }
    });
    const offPrefs = useAudioPrefs.subscribe((prefs, previous) => {
      if (prefs.inputId !== previous.inputId) void mic.setDevice(prefs.inputId);
      if (
        prefs.outputId !== previous.outputId ||
        prefs.presenter !== previous.presenter ||
        prefs.presenterOutputId !== previous.presenterOutputId
      )
        sinks();
      if (prefs.sensitivity !== previous.sensitivity)
        client.voice?.setSensitivity(prefs.sensitivity);
      if (prefs.pushToTalk !== previous.pushToTalk) {
        // Clear the client's remembered hold before the new offer, including PTT -> open mic.
        client.voice?.setTalking(false);
        bind();
        void client.voice?.reconnect();
      }
    });
    const offMic = mic.on(() => {
      useStageStore.getState().setMic(mic.status);
      useVoiceDebug.getState().setMicOpenedAt(mic.openedAt);
    });
    const offDuck = audio.onDuck((on, at) => {
      if (on) meter.markDuck(at);
    });
    const stopSampler = startLatencySampler({
      mic,
      audio,
      meter,
      onMetrics: (result) => {
        const metrics = { ...result, sensitivity: useAudioPrefs.getState().sensitivity };
        useVoiceDebug.getState().push({ kind: 'client-metrics', ...metrics });
        client.voice?.reportClientMetrics(metrics);
      },
    });
    setBinding({ resources, client });
    return () => {
      unbind();
      offPrefs();
      offStage();
      offMic();
      offDuck();
      stopSampler();
      void client.disconnect();
      mic.close();
      audio.dispose();
      useVoiceDebug.getState().setMicOpenedAt(null);
    };
  }, [sessionId, app, api]);
  return binding;
}
