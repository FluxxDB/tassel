// The capture controller, mounted once per session screen (Task 13), so capture goes on while the
// board fills the stage. For a paper session it runs one paper source and one change detector per
// camera-on run, sends the detector's triggers through one uploader that lives as long as the
// screen, and keeps the paper store that the panel, its tag and the title strip's dot read.
//
// Real paths first (R39): `auto` is the Desk View helper on macOS, and a fake source runs only
// when the config names it. When the real source can't run, the status says why; nothing falls
// back to a clip.

import type { ApiClient, Source } from '@tassel/shared/api';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Platform } from '../../../shared/bridge';
import type { PaperBridge, PaperConfig } from '../../../shared/paper-bridge';
import { useStageStore } from '../features/session/stage-store';
import { useApi } from '../lib/api';
import type { DetectorTrigger } from './contracts';
import { createChangeDetector } from './detector/client';
import { parseParams } from './detector/params';
import { usePaperConfig } from './paper-config';
import { usePaperStore } from './paper-store';
import {
  choosePaperSource,
  createPaperSource,
  needsCameraAccess,
  shouldUpload,
} from './select-source';
import { createTurnFrameSender, grabJpeg, registerTurnFrameSender } from './turn-frame';
import {
  type PaperFeed,
  PaperSourceError,
  type PaperSourceErrorCode,
  type PaperSourceKind,
  type PaperStatus,
} from './types';
import { buildFrameMeta } from './upload/frame-meta';
import { createFrameUploader } from './upload/frame-uploader';
import { uploadFrame } from './upload/frames-api';
import { captureBurst, inkUploadAllowed, jpegSharpness } from './vision-gate';

export interface CaptureDeps {
  bridge: PaperBridge | null;
  platform: Platform;
  api: ApiClient;
  mediaDevices: MediaDevices;
  createSource: typeof createPaperSource;
  createChangeDetector: typeof createChangeDetector;
  createUploader: typeof createFrameUploader;
  now(): number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

/** A camera that sends no detector stats for this long is treated as lost (R29). */
const WATCHDOG_MS = 3_000;
const WATCHDOG_TICK_MS = 500;
/** The kinds the watchdog covers. A static screen may rightly send no frames. */
const WATCHED: ReadonlySet<PaperSourceKind> = new Set([
  'deskview-helper',
  'fake-clip',
  'window-capture',
]);

/** A failed start's status. `aborted` has none: its run was cleaned up. */
const STATUS_FOR: Record<Exclude<PaperSourceErrorCode, 'aborted'>, PaperStatus> = {
  denied: 'denied',
  unavailable: 'unavailable',
  cancelled: 'ended',
  error: 'error',
};

function defaultDeps(api: ApiClient): CaptureDeps {
  // P1's unit tests stub window.tassel with the platform alone: no paper bridge, so idle.
  const tassel = (globalThis as { tassel?: Partial<Window['tassel']> }).tassel;
  return {
    bridge: tassel?.paper ?? null,
    platform: tassel?.platform ?? 'darwin',
    api,
    mediaDevices: globalThis.navigator?.mediaDevices,
    createSource: createPaperSource,
    createChangeDetector,
    createUploader: createFrameUploader,
    now: () => Date.now(),
    // Looked up at call time, so a test's fake timers take effect.
    setInterval: ((fn: () => void, ms: number) => setInterval(fn, ms)) as typeof setInterval,
    clearInterval: ((id: ReturnType<typeof setInterval>) =>
      clearInterval(id)) as typeof clearInterval,
  };
}

type Uploader = ReturnType<typeof createFrameUploader>;

interface RunSettings {
  deps: CaptureDeps & { bridge: PaperBridge };
  sessionId: string;
  config: PaperConfig;
  cameraOn: boolean;
  override: PaperSourceKind | null;
  deviceId: string | null;
  uploader: { readonly current: Uploader | null };
}

/**
 * One camera-on (or camera-off) run. Its first act is to yield and check the signal, so React
 * StrictMode's mount, cleanup, mount starts the source once and never opens two pickers. cancel()
 * aborts it and releases everything it holds; a feed that resolves after that is stopped at once.
 */
function startRun(run: RunSettings): { cancel(): void } {
  const { deps, config } = run;
  const controller = new AbortController();
  const { signal } = controller;
  const store = usePaperStore.getState;
  let feed: PaperFeed | null = null;
  let detector: { stop(): void } | null = null;
  let offEnd: (() => void) | null = null;
  let offTurn: (() => void) | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let lastStatsAt = 0;
  let lastInkAt = -Infinity;
  let deferredInk: DetectorTrigger | null = null;
  let inkTimer: ReturnType<typeof setInterval> | null = null;
  const clearInkTimer = () => {
    if (inkTimer !== null) deps.clearInterval(inkTimer);
    inkTimer = null;
  };

  /** Stops this run's watchdog, detector and feed. */
  const halt = () => {
    clearInkTimer();
    deferredInk = null;
    if (watchdog !== null) deps.clearInterval(watchdog);
    watchdog = null;
    detector?.stop();
    detector = null;
    offTurn?.();
    offTurn = null;
    offEnd?.();
    offEnd = null;
    feed?.stop();
    feed = null;
  };

  /** The feed stopped by itself (or the watchdog stopped it): say why, and let go of it all. */
  const end = (status: PaperStatus) => {
    if (signal.aborted) return;
    controller.abort();
    halt();
    store().setFeed(null);
    store().setStatus(status);
  };

  /**
   * Arms once OpenCV has settled in the worker: loading and starting it can hold the worker's
   * thread for seconds, which would make a healthy feed look lost (re-review N4).
   */
  const armWatchdog = (kind: PaperSourceKind) => {
    if (!WATCHED.has(kind) || watchdog !== null || signal.aborted) return;
    lastStatsAt = deps.now();
    watchdog = deps.setInterval(() => {
      if (deps.now() - lastStatsAt >= WATCHDOG_MS) end('lost');
    }, WATCHDOG_TICK_MS);
  };

  const go = async () => {
    await Promise.resolve();
    if (signal.aborted) return;
    const retried = store().retrying;
    store().setStats(null);
    store().setOpenCv(null);

    if (!run.cameraOn) {
      store().setFeed(null);
      store().setStatus('off');
      // The source's own stop already released it; this covers a start still in flight.
      void deps.bridge.stopHelper();
      return;
    }

    const kind = run.override ?? choosePaperSource(config.source, deps.platform);
    // The tag follows the kind from the start, before any feed exists.
    usePaperStore.setState({ kind });
    store().setStatus('starting');
    if (kind === null) {
      store().setStatus('unavailable');
      return;
    }

    // A retry skips Electron's answer, which can stay stale until the app restarts: the fresh
    // helper's welcome decides instead.
    if (needsCameraAccess(kind, config) && !retried) {
      const access = await deps.bridge.cameraAccess();
      if (signal.aborted) return;
      if (access === 'denied' || access === 'restricted') {
        store().setStatus('denied');
        return;
      }
      if (access === 'not-determined') {
        const granted = await deps.bridge.requestCameraAccess();
        if (signal.aborted) return;
        if (!granted) {
          store().setStatus('denied');
          return;
        }
      }
    }

    let started: PaperFeed;
    try {
      const source = deps.createSource(kind, {
        bridge: deps.bridge,
        config,
        mediaDevices: deps.mediaDevices,
      });
      started = await source.start({ deviceId: run.deviceId, signal });
    } catch (error) {
      if (signal.aborted) return;
      const code = error instanceof PaperSourceError ? error.code : 'error';
      if (code === 'aborted') return;
      if (!(error instanceof PaperSourceError)) console.warn('[paper] The source failed:', error);
      store().setStatus(STATUS_FOR[code]);
      return;
    }
    if (signal.aborted) {
      started.stop();
      return;
    }

    feed = started;
    store().setFeed(started);
    store().setStatus('live');
    offEnd = started.onEnd((reason) => end(reason));

    const upload = shouldUpload(kind);
    // Each student turn asks for her paper as it is now (the server's paper-frame request).
    // Screens never upload on their own (R7), so they don't answer it either.
    // A feed's stream may be a stand-in with no tracks (tests); then there's nothing to grab.
    const track = started.stream.getVideoTracks?.()[0];
    if (upload && track) {
      offTurn = registerTurnFrameSender(
        createTurnFrameSender({
          kind,
          grab: () =>
            captureBurst(() => {
              if (signal.aborted) throw new Error('Capture stopped');
              return grabJpeg(track);
            }, jpegSharpness),
          upload: (parts) =>
            signal.aborted ? Promise.resolve() : uploadFrame(deps.api, run.sessionId, parts),
        }),
      );
    }
    const sendTrigger = (trigger: DetectorTrigger) => {
      if (signal.aborted || !upload || useStageStore.getState().mode === 'board') return;
      if (trigger.reason === 'ink') lastInkAt = deps.now();
      run.uploader.current?.enqueue({
        full: trigger.full,
        crop: trigger.crop,
        meta: buildFrameMeta(trigger, kind),
      });
    };
    detector = deps.createChangeDetector(started.stream, {
      params: parseParams(config.params),
      contentRect: started.contentRect,
      onStats: (stats) => {
        if (signal.aborted) return;
        lastStatsAt = deps.now();
        store().setStats(stats);
      },
      onTrigger: (trigger) => {
        // Screen triggers never upload on their own (R7). The uploader refuses them too.
        if (signal.aborted || !upload || useStageStore.getState().mode === 'board') return;
        if (trigger.reason === 'ink') {
          const total = trigger.mask ? trigger.mask.cols * trigger.mask.rows : 0;
          if (!inkUploadAllowed(deps.now(), lastInkAt, trigger.changedCells, total)) {
            deferredInk = trigger;
            if (inkTimer === null)
              inkTimer = deps.setInterval(
                () => {
                  clearInkTimer();
                  const latest = deferredInk;
                  deferredInk = null;
                  if (latest) sendTrigger(latest);
                },
                Math.max(1, 10_000 - (deps.now() - lastInkAt)),
              );
            return;
          }
        }
        // A newer full frame supersedes any deferred ink, including a large change.
        clearInkTimer();
        deferredInk = null;
        sendTrigger(trigger);
      },
      onError: (message) => console.warn(`[paper] ${message}`),
      onReady: (opencv) => {
        if (signal.aborted) return;
        store().setOpenCv(opencv);
        armWatchdog(kind);
      },
    });
  };

  void go().catch((error: unknown) => {
    // Nothing above should throw, but a run must never take the session screen down.
    console.warn('[paper] The capture run failed:', error);
    if (!signal.aborted) end('error');
  });

  return {
    cancel() {
      controller.abort();
      halt();
    },
  };
}

/**
 * Runs paper capture for a session screen. It does nothing until the session is known to be a
 * paper session (`sessionSource` is null while it loads), and stays idle without the paper bridge.
 */
export function usePaperCapture(args: {
  sessionId: string;
  sessionSource: Source | null;
  cameraOn: boolean;
  deps?: Partial<CaptureDeps>;
}): void {
  const { sessionId, sessionSource, cameraOn } = args;
  const api = useApi();
  const config = usePaperConfig();
  const override = usePaperStore((state) => state.override);
  const deviceId = usePaperStore((state) => state.deviceId);
  const restartNonce = usePaperStore((state) => state.restartNonce);
  // Read through a ref, so a caller's fresh deps object each render restarts nothing.
  const deps = useRef<CaptureDeps>(null as unknown as CaptureDeps);
  deps.current = { ...defaultDeps(api), ...args.deps };
  const active = sessionSource === 'paper' && deps.current.bridge !== null;
  const uploader = useRef<Uploader | null>(null);

  // The screen's store: reset when the screen goes.
  useEffect(() => () => usePaperStore.getState().reset(), []);

  // One uploader for the life of the session screen: turning the camera off never drops a frame.
  useEffect(() => {
    if (!active) return;
    const { createUploader, api: client } = deps.current;
    const created = createUploader({
      upload: (parts) => uploadFrame(client, sessionId, parts),
      onStats: (stats) => usePaperStore.getState().setUploads(stats),
    });
    uploader.current = created;
    return () => {
      created.stop();
      if (uploader.current === created) uploader.current = null;
    };
  }, [active, sessionId]);

  // One run per camera toggle, source or device choice, and Retry (restartNonce).
  // biome-ignore lint/correctness/useExhaustiveDependencies: restartNonce is the restart signal itself.
  useEffect(() => {
    if (!active) return;
    const run = startRun({
      deps: deps.current as RunSettings['deps'],
      sessionId,
      config,
      cameraOn,
      override,
      deviceId,
      uploader,
    });
    return () => run.cancel();
  }, [active, sessionId, config, cameraOn, override, deviceId, restartNonce]);
}

/** The paper panel's tag and region name, by the running source's kind. */
export function usePaperTag(): string {
  const { t } = useTranslation();
  const kind = usePaperStore((state) => state.kind);
  if (kind === 'window-capture') return t('paper.tag.window');
  if (kind === 'screen') return t('session.placeholder.screen.tag');
  // The helper, the fake clip (which stands in for Desk View), and no kind yet.
  return t('session.placeholder.paper.tag');
}

/** Whether a paper source is delivering frames: the title strip's red dot (R29). */
export function usePaperLive(): boolean {
  return usePaperStore((state) => state.status === 'live');
}
