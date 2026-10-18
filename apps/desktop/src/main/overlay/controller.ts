import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  screen,
  session,
} from 'electron';
import {
  type DisplayChoice,
  OVERLAY_INTENTS,
  type OverlayState,
  SCREEN_IPC,
  validNudge,
  validOverlayState,
  validPoints,
} from '../../shared/screen-bridge';
import { type DisplayMediaOptions, registerDisplayMedia } from '../paper/display-media';
import { isTrustedUrl, rendererUrl } from '../windows';
import { destroyAlive, hideAlive } from './lifetime';
import { clampToArea, hudPlacement, maskFor, positionKey } from './placement';

/** Where the bar was last left on each display, kept across sessions in the user's data dir. */
function positionStore(file: string) {
  let positions: Record<string, { x: number; y: number }> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = () => {
    if (positions) return positions;
    positions = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object')
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const p = value as { x?: unknown; y?: unknown };
          if (typeof p?.x === 'number' && typeof p?.y === 'number')
            positions[key] = { x: p.x, y: p.y };
        }
    } catch {
      /* A missing or unreadable file means the home position. */
    }
    return positions;
  };
  return {
    get: (key: string) => load()[key] ?? null,
    set(key: string, position: { x: number; y: number }) {
      load()[key] = position;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(positions));
        } catch {
          /* The position is still remembered for this run. */
        }
      }, 200);
    },
  };
}

/** Main renderer owns the session; these windows contain presentation only. */
export function registerScreenOverlay(
  owner: BrowserWindow,
  captureOptions: DisplayMediaOptions,
): void {
  const positions = positionStore(join(app.getPath('userData'), 'overlay-positions.json'));
  let selected: DisplayChoice | null = null;
  let grant: { id: string; expires: number } | null = null;
  let grantTimer: ReturnType<typeof setTimeout> | undefined;
  let hud: BrowserWindow | null = null;
  let ink: BrowserWindow | null = null;
  let last: OverlayState | null = null;
  let collapsed = false;
  let transitionVersion = 0;
  let transitioning = false;
  let hudHome: Electron.Rectangle | null = null;
  let ownerBounds: Electron.Rectangle | null = null;
  let ownerMinimum: [number, number] | null = null;
  let wasMaximized = false;
  const animateBounds = async (
    window: BrowserWindow,
    target: Electron.Rectangle,
    duration: number,
    version: number,
  ) => {
    const from = window.getBounds();
    const start = performance.now();
    while (!window.isDestroyed() && version === transitionVersion) {
      const t = duration ? Math.min(1, (performance.now() - start) / duration) : 1;
      const ease = t * t * (3 - 2 * t);
      window.setBounds({
        x: Math.round(from.x + (target.x - from.x) * ease),
        y: Math.round(from.y + (target.y - from.y) * ease),
        width: Math.round(from.width + (target.width - from.width) * ease),
        height: Math.round(from.height + (target.height - from.height) * ease),
      });
      if (t === 1) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
  };
  const restoreOwnerBounds = () => {
    if (owner.isDestroyed()) return;
    if (ownerBounds) owner.setBounds(ownerBounds);
    if (ownerMinimum) owner.setMinimumSize(...ownerMinimum);
    if (wasMaximized) owner.maximize();
    ownerBounds = null;
    ownerMinimum = null;
    wasMaximized = false;
  };
  let closing = false;
  let ready = new Map<number, () => void>();
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    event.senderFrame?.url &&
    isTrustedUrl(event.senderFrame.url) &&
    event.senderFrame === event.sender.mainFrame;
  const isOwner = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    !owner.isDestroyed() && trusted(event) && event.sender.id === owner.webContents.id;
  const isOverlay = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    trusted(event) &&
    ((hud && !hud.isDestroyed() && event.sender.id === hud.webContents.id) ||
      (ink && !ink.isDestroyed() && event.sender.id === ink.webContents.id));
  const restore = () => {
    ++transitionVersion;
    transitioning = false;
    collapsed = false;
    restoreOwnerBounds();
    hideAlive(hud);
    if (hudHome && hud && !hud.isDestroyed()) hud.setBounds(hudHome);
    hideAlive(ink);
    globalShortcut.unregister('Escape');
    if (!owner.isDestroyed()) {
      if (owner.isMinimized()) owner.restore();
      owner.show();
      owner.focus();
    }
  };
  const emit = (intent: string) => {
    if (!owner.isDestroyed()) owner.webContents.send(SCREEN_IPC.intent, intent);
  };
  const clearGrant = () => {
    grant = null;
    clearTimeout(grantTimer);
    registerDisplayMedia(session.defaultSession, captureOptions);
  };
  const close = () => {
    closing = true;
    restore();
    clearGrant();
    const oldHud = hud,
      oldInk = ink;
    hud = null;
    ink = null;
    destroyAlive(oldHud);
    destroyAlive(oldInk);
    last = null;
    selected = null;
    hudHome = null;
    for (const resolve of ready.values()) resolve();
    ready = new Map();
    closing = false;
  };
  const handle = (channel: string, handler: (arg: unknown) => unknown) =>
    ipcMain.handle(channel, (event, arg: unknown) => {
      if (!isOwner(event)) throw new Error('Untrusted screen owner');
      return handler(arg);
    });
  handle(SCREEN_IPC.displays, async () => {
    if (captureOptions.requireFake) {
      if (captureOptions.fakeDisplay !== 'self') throw new Error('Real capture refused');
      return [
        {
          id: 'self',
          name: 'Test display',
          bounds: screen.getDisplayMatching(owner.getBounds()).bounds,
        },
      ];
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.flatMap((source) => {
      const display = screen
        .getAllDisplays()
        .find((display) => String(display.id) === source.display_id);
      return display ? [{ id: source.id, name: source.name, bounds: display.bounds }] : [];
    });
  });
  handle(SCREEN_IPC.select, async (value) => {
    if (typeof value !== 'string' || value.length > 200) throw new Error('Invalid source');
    if (captureOptions.requireFake && (value !== 'self' || captureOptions.fakeDisplay !== 'self'))
      throw new Error('Real capture refused');
    const sources = captureOptions.requireFake
      ? []
      : await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
    const source = sources.find((source) => source.id === value);
    const display =
      value === 'self' && captureOptions.requireFake
        ? screen.getDisplayMatching(owner.getBounds())
        : screen.getAllDisplays().find((display) => String(display.id) === source?.display_id);
    if (!display) throw new Error('Display unavailable');
    selected = { id: value, name: source?.name ?? 'Test display', bounds: display.bounds };
    grant = { id: value, expires: Date.now() + 15_000 };
    clearTimeout(grantTimer);
    grantTimer = setTimeout(clearGrant, 15_000);
    registerDisplayMedia(session.defaultSession, {
      ...captureOptions,
      screenGrantActive: true,
      takeScreenGrant: async (request) => {
        const current = grant;
        grant = null;
        setTimeout(clearGrant, 0);
        if (
          !current ||
          Date.now() > current.expires ||
          request.frame?.top?.processId !== owner.webContents.mainFrame.processId ||
          request.frame?.routingId !== owner.webContents.mainFrame.routingId
        )
          return null;
        if (captureOptions.requireFake) return request.frame ? { video: request.frame } : null;
        const source = (await desktopCapturer.getSources({ types: ['screen'] })).find(
          (source) => source.id === current.id,
        );
        return source ? { video: source } : null;
      },
    });
    return selected;
  });
  async function createOverlay(kind: 'hud' | 'ink') {
    if (!selected) throw new Error('No selected display');
    const bounds = selected.bounds;
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const window = new BrowserWindow({
      ...(kind === 'hud' ? hudPlacement(area, positions.get(positionKey(display))) : bounds),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      ...(kind === 'ink' ? { thickFrame: false } : {}),
      hasShadow: false,
      skipTaskbar: true,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    window.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setContentProtection(true);
    if (kind === 'hud') {
      // Dragged (the bar is an app region) or nudged: it stays in the work area, and the
      // display remembers where it was left. Windows emits 'move' only, macOS 'moved' too.
      const settle = () => {
        if (transitioning || window.isDestroyed() || !selected) return;
        const b = window.getBounds(),
          d = screen.getDisplayMatching(selected.bounds);
        const { x, y } = clampToArea(b, d.workArea);
        if (x !== b.x || y !== b.y) window.setPosition(x, y);
        positions.set(positionKey(d), { x, y });
      };
      window.on('moved', settle);
      window.on('move', settle);
    }
    if (kind === 'ink') window.setIgnoreMouseEvents(!last?.draw, { forward: true });
    const prepared = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ready.delete(window.webContents.id);
        reject(new Error('Overlay did not initialize'));
      }, 10_000);
      ready.set(window.webContents.id, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    window.on('closed', () => {
      if (kind === 'hud' && hud === window) hud = null;
      if (kind === 'ink' && ink === window) ink = null;
      if (!closing && !owner.isDestroyed()) {
        restore();
        emit('stop');
      }
    });
    // Assign before load: ready/state calls are validated against these identities.
    if (kind === 'hud') hud = window;
    else ink = window;
    await window.loadURL(`${rendererUrl()}#overlay-${kind}`);
    await prepared;
    if (last) window.webContents.send(SCREEN_IPC.state, last);
    return window;
  }
  const prepare = async () => {
    if (!selected) throw new Error('No screen selected');
    if (!hud) await createOverlay('hud');
    if (!ink) await createOverlay('ink');
  };
  handle(SCREEN_IPC.prepare, prepare);
  handle(SCREEN_IPC.collapse, async (reducedMotion) => {
    if (!selected) throw new Error('No screen selected');
    const version = ++transitionVersion;
    transitioning = true;
    try {
      await prepare();
      if (!selected || owner.isDestroyed() || version !== transitionVersion || !hud) return;
      const destination = hud.getBounds();
      ownerBounds = owner.getBounds();
      const minimum = owner.getMinimumSize();
      ownerMinimum = [minimum[0] ?? 0, minimum[1] ?? 0];
      wasMaximized = owner.isMaximized();
      if (wasMaximized) owner.unmaximize();
      owner.setMinimumSize(0, 0);
      const small = {
        ...destination,
        x: Math.round(ownerBounds.x + (ownerBounds.width - destination.width) / 2),
        y: Math.round(ownerBounds.y + (ownerBounds.height - destination.height) / 2),
      };
      await animateBounds(owner, small, reducedMotion === true ? 0 : 160, version);
      if (version !== transitionVersion || !hud || hud.isDestroyed()) return;
      collapsed = true;
      hud.setBounds(small);
      ink?.showInactive();
      // Windows can constrain a hidden window to the work area on its first show.
      // Restore the whole display, including the taskbar strip, before positioning ink.
      if (ink && !ink.isDestroyed()) ink.setBounds(selected.bounds);
      hud.showInactive();
      owner.hide();
      // Keep the original owner geometry for the reverse transition.
      await animateBounds(hud, destination, reducedMotion === true ? 0 : 240, version);
      if (version === transitionVersion && hud && !hud.isDestroyed())
        hud.webContents.send(SCREEN_IPC.arrived);
    } catch (error) {
      close();
      throw error;
    } finally {
      if (version === transitionVersion) transitioning = false;
    }
  });
  handle(SCREEN_IPC.restore, async (reducedMotion) => {
    const version = ++transitionVersion;
    transitioning = true;
    if (!ownerBounds || !hud || hud.isDestroyed() || owner.isDestroyed()) {
      restore();
      return;
    }
    const full = ownerBounds;
    const current = hud.getBounds();
    hudHome = current;
    const small = {
      ...current,
      x: Math.round(full.x + (full.width - current.width) / 2),
      y: Math.round(full.y + (full.height - current.height) / 2),
    };
    hideAlive(ink);
    await animateBounds(hud, small, reducedMotion === true ? 0 : 200, version);
    if (version !== transitionVersion || owner.isDestroyed()) return;
    hideAlive(hud);
    owner.setBounds(small);
    owner.show();
    await animateBounds(owner, full, reducedMotion === true ? 0 : 160, version);
    if (version === transitionVersion) restore();
  });
  handle(SCREEN_IPC.close, close);
  handle(SCREEN_IPC.capture, () => {
    // Native content protection is configured once when windows are created. Never hide
    // visible ink to capture a frame: upload latency must not change its presentation.
    if (!selected || !hud?.isVisible()) return null;
    return maskFor(hud.getBounds(), selected.bounds);
  });
  ipcMain.on(SCREEN_IPC.move, (event, nudge: unknown) => {
    if (
      !isOverlay(event) ||
      event.sender.id !== hud?.webContents.id ||
      transitioning ||
      !selected ||
      !validNudge(nudge)
    )
      return;
    const b = hud.getBounds();
    const { x, y } = clampToArea(
      { ...b, x: b.x + nudge.dx, y: b.y + nudge.dy },
      screen.getDisplayMatching(selected.bounds).workArea,
    );
    hud.setPosition(x, y);
    hud.emit('moved');
  });
  ipcMain.on(SCREEN_IPC.ready, (event) => {
    if (isOverlay(event)) {
      ready.get(event.sender.id)?.();
      ready.delete(event.sender.id);
      if (last) event.sender.send(SCREEN_IPC.state, last);
    }
  });
  ipcMain.on(SCREEN_IPC.publish, (event, state: OverlayState) => {
    if (!isOwner(event) || !validOverlayState(state) || (last && state.sequence <= last.sequence))
      return;
    const wasDrawing = last?.draw;
    last = state;
    if (ink && !ink.isDestroyed() && wasDrawing !== state.draw)
      ink.setIgnoreMouseEvents(!state.draw, { forward: true });
    if (state.draw && collapsed) {
      if (!globalShortcut.isRegistered('Escape'))
        globalShortcut.register('Escape', () => emit('escape'));
      if (!wasDrawing) {
        if (ink && !ink.isDestroyed()) ink.focus();
        if (hud && !hud.isDestroyed()) hud.moveTop();
      }
    } else globalShortcut.unregister('Escape');
    for (const window of [hud, ink])
      if (window && !window.isDestroyed()) window.webContents.send(SCREEN_IPC.state, state);
  });
  ipcMain.on(SCREEN_IPC.intent, (event, intent: unknown) => {
    if (!isOverlay(event) || typeof intent !== 'string' || !OVERLAY_INTENTS.includes(intent))
      return;
    emit(intent);
  });
  ipcMain.on(SCREEN_IPC.stroke, (event, points: unknown) => {
    if (
      isOverlay(event) &&
      event.sender.id === ink?.webContents.id &&
      last?.draw &&
      validPoints(points)
    )
      owner.webContents.send(SCREEN_IPC.stroke, points);
  });
  const displayChanged = () => {
    if (selected) {
      restore();
      emit('stop');
    }
  };
  screen.on('display-removed', displayChanged);
  screen.on('display-metrics-changed', displayChanged);
  owner.on('closed', () => {
    close();
    screen.removeListener('display-removed', displayChanged);
    screen.removeListener('display-metrics-changed', displayChanged);
    for (const channel of [
      SCREEN_IPC.displays,
      SCREEN_IPC.select,
      SCREEN_IPC.prepare,
      SCREEN_IPC.collapse,
      SCREEN_IPC.restore,
      SCREEN_IPC.close,
      SCREEN_IPC.capture,
    ])
      ipcMain.removeHandler(channel);
    for (const channel of [
      SCREEN_IPC.ready,
      SCREEN_IPC.publish,
      SCREEN_IPC.intent,
      SCREEN_IPC.stroke,
      SCREEN_IPC.move,
    ])
      ipcMain.removeAllListeners(channel);
  });
}
