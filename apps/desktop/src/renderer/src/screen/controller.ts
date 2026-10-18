import { useEffect } from 'react';
import type { AppConfig } from '../../../shared/bridge';
import type { OverlayIntent, ScreenIdentity, ScreenMark } from '../../../shared/screen-bridge';
import { validPoints } from '../../../shared/screen-bridge';
import { useAvatar } from '../avatar/store';
import { beatPlayer } from '../board/beats/player';
import { useStageStore } from '../features/session/stage-store';
import { useLiveVoice } from '../features/voice/live-voice';
import { viewportChanged } from './geometry';
import { ScreenSession } from './session';
import { bindScreenActions, useScreen } from './store';

let captureTurn: (() => Promise<void>) | null = null;
let receiveMarks: ((value: unknown) => void) | null = null;
export async function requestScreenTurn(): Promise<boolean> {
  if (!captureTurn || !useScreen.getState().selected) return false;
  await captureTurn();
  return true;
}
export function acceptScreenMarks(value: unknown) {
  receiveMarks?.(value);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Mounted once beside VoiceSession. Hiding the window never unmounts this controller. */
export function useScreenController(sessionId: string, app?: AppConfig) {
  useEffect(() => {
    const bridge = window.tassel?.screen;
    if (!bridge || !app) return;
    let disposed = false,
      operation = 0,
      sequence = 0,
      busy = false,
      uploading = false,
      controlQueue = Promise.resolve();
    let video: HTMLVideoElement | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let sample: Uint8Array | null = null;
    let previousMarks: ScreenMark[] = [];
    let cameraWasOn = false;
    let lastFrameId = '';
    let resetPending = false;
    let presentationVersion = 0;
    let preparing = false;
    let uploadAbort: AbortController | null = null;
    const get = () => useScreen.getState();
    const set = (state: Partial<ReturnType<typeof get>>) => {
      if (!disposed) useScreen.setState(state);
    };
    const fake = app.tutorMode === 'fake';
    async function api(path: string, init: RequestInit) {
      init = {
        ...init,
        signal: AbortSignal.any([AbortSignal.timeout(8000), ...(init.signal ? [init.signal] : [])]),
      };
      const token = await window.tassel.getToken();
      let response = await fetch(
        `${app?.serverUrl.replace(/\/$/u, '')}/v1/sessions/${sessionId}/screen/${path}`,
        { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } },
      );
      if (response.status === 401) {
        const fresh = await window.tassel.refreshToken();
        response = await fetch(
          `${app?.serverUrl.replace(/\/$/u, '')}/v1/sessions/${sessionId}/screen/${path}`,
          { ...init, headers: { ...init.headers, Authorization: `Bearer ${fresh}` } },
        );
      }
      if (!response.ok) throw new Error(`Screen request failed (${response.status})`);
      return response;
    }
    const session = new ScreenSession(async (identity) => {
      lastFrameId = '';
      uploadAbort?.abort();
      const client = useLiveVoice.getState().client;
      client?.interrupt?.(identity.epoch);
      beatPlayer.reset();
      useStageStore.setState((state) => ({
        tutorState: 'listening',
        caption:
          state.caption.current?.speaker === 'tutor'
            ? { previous: state.caption.previous }
            : state.caption,
      }));
      set({ marks: [], draw: false });
      const active = get().status !== 'paused' && get().status !== 'off';
      const source = get().status === 'off' ? 'paper' : identity.source;
      const task = async () => {
        if (fake) return;
        const response = await api('control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            epoch: identity.epoch,
            active,
          }),
        });
        const ack = (await response.json()) as { epoch: number };
        if (ack.epoch !== identity.epoch && session.identity().epoch === identity.epoch)
          throw new Error('Screen epoch mismatch');
      };
      const result = controlQueue.catch(() => {}).then(task);
      controlQueue = result;
      await result;
    });
    const publish = () => {
      if (disposed) return;
      const state = get(),
        stage = useStageStore.getState();
      if (!state.selected) return;
      bridge.publish({
        sequence: ++sequence,
        status:
          state.status === 'paused'
            ? 'paused'
            : state.status === 'error'
              ? 'error'
              : state.status === 'resetting'
                ? 'resetting'
                : 'sharing',
        caption: stage.captionsOn ? (stage.caption.current?.text ?? '') : '',
        tutorState: stage.tutorState,
        micOn: stage.micOn,
        draw: state.draw,
        marks: state.marks,
        avatar: { ...useAvatar.getState().profile },
        notice: state.notice,
        boardHint: stage.requested !== 'paper',
      });
    };
    const fail = () => {
      set({ notice: 'failed', status: 'error', draw: false });
    };
    async function reset() {
      if (!get().selected) return;
      const prior = get().status;
      set({
        status: prior === 'paused' ? 'paused' : 'resetting',
        marks: [],
        draw: false,
        notice: 'reset',
      });
      resetPending = true;
      const epoch = session.identity().epoch + 1;
      try {
        await session.reset();
        if (session.identity().epoch !== epoch) return;
        if (!disposed && get().status === 'resetting')
          set({ status: 'sharing', notice: 'resetDone' });
        resetPending = false;
      } catch {
        if (session.identity().epoch === epoch) fail();
      }
    }
    async function stop() {
      const visit = ++operation;
      ++presentationVersion;
      clearInterval(timer);
      const stream = get().stream;
      set({
        status: 'off',
        draw: false,
        marks: [],
        stream: null,
        selected: null,
        presentation: 'expanded',
      });
      if (cameraWasOn) {
        useStageStore.setState({ cameraOn: true });
        cameraWasOn = false;
      }
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      video?.pause();
      if (video) video.srcObject = null;
      video = null;
      sample = null;
      const closed = bridge.close().catch(() => {});
      if (session.identity().source) {
        try {
          await session.reset();
        } catch {
          /* Local stop is unconditional; server's fresh-frame requirement prevents reuse. */
        }
      }
      if (visit === operation) set({ notice: '' });
      await closed;
    }
    async function collapse() {
      if (preparing || !get().selected || get().presentation !== 'expanded') return;
      preparing = true;
      const version = ++presentationVersion;
      try {
        // Prepare offscreen first: do not leave an empty shrinking window while loading React.
        await bridge.prepare?.();
        if (disposed || version !== presentationVersion || !get().selected) return;
        set({ presentation: 'collapsing' });
        await sleep(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
        if (disposed || version !== presentationVersion || !get().selected) return;
        await bridge.collapse();
        if (version === presentationVersion) set({ presentation: 'overlay' });
      } catch {
        if (version === presentationVersion) set({ presentation: 'expanded', notice: 'failed' });
      } finally {
        preparing = false;
      }
    }
    async function restore() {
      const version = ++presentationVersion;
      set({ presentation: 'restoring' });
      await bridge.restore();
      await sleep(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
      if (version === presentationVersion) set({ presentation: 'expanded' });
    }
    function canvasFrame(width: number) {
      if (!video?.videoWidth || video.readyState < 2) return null;
      const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(video, 0, 0, width, height);
      return { canvas, context, width, height };
    }
    async function capture() {
      if (disposed || uploading || get().status !== 'sharing' || !video) return;
      uploading = true;
      const identity = session.identity();
      try {
        await controlQueue;
        const mask = await bridge.capture(true);
        // Let capture deliver a frame after native ink has been hidden.
        await sleep(160);
        if (disposed || !session.accepts(identity) || get().status !== 'sharing') return;
        const frame = canvasFrame(Math.min(1920, video.videoWidth));
        if (!frame) return;
        if (mask) {
          frame.context.fillStyle = '#fff9f3';
          frame.context.fillRect(
            Math.floor(mask.x * frame.width) - 4,
            Math.floor(mask.y * frame.height) - 4,
            Math.ceil(mask.width * frame.width) + 8,
            Math.ceil(mask.height * frame.height) + 8,
          );
        }
        const jpeg = await new Promise<Blob | null>((resolve) =>
          frame.canvas.toBlob(resolve, 'image/jpeg', 0.88),
        );
        if (!jpeg || disposed || !session.accepts(identity) || get().status !== 'sharing') return;
        const id = crypto.randomUUID();
        lastFrameId = id;
        if (!fake) {
          uploadAbort = new AbortController();
          await api(
            `frame?source=${encodeURIComponent(identity.source)}&epoch=${identity.epoch}&revision=${identity.revision}&frame_id=${id}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'image/jpeg' },
              body: jpeg,
              signal: uploadAbort.signal,
            },
          );
        }
      } catch {
        if (!disposed && session.accepts(identity)) set({ notice: 'failed' });
      } finally {
        uploading = false;
        await bridge.capture(false).catch(() => {});
      }
    }
    async function watch() {
      if (disposed || busy || uploading || get().status !== 'sharing') return;
      busy = true;
      try {
        const frame = canvasFrame(160);
        if (!frame) return;
        const mask = await bridge.capture(false);
        if (mask)
          frame.context.clearRect(
            mask.x * frame.width,
            mask.y * frame.height,
            mask.width * frame.width,
            mask.height * frame.height,
          );
        // Exclude our annotation bounding regions from comparison in both frames.
        const rgba = frame.context.getImageData(0, 0, frame.width, frame.height).data;
        const current = new Uint8Array(frame.width * frame.height);
        for (let i = 0; i < current.length; i++)
          current[i] = Math.round(
            ((rgba[i * 4] ?? 0) + (rgba[i * 4 + 1] ?? 0) + (rgba[i * 4 + 2] ?? 0)) / 3,
          );
        const currentMarks = get().marks;
        for (const mark of [...previousMarks, ...currentMarks]) {
          const xs = mark.points.map((p) => p.x),
            ys = mark.points.map((p) => p.y);
          const x0 = Math.max(0, Math.floor(Math.min(...xs) * frame.width) - 3),
            x1 = Math.min(frame.width, Math.ceil(Math.max(...xs) * frame.width) + 3),
            y0 = Math.max(0, Math.floor(Math.min(...ys) * frame.height) - 3),
            y1 = Math.min(frame.height, Math.ceil(Math.max(...ys) * frame.height) + 3);
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              current[y * frame.width + x] = 0;
              if (sample) sample[y * frame.width + x] = 0;
            }
        }
        if (sample && viewportChanged(sample, current)) {
          session.invalidate();
          lastFrameId = '';
          set({ marks: [], draw: false });
          // Invalidate server work as well as local geometry; stale speech must not continue.
          void reset().then(() => {
            if (!disposed) set({ notice: '' });
          });
        }
        sample = current;
        previousMarks = currentMarks;
      } finally {
        busy = false;
      }
    }
    async function start(id: string) {
      const visit = ++operation;
      set({ notice: '', status: 'selecting' });
      let stream: MediaStream | null = null;
      try {
        const selected = await bridge.select(id);
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 10, max: 15 } },
          audio: false,
        });
        if (disposed || visit !== operation) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        video = document.createElement('video');
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        if (disposed || visit !== operation) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        cameraWasOn = useStageStore.getState().cameraOn;
        useStageStore.setState({ cameraOn: false });
        session.start(`${selected.id}:${crypto.randomUUID()}`);
        set({ selected, stream, status: 'sharing', marks: [], draw: false });
        stream.getVideoTracks()[0]?.addEventListener('ended', () => void stop(), { once: true });
        await reset();
        timer = setInterval(() => void watch(), 300);
        await collapse();
      } catch {
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
        if (!disposed) set({ status: 'error', notice: 'failed', presentation: 'expanded' });
      }
    }
    const actions = {
      choose: async () => {
        try {
          set({ status: 'selecting', displays: await bridge.displays(), notice: '' });
        } catch {
          fail();
        }
      },
      start,
      reset,
      stop,
      collapse,
      restore,
      pause: async () => {
        const paused = get().status === 'paused';
        set({ status: paused ? 'sharing' : 'paused', notice: '' });
        await reset();
      },
      look: async () => {
        if (get().status !== 'sharing') return;
        await capture();
        useLiveVoice.getState().client?.sendText('Please look at my currently shared screen.');
      },
      stroke: (points: import('../../../shared/screen-bridge').ScreenPoint[]) => {
        session.add(
          { id: crypto.randomUUID(), author: 'student', kind: 'freehand', points },
          session.identity(),
        );
        set({ marks: session.marks });
      },
      draw: () => set({ draw: !get().draw }),
      undo: () => {
        const index = session.marks.findLastIndex((mark) => mark.author === 'student');
        if (index >= 0) {
          session.marks = session.marks.filter((_, i) => i !== index);
          set({ marks: session.marks });
        }
      },
    };
    const intent = (intent: OverlayIntent) => {
      if (intent === 'mic') useStageStore.getState().toggleMic();
      else if (intent === 'board') {
        useStageStore.getState().pin('board');
        void restore();
      } else if (intent === 'escape') set({ draw: false });
      else if (intent === 'draw') actions.draw();
      else if (intent === 'undo') actions.undo();
      else void actions[intent]().catch(fail);
    };
    const offActions = bindScreenActions(actions);
    const offIntent = bridge.onIntent(intent),
      offStroke = bridge.onStroke(actions.stroke);
    const offScreen = useScreen.subscribe(publish),
      offStage = useStageStore.subscribe(publish),
      offAvatar = useAvatar.subscribe(publish);
    captureTurn = async () => {
      if (get().selected) await capture();
    };
    const turn = captureTurn;
    receiveMarks = (value) => {
      if (!value || typeof value !== 'object') return;
      const message = value as ScreenIdentity & { frame_id?: string; marks?: ScreenMark[] };
      if (
        get().status !== 'sharing' ||
        !session.accepts(message) ||
        message.frame_id !== lastFrameId ||
        !Array.isArray(message.marks)
      )
        return;
      for (const mark of message.marks)
        if (
          validPoints(mark.points) &&
          ['circle', 'pointer', 'arrow', 'underline'].includes(mark.kind)
        )
          session.add({ ...mark, author: 'tutor' }, message);
      set({ marks: session.marks });
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key === 'Backspace' &&
        get().selected
      ) {
        event.preventDefault();
        void reset();
      }
    };
    window.addEventListener('keydown', onKey);
    // Reconcile reset on reconnection; never resume old output while reconciliation is pending.
    const offClient = useLiveVoice.subscribe((state, previous) => {
      if (state.client && state.client !== previous.client && get().selected)
        state.client.interrupt?.(session.identity().epoch);
    });
    const offVoice = useStageStore.subscribe((state, previous) => {
      if (
        state.connection === 'connected' &&
        previous.connection !== 'connected' &&
        get().selected &&
        resetPending
      )
        void reset();
    });
    return () => {
      disposed = true;
      uploadAbort?.abort();
      ++operation;
      clearInterval(timer);
      offIntent();
      offStroke();
      offScreen();
      offStage();
      offAvatar();
      offActions();
      offVoice();
      offClient();
      window.removeEventListener('keydown', onKey);
      if (captureTurn === turn) {
        captureTurn = null;
        receiveMarks = null;
      }
      get()
        .stream?.getTracks()
        .forEach((track) => {
          track.stop();
        });
      if (video) video.srcObject = null;
      const identity = session.identity();
      if (identity.source && !fake)
        void api('control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: identity.source,
            epoch: identity.epoch + 1,
            active: false,
          }),
          keepalive: true,
        }).catch(() => {});
      useScreen.setState({
        status: 'off',
        selected: null,
        stream: null,
        marks: [],
        draw: false,
        notice: '',
        presentation: 'expanded',
        displays: [],
      });
      void bridge.close().catch(() => {});
    };
  }, [sessionId, app]);
}
