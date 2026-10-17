// The P3 TCC and capture spike (Task 1). Spike code only, not product code.
//
//   node docs/research/spikes/p3-tcc/run.mjs A F P T C E   unattended: no real camera, microphone or screen
//   node docs/research/spikes/p3-tcc/run.mjs H D S         owner at the Mac: H and D use the real camera,
//                                                          S captures a real window
//
// It builds the probe into .out/ (git-ignored), runs each named check through main.cjs, then prints
// the JSON lines main.cjs recorded and one verdict line per check. Nothing it runs writes a frame.
// It finds Electron through apps/desktop: require('electron') there gives the binary, and
// Electron.app is three levels up. macOS only; elsewhere it prints a skip line and exits 0.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

if (process.platform !== 'darwin') {
  console.log('p3-tcc: skipped (Desk View is macOS-only)');
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const outDir = join(here, '.out');
const desktopRequire = createRequire(join(repo, 'apps', 'desktop', 'package.json'));
const electronBin = desktopRequire('electron');
const electronApp = dirname(dirname(dirname(electronBin)));
const mainCjs = join(here, 'main.cjs');
const probe = join(outDir, 'probe');
const clip = join(outDir, 'spike-clip.mjpeg');
const CLIP = { frames: 60, width: 960, height: 720 };
const CDP_PORT = 9333;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Paths inside this checkout print as <repo>/…, so the lines read the same in any checkout.
const print = (line) => console.log(JSON.stringify(line).replaceAll(repo, '<repo>'));
const find = (lines, check) => lines.find((line) => line.check === check);
const pass = (why) => ({ verdict: 'PASS', why });
const fail = (why) => ({ verdict: 'FAIL', why });

function run(command, args, timeout = 120_000) {
  const result = spawn.sync(command, args, { cwd: here, encoding: 'utf8', timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function buildProbe() {
  mkdirSync(outDir, { recursive: true });
  const plist = ['-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist'];
  run('swiftc', ['probe.swift', '-o', '.out/probe', ...plist, '-Xlinker', 'Info.plist'], 300_000);
  // The linker's ad-hoc signature leaves the plist unbound; re-signing binds it.
  run('codesign', ['--force', '--sign', '-', '.out/probe']);
}

/** The JSON lines main.cjs recorded, without the pid line. */
function readLines(file) {
  if (!existsSync(file)) return [];
  const [, ...lines] = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { check: 'unparsed', text: line };
    }
  });
}

function readPid(file) {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf8').split('\n')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True while pid is still this spike's Electron (never some later process that reused the pid). */
function ours(pid) {
  const result = spawn.sync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.includes(mainCjs);
}

async function gone(pid, ms) {
  for (let waited = 0; waited < ms; waited += 100) {
    if (!ours(pid)) return true;
    await sleep(100);
  }
  return !ours(pid);
}

function signal(pid, name) {
  try {
    process.kill(pid, name);
  } catch {}
}

/** Waits graceMs for the spike's Electron to exit; then SIGTERM, then SIGKILL. Says what it took. */
async function ensureExited(pid, graceMs) {
  if (!pid) return 'no pid';
  if (await gone(pid, graceMs)) return 'exited';
  signal(pid, 'SIGTERM');
  if (await gone(pid, 2000)) return 'SIGTERM';
  signal(pid, 'SIGKILL');
  return 'SIGKILL';
}

/** Electron spawned by this process: its responsible process is the agent's (or your terminal). */
async function direct(name, args, timeout = 90_000) {
  const out = join(outDir, `${name}.jsonl`);
  rmSync(out, { force: true });
  const log = openSync(join(outDir, `${name}.log`), 'w');
  try {
    const result = spawn.sync(electronBin, [mainCjs, ...args, '--out', out], {
      stdio: ['ignore', log, log],
      timeout,
    });
    if (result.error) console.error(`${name}: ${result.error.message}`);
  } finally {
    closeSync(log);
  }
  await ensureExited(readPid(out), 0);
  return readLines(out);
}

/** Electron launched by LaunchServices (`open -n -a`): it is its own responsible process. */
async function launched(name, args, { env = [], timeout = 240_000 } = {}) {
  const out = join(outDir, `${name}.jsonl`);
  rmSync(out, { force: true });
  const envArgs = env.flatMap((pair) => ['--env', pair]);
  const result = spawn.sync(
    'open',
    ['-W', '-n', '-a', electronApp, ...envArgs, '--args', mainCjs, ...args, '--out', out],
    { encoding: 'utf8', timeout },
  );
  if (result.error) console.error(`${name}: ${result.error.message}`);
  if (result.status !== 0) console.error(`${name}: open exited ${result.status}: ${result.stderr}`);
  await ensureExited(readPid(out), 0);
  return readLines(out);
}

async function waitForEnter(text) {
  console.log(text);
  if (!process.stdin.isTTY) {
    console.log('(stdin is not a terminal, so not waiting for Enter)');
    return;
  }
  process.stdout.write('Press Enter to start. ');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  process.stdin.pause();
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function poll(read, ms) {
  for (let waited = 0; waited < ms; waited += 250) {
    const value = await read();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

async function checkC() {
  const out = join(outDir, 'C.jsonl');
  rmSync(out, { force: true });
  if (await fetchJson(`${CDP}/json/version`)) {
    return [{ check: 'cdp-client', error: `port ${CDP_PORT} is already in use; not attaching` }];
  }
  const step = { check: 'cdp-client' };
  let closeSent = false;
  try {
    const args = ['--mode', 'cdp', '--out', out, `--remote-debugging-port=${CDP_PORT}`];
    run('open', ['-n', '-a', electronApp, '--args', mainCjs, ...args]);
    const version = await poll(() => fetchJson(`${CDP}/json/version`), 15_000);
    if (!version) throw new Error(`no ${CDP}/json/version within 15 s`);
    step.browser = version.Browser;
    const listed = await poll(async () => {
      const targets = await fetchJson(`${CDP}/json/list`);
      return targets?.find((target) => target.type === 'page' && target.title === 'p3-spike');
    }, 15_000);
    if (!listed) throw new Error('no p3-spike page in /json/list within 15 s');
    const { chromium } = desktopRequire('@playwright/test');
    const browser = await chromium.connectOverCDP(CDP);
    const pageHandle = browser.contexts()[0].pages()[0];
    step.title = await pageHandle.evaluate(() => document.title);
    const cdp = await browser.newBrowserCDPSession();
    // Electron may quit before it answers, and then the reply never comes: don't wait on it.
    // Whether it worked shows in how the app exits (main.cjs records a graceful quit).
    cdp.send('Browser.close').catch(() => {});
    closeSent = true;
    await Promise.race([browser.close().catch(() => {}), sleep(2000)]);
  } catch (error) {
    step.error = error.message;
  }
  const pid = await poll(async () => readPid(out), 5000);
  const how = await ensureExited(pid, 5000);
  const quit = Boolean(find(readLines(out), 'quit'));
  step.closedBy =
    how === 'exited' && quit ? (closeSent ? 'Browser.close (graceful quit)' : 'quit') : how;
  return [...readLines(out), step];
}

const VERDICTS = {
  A(lines) {
    const status = find(lines, 'status');
    if (!status) return fail('no status line from the probe');
    return status.camera === 3
      ? fail('the probe is authorized under an agent-started Electron')
      : pass(`camera ${status.camera}: not authorized, as the responsible-process rule predicts`);
  },
  F(lines) {
    const result = find(lines, 'fake-camera');
    if (!result?.track) return fail(result?.error ?? 'no fake-camera result');
    const { width, height } = result.track;
    const size = `${CLIP.width}x${CLIP.height}`;
    const frames = result.worker?.frames ?? 0;
    if (width !== CLIP.width || height !== CLIP.height) return fail(`track is ${width}x${height}`);
    if (frames < 10) return fail(`${frames} frames`);
    if (result.worker.sizes.join() !== size) return fail(`frame sizes ${result.worker.sizes}`);
    return pass(`${frames} frames at the clip's ${size}, track "${result.track.label}"`);
  },
  P(lines) {
    const result = find(lines, 'fake-camera');
    const worker = result?.worker;
    if (!worker) return fail(result?.error ?? 'no answer from the worker');
    if (worker.error) return fail(worker.error);
    if (worker.frames < 10 || !worker.videoFrames) return fail(`${worker.frames} frames in the worker`);
    return pass(`${worker.frames} VideoFrames reached the worker through the transferred readable`);
  },
  T(lines) {
    const result = find(lines, 'self-capture');
    if (!result?.window) return fail('no self-capture result');
    if (result.error) return fail(result.error);
    if (result.frames < 10) return fail(`${result.frames} frames`);
    // The window's size: every frame size shows the whole window, with no letterbox, at a whole
    // number of frame pixels per CSS pixel. Chromium may render a captured tab above the device
    // scale, and may change that scale mid-stream.
    const { width, height, dpr } = result.window;
    for (const size of result.sizes) {
      const { blackEdge, framePxPerCssPx: scale } = result.bySize?.[size] ?? {};
      if (!Number.isInteger(scale) || blackEdge !== 0 || size !== `${width * scale}x${height * scale}`) {
        return fail(`frames of ${size} don't show the whole ${width}x${height} window`);
      }
    }
    const scales = result.sizes.map((size) => result.bySize[size].framePxPerCssPx);
    const screen = find(lines, 'media-access')?.screen;
    return pass(
      `${result.frames} frames, each of the whole ${width}x${height} window: ${result.sizes.join(' then ')} ` +
        `at ${scales.join(' then ')} frame px per CSS px (dpr ${dpr}; track settings said ` +
        `${result.track.width}x${result.track.height}). Screen Recording for the responsible process: ${screen}`,
    );
  },
  C(lines) {
    const client = find(lines, 'cdp-client');
    if (client?.title === 'p3-spike') return pass(`evaluated document.title "p3-spike"; closed by ${client.closedBy}`);
    return fail(client?.error ?? `title ${JSON.stringify(client?.title)}`);
  },
  E(lines) {
    const env = find(lines, 'env');
    if (!env) return fail('no env line');
    return env.TASSEL_SPIKE === '1' ? pass('TASSEL_SPIKE is "1"') : fail(`TASSEL_SPIKE is ${env.TASSEL_SPIKE}`);
  },
  H(lines) {
    const capture = find(lines, 'capture');
    if (!capture) return fail('no capture line from the probe');
    if (capture.error) return fail(`${capture.error} (camera ${capture.camera})`);
    return capture.frames === 30
      ? pass(`30 frames at ${capture.width}x${capture.height}, ${capture.fps} fps from "${capture.device}"`)
      : fail(`${capture.frames} frames`);
  },
  D(lines) {
    const setup = find(lines, 'present-setup');
    if (!setup) return fail('no present-setup line from the probe');
    return setup.result === 'presented'
      ? pass('the probe says presented; the owner confirms the Desk View app appeared')
      : fail(setup.message ?? setup.result);
  },
  S(lines) {
    const picked = find(lines, 'picker');
    if (!picked) return fail('no picker result');
    if (picked.error) return fail(picked.error);
    if (find(lines, 'picker-handler')) return fail('the handler ran: no system picker');
    return picked.frames > 0
      ? pass(`${picked.frames} frames from a ${picked.track.displaySurface} track; the owner confirms the Desk View window`)
      : fail('no frames');
  },
};

const RUNS = {
  A: () => direct('A', ['--mode', 'status', '--probe', probe]),
  FP: () => {
    print(JSON.parse(run(probe, ['--write-mjpeg', clip, String(CLIP.frames)])));
    return direct('FP', ['--mode', 'fake-camera', '--clip', clip, '--frames', '10']);
  },
  T: () => direct('T', ['--mode', 'self-capture', '--frames', '10']),
  C: checkC,
  E: () => launched('E', ['--mode', 'status', '--probe', probe], { env: ['TASSEL_SPIKE=1'] }),
  H: () => {
    console.log('H (owner at the Mac): if macOS asks whether Electron may use the camera, the owner decides.');
    console.log('The probe counts 30 Desk View frames and keeps none.');
    return launched('H', ['--mode', 'capture', '--probe', probe]);
  },
  D: async () => {
    await waitForEnter(
      'D (owner at the Mac): the probe asks macOS to present the Desk View app. Watch for it to appear,\n' +
        'and leave it open for S.',
    );
    return launched('D', ['--mode', 'capture', '--present-setup', '--probe', probe]);
  },
  S: async () => {
    await waitForEnter(
      'S (owner at the Mac): with Desk View open, a small window opens. Click Share, then pick the Desk View\n' +
        'window in the system picker. Leave Screen & System Audio Recording as it is. The window counts\n' +
        'frames, keeps none, and closes; then close Desk View.',
    );
    return launched('S', ['--mode', 'picker', '--frames', '30'], { timeout: 330_000 });
  },
};

const ORDER = ['A', 'F', 'P', 'T', 'C', 'E', 'H', 'D', 'S'];
const asked = process.argv.slice(2).map((name) => name.toUpperCase());
const unknown = asked.filter((name) => !ORDER.includes(name));
if (asked.length === 0 || unknown.length > 0) {
  console.error(`usage: node run.mjs <check>… where a check is one of ${ORDER.join(' ')}`);
  process.exit(64);
}

buildProbe();
const verdicts = {};
const done = new Map();
for (const name of asked) {
  const key = name === 'F' || name === 'P' ? 'FP' : name;
  if (!done.has(key)) done.set(key, await RUNS[key]());
  const lines = done.get(key);
  console.log(`--- ${name}`);
  for (const line of lines) print(line);
  const { verdict, why } = VERDICTS[name](lines);
  verdicts[name] = verdict;
  print({ check: name, verdict, why });
}
console.log(JSON.stringify({ verdicts }));
process.exit(0);
