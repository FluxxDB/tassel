// One app entry point. Features belong to the UI; checkout-independent settings are local data.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL, launcherOptions } from './backend.mjs';

function pathFrom(base, value) {
  return isAbsolute(value) ? value : resolve(base, value);
}
export function buildStartup({
  root,
  sharedRoot = root,
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  local = {},
  hostServer = launcherOptions([], env).hostServer,
}) {
  // The canonical backend (scripts/backend.mjs) unless .local/start.json names an existing one.
  const port = local.port ?? CANONICAL.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Startup port must be an integer from 1024 to 65535.');
  for (const key of ['userData', 'databaseUrl', 'voiceEnvFile', 's3Bucket', 'toolsDir'])
    if (local[key] !== undefined && (typeof local[key] !== 'string' || !local[key]))
      throw new Error(`Invalid startup setting: ${key}`);
  const userData = pathFrom(sharedRoot, local.userData ?? '.local/avatar-app-data');
  const tools = pathFrom(sharedRoot, local.toolsDir ?? '.local/tools');
  const candidates = [
    join(root, 'services/server/.env'),
    join(sharedRoot, 'services/server/.env'),
    join(sharedRoot, '.local/live-test/services/server/.env'),
  ];
  const voiceEnvFile = local.voiceEnvFile
    ? pathFrom(sharedRoot, local.voiceEnvFile)
    : (candidates.find(exists) ?? candidates[0]);
  const next = { ...env };
  for (const key of Object.keys(next))
    if (
      key.startsWith('TASSEL_FAKE_') ||
      /^TASSEL_(STT|LLM|TTS|TITLES|GATE|DEEPCHECK)_PROVIDER$/.test(key)
    )
      delete next[key];
  Object.assign(next, {
    TASSEL_PORT: String(port),
    TASSEL_SERVER_URL: `http://127.0.0.1:${port}`,
    TASSEL_DATABASE_URL:
      local.databaseUrl ??
      `postgresql+psycopg://tassel:tassel@127.0.0.1:54329/${CANONICAL.database}`,
    TASSEL_S3_BUCKET: local.s3Bucket ?? CANONICAL.bucket,
    TASSEL_USER_DATA: userData,
    TASSEL_TUTOR: 'live',
    TASSEL_PROVIDERS: 'live',
    TASSEL_TTS_PROVIDER: 'live',
    TASSEL_VOICE_ENV_FILE: voiceEnvFile,
    TASSEL_REQUIRE_FAKE_CAPTURE: '0',
    TASSEL_PAPER_SOURCE: platform === 'win32' ? 'webcam' : 'auto',
  });
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === 'path');
  const prior = pathKey ? next[pathKey] : '';
  if (platform === 'win32') {
    if (pathKey) delete next[pathKey];
    const windows = env.SystemRoot || 'C:\\Windows';
    next.PATH = [
      dirname(process.execPath),
      join(tools, 'node_modules/.bin'),
      join(tools, 'uv'),
      join(windows, 'System32'),
      windows,
      join(env.ProgramFiles || 'C:\\Program Files', 'Git/cmd'),
      join(env.ProgramFiles || 'C:\\Program Files', 'Docker/Docker/resources/bin'),
      prior,
    ].join(';');
    next.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    next.UV_CACHE_DIR = join(tools, 'uv-cache');
  } else next.PATH = [dirname(process.execPath), prior].join(delimiter);
  return {
    root,
    sharedRoot,
    hostServer,
    tools,
    settingsFile: join(sharedRoot, '.local/start.json'),
    voiceEnvFile,
    env: next,
  };
}
export function safeSummary(config) {
  return {
    checkout: config.root,
    sharedSettings: config.settingsFile,
    profile: config.env.TASSEL_USER_DATA,
    server: config.env.TASSEL_SERVER_URL,
    backend: config.hostServer ? 'host' : 'docker',
    database: new URL(
      config.env.TASSEL_DATABASE_URL.replace(/^postgresql\+psycopg:/, 'postgresql:'),
    ).pathname.slice(1),
    providerSettings: config.voiceEnvFile,
    capture: config.env.TASSEL_PAPER_SOURCE,
    features: 'Paper, Screen, voice, board, avatar, memory, personality',
  };
}
/** `--check` prints the summary only; `--host-server` reaches pnpm dev (scripts/backend.mjs). */
export function startArgs(argv) {
  if (argv.some((arg) => arg !== '--check' && arg !== '--host-server'))
    throw new Error(
      'Usage: Start-Tassel.cmd [--check] [--host-server]. Choose features inside Tassel.',
    );
  const hostServer = argv.includes('--host-server');
  return {
    check: argv.includes('--check'),
    hostServer,
    devArgs: hostServer ? ['--host-server'] : [],
  };
}
export function sharedRepositoryRoot(root) {
  const git =
    process.platform === 'win32' &&
    existsSync(join(process.env.ProgramFiles || 'C:\\Program Files', 'Git/cmd/git.exe'))
      ? join(process.env.ProgramFiles || 'C:\\Program Files', 'Git/cmd/git.exe')
      : 'git';
  const result = spawnSync(
    git,
    ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', windowsHide: true },
  );
  return result.status === 0 ? dirname(resolve(root, result.stdout.trim())) : root;
}
function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sharedRoot = sharedRepositoryRoot(root);
  const settingsFile = join(sharedRoot, '.local/start.json');
  const local = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
  if (!local || typeof local !== 'object' || Array.isArray(local))
    throw new Error('Invalid .local/start.json');
  const args = startArgs(process.argv.slice(2));
  const config = buildStartup({
    root,
    sharedRoot,
    local,
    hostServer: args.hostServer || process.env.TASSEL_HOST_SERVER === '1',
  });
  console.log(JSON.stringify(safeSummary(config), null, 2));
  if (args.check) return;
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18))
    throw new Error('Tassel needs Node 22.18 or later.');
  if (!existsSync(config.voiceEnvFile))
    throw new Error(
      'Create services/server/.env with provider settings before starting. No fake tutor is selected silently.',
    );
  const require = createRequire(join(root, 'package.json'));
  let spawn;
  try {
    spawn = require('cross-spawn');
  } catch {
    throw new Error('Install this checkout first with pnpm install.');
  }
  // Pin only paths and local infrastructure settings, never provider key contents.
  if (!existsSync(settingsFile)) {
    mkdirSync(dirname(settingsFile), { recursive: true });
    try {
      writeFileSync(
        settingsFile,
        `${JSON.stringify(
          {
            userData: config.env.TASSEL_USER_DATA,
            port: Number(config.env.TASSEL_PORT),
            databaseUrl: config.env.TASSEL_DATABASE_URL,
            s3Bucket: config.env.TASSEL_S3_BUCKET,
            voiceEnvFile: config.voiceEnvFile,
            toolsDir: config.tools,
          },
          null,
          2,
        )}\n`,
        { flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const result = spawn.sync(process.execPath, [join(root, 'scripts/dev.mjs'), ...args.devArgs], {
    cwd: root,
    env: config.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[start] ${error.message}`);
    process.exitCode = 1;
  }
}
