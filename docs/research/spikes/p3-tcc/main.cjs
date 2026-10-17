// The P3 spike's Electron main (Task 1). Spike code only, not product code; run.mjs drives it.
//
//   Electron main.cjs --mode <mode> --out <file> [--probe <path>] [--clip <mjpeg>] [--frames <n>]
//                     [--present-setup]
//
// It writes its pid as the first line of --out, then appends one JSON line per result. Every mode
// first records systemPreferences.getMediaAccessStatus for the camera, microphone and screen (a
// read: it never asks), and TASSEL_SPIKE from its environment (check E).
//
// Modes:
//   status        spawn `probe --status` (never asks for access) and relay its line (A, E)
//   capture       spawn `probe --capture <n>` (H), or `probe --present-setup` with --present-setup (D)
//   fake-camera   Chromium's fake camera plays --clip. A hidden window reads frames through
//                 MediaStreamTrackProcessor, with its readable transferred to a worker (F, P)
//   self-capture  a visible 320×240 window captures itself: the display-media handler answers
//                 { video: request.frame } (T)
//   picker        a window with a Share button; getDisplayMedia through the system picker (S)
//   cdp           a visible window titled p3-spike, left open for a CDP client (C)
//
// Nothing here writes a frame anywhere: pages count frames and keep only their sizes and timing.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, protocol, session, systemPreferences } = require('electron');

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

const mode = option('--mode');
const out = option('--out');
const probe = option('--probe');
const clip = option('--clip') && path.resolve(option('--clip'));
const frames = Number(option('--frames') ?? 30);
const presentSetup = process.argv.includes('--present-setup');

if (!out) {
  console.error('[p3-spike] --out <file> is required');
  process.exit(64);
}
fs.writeFileSync(out, `${process.pid}\n`);
const record = (line) => fs.appendFileSync(out, `${JSON.stringify(line)}\n`);

// Every mode ends by itself: a stuck check can't leave an app running.
const LIMIT_MS = {
  status: 30_000,
  capture: 180_000,
  'fake-camera': 45_000,
  'self-capture': 45_000,
  picker: 300_000,
  cdp: 60_000,
};
if (!(mode in LIMIT_MS)) {
  record({ check: 'error', error: `unknown --mode ${mode}` });
  process.exit(64);
}
setTimeout(() => {
  record({ check: 'limit', mode, ms: LIMIT_MS[mode] });
  app.exit(3);
}, LIMIT_MS[mode]);

// A throwaway profile, so the spike leaves nothing in ~/Library/Application Support/Electron.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tassel-p3-spike-'));
app.setPath('userData', userData);
app.on('will-quit', () => record({ check: 'quit', mode }));
process.on('exit', () => {
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {}
});

// Mirrors app://tassel: a standard, secure origin, so getUserMedia and getDisplayMedia exist.
protocol.registerSchemesAsPrivileged([
  { scheme: 'spike', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (mode === 'fake-camera') {
  // Without both switches getUserMedia would reach a real camera, so no clip means no call at all.
  if (!clip || !fs.existsSync(clip)) {
    record({ check: 'fake-camera', error: 'missing-clip', clip });
    process.exit(65);
  }
  // Before ready. The file switch is read only inside the fake-device branch, so it needs both.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-video-capture', clip);
}

const SHARED = String.raw`
const round1 = (n) => Math.round(n * 10) / 10;
function describe(track) {
  const s = track.getSettings();
  return { label: track.label, readyState: track.readyState, width: s.width, height: s.height,
    frameRate: s.frameRate === undefined ? null : round1(s.frameRate), displaySurface: s.displaySurface ?? null };
}
// Counts frames in this window through MediaStreamTrackProcessor; keeps only sizes and timing.
// inspect(frame), when given, describes the first frame of each size in result.bySize.
async function countFrames(track, wanted, ms, inspect) {
  const result = { frames: 0, sizes: [] };
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms));
  let first = null;
  let last = null;
  while (result.frames < wanted) {
    const next = await Promise.race([reader.read(), timeout]);
    if (next.timedOut) { result.timedOut = true; break; }
    if (next.done) break;
    const frame = next.value;
    result.frames += 1;
    const size = frame.displayWidth + 'x' + frame.displayHeight;
    if (!result.sizes.includes(size)) {
      result.sizes.push(size);
      if (inspect) {
        result.bySize ??= {};
        result.bySize[size] = { atFrame: result.frames, ...(await inspect(frame)) };
      }
    }
    if (result.frames === 1) {
      const v = frame.visibleRect;
      result.first = { coded: frame.codedWidth + 'x' + frame.codedHeight,
        visibleRect: v && [v.x, v.y, v.width, v.height] };
    }
    first ??= frame.timestamp;
    last = frame.timestamp;
    frame.close();
  }
  reader.cancel().catch(() => {});
  if (result.frames > 1 && last > first) result.fps = round1(((result.frames - 1) * 1e6) / (last - first));
  return result;
}
const failure = (error) => (error && error.name ? error.name + ': ' + error.message : String(error));
`;

const WORKER = String.raw`
// Check P: a MediaStreamTrackProcessor's readable, transferred here from the window.
onmessage = async ({ data }) => {
  const result = { frames: 0, sizes: [], videoFrames: true, processorInWorker: typeof MediaStreamTrackProcessor === 'function' };
  let first = null;
  let last = null;
  try {
    const reader = data.readable.getReader();
    while (result.frames < data.frames) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      result.frames += 1;
      if (!(frame instanceof VideoFrame)) result.videoFrames = false;
      const size = frame.displayWidth + 'x' + frame.displayHeight;
      if (!result.sizes.includes(size)) result.sizes.push(size);
      first ??= frame.timestamp;
      last = frame.timestamp;
      frame.close();
    }
    reader.cancel().catch(() => {});
    if (result.frames > 1 && last > first) {
      result.fps = Math.round(((result.frames - 1) * 1e7) / (last - first)) / 10;
    }
  } catch (error) {
    result.error = error.name + ': ' + error.message;
  }
  postMessage(result);
};
`;

const CAMERA = String.raw`
async function runFakeCamera(wanted) {
  const result = { processorInWindow: typeof MediaStreamTrackProcessor === 'function' };
  let stream;
  try {
    // Video only, so no microphone prompt can ever reach the agent.
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const [track] = stream.getVideoTracks();
    result.track = describe(track);
    const processor = new MediaStreamTrackProcessor({ track });
    const worker = new Worker('worker.js');
    const answer = new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error('worker: ' + event.message));
    });
    worker.postMessage({ readable: processor.readable, frames: wanted }, [processor.readable]);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('no answer from the worker in 15 s')), 15000));
    result.worker = await Promise.race([answer, timeout]);
    worker.terminate();
  } catch (error) {
    result.error = failure(error);
  } finally {
    for (const track of stream ? stream.getTracks() : []) track.stop();
  }
  return result;
}
`;

const SELF = String.raw`
// This page is synthetic, so check T may read its frames' pixels (a camera frame's, never): is the
// frame letterboxed, and how many frame pixels does one CSS pixel of the 40 px bar span?
async function measure(frame) {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  const context = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  context.drawImage(frame, 0, 0, w, h);
  const { data } = context.getImageData(0, 0, w, h);
  const rgb = (x, y) => data.subarray((y * w + x) * 4, (y * w + x) * 4 + 3);
  const isBlack = ([r, g, b]) => r < 24 && g < 24 && b < 24;
  const isPage = ([r, g, b]) => Math.abs(r - 244) < 12 && Math.abs(g - 242) < 12 && Math.abs(b - 236) < 12;
  let edge = 0;
  let black = 0;
  let page = 0;
  const visit = (x, y) => { edge += 1; const p = rgb(x, y); if (isBlack(p)) black += 1; if (isPage(p)) page += 1; };
  for (let x = 0; x < w; x += 1) { visit(x, 0); visit(x, h - 1); }
  for (let y = 1; y < h - 1; y += 1) { visit(0, y); visit(w - 1, y); }
  let bar = 0;
  for (let x = 0; x < w; x += 1) { const [r, g, b] = rgb(x, h >> 1); if (r < 90 && g < 90 && b < 90) bar += 1; }
  return { blackEdge: Math.round((black / edge) * 1000) / 1000, pageEdge: Math.round((page / edge) * 1000) / 1000,
    barPx: bar, framePxPerCssPx: round1(bar / 40) };
}
async function runSelfCapture(wanted) {
  const result = { window: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } };
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const [track] = stream.getVideoTracks();
    result.track = describe(track);
    Object.assign(result, await countFrames(track, wanted, 8000, measure));
  } catch (error) {
    result.error = failure(error);
  } finally {
    for (const track of stream ? stream.getTracks() : []) track.stop();
  }
  return result;
}
// Tab capture sends frames only when the page changes, so the page keeps changing.
const counter = document.getElementById('tick');
let ticks = 0;
(function tick() { counter.textContent = String(ticks++); requestAnimationFrame(tick); })();
`;

const PICKER = String.raw`
function waitForShare(wanted) {
  return new Promise((resolve) => {
    document.getElementById('share').addEventListener('click', async () => {
      const result = {};
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const [track] = stream.getVideoTracks();
        result.track = describe(track);
        Object.assign(result, await countFrames(track, wanted, 10000));
      } catch (error) {
        result.error = failure(error);
      } finally {
        for (const track of stream ? stream.getTracks() : []) track.stop();
      }
      resolve(result);
    }, { once: true });
  });
}
`;

const page = (title, body, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body { margin: 0; font: 13px system-ui; background: #f4f2ec; color: #222; }
#bar { width: 40px; height: 100%; background: #333; position: absolute; top: 0; animation: slide 1s linear infinite alternate; }
@keyframes slide { from { left: 0 } to { left: calc(100% - 40px) } }
</style></head><body>${body}<script>${SHARED}${script}</script></body></html>`;

const FILES = {
  '/camera.html': page('p3-spike camera', '<p>fake camera</p>', CAMERA),
  '/worker.js': WORKER,
  '/self.html': page('p3-spike self', '<div id="bar"></div><p id="tick"></p>', SELF),
  '/picker.html': page(
    'p3-spike picker',
    '<p style="padding:12px">Click Share, then pick the Desk View window in the system picker.</p>' +
      '<p style="padding:0 12px"><button id="share">Share</button></p>',
    PICKER,
  ),
  '/cdp.html': page('p3-spike', '<p style="padding:12px">p3-spike: waiting for a CDP client</p>'),
};

function serve(request) {
  const { host, pathname } = new URL(request.url);
  const body = host === 'p3' ? FILES[pathname] : undefined;
  if (body === undefined) return new Response('Not found', { status: 404 });
  const type = pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
  return new Response(body, { headers: { 'content-type': `${type}; charset=utf-8` } });
}

function relayProbe(args) {
  if (!probe) {
    record({ check: 'probe', skipped: 'no --probe given' });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(probe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          record(JSON.parse(line));
        } catch {
          record({ check: 'probe-output', text: line });
        }
      }
      if (extra) record(extra);
      resolve();
    };
    child.on('error', (error) => finish({ check: 'probe', error: error.message }));
    child.on('close', (code, signal) =>
      finish(
        code === 0
          ? null
          : { check: 'probe-exit', code, signal, stderr: stderr.trim().slice(-2000) || null },
      ),
    );
  });
}

const webPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false,
};

async function inWindow(file, script, { show, width = 320, height = 240 }) {
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences });
  try {
    await win.loadURL(`spike://p3/${file}`);
    if (show === 'inactive') win.showInactive();
    if (show === 'active') win.show();
    // Let a shown window reach the screen before anything captures it.
    if (show) await new Promise((resolve) => setTimeout(resolve, 500));
    // true: run as a user gesture, which getDisplayMedia may require.
    return await win.webContents.executeJavaScript(script, true);
  } finally {
    win.destroy();
  }
}

async function main() {
  record({
    check: 'media-access',
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  });
  record({ check: 'env', TASSEL_SPIKE: process.env.TASSEL_SPIKE ?? null });
  protocol.handle('spike', serve);

  if (mode === 'status') {
    await relayProbe(['--status']);
  } else if (mode === 'capture') {
    await relayProbe(presentSetup ? ['--present-setup'] : ['--capture', String(frames)]);
  } else if (mode === 'fake-camera') {
    const result = await inWindow('camera.html', `runFakeCamera(${frames})`, { show: false });
    record({ check: 'fake-camera', clip: path.basename(clip), ...result });
  } else if (mode === 'self-capture') {
    const requests = [];
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      requests.push({ frame: Boolean(request.frame), securityOrigin: request.securityOrigin });
      // Only ever this window's own frame: never a screen or another window.
      if (request.frame) callback({ video: request.frame });
      else callback(null);
    });
    const result = await inWindow('self.html', `runSelfCapture(${frames})`, { show: 'inactive' });
    record({ check: 'self-capture', requests, ...result });
  } else if (mode === 'picker') {
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        // With the system picker this is never called; if it is, deny.
        record({ check: 'picker-handler', invoked: true });
        callback(null);
      },
      { useSystemPicker: true },
    );
    const result = await inWindow('picker.html', `waitForShare(${frames})`, {
      show: 'active',
      width: 420,
      height: 160,
    });
    record({ check: 'picker', ...result });
  } else if (mode === 'cdp') {
    const win = new BrowserWindow({ width: 480, height: 200, title: 'p3-spike', show: false, webPreferences });
    await win.loadURL('spike://p3/cdp.html');
    win.show();
    record({ check: 'cdp', title: win.webContents.getTitle() });
    return; // Stays open until a CDP client closes it, or the limit.
  }
  app.quit();
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    record({ check: 'error', error: String(error && error.stack ? error.stack : error) });
    app.exit(1);
  });
