// Isolated second-team entry point. Real capture requires the owner's voice/webcam mode.
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

export function team2Env(mode, { root, env = process.env }) {
  const next = { ...env };
  const live = mode === 'voice' || mode === 'webcam';
  for (const key of Object.keys(next)) {
    if (
      key.startsWith('TASSEL_FAKE_') ||
      /^TASSEL_(STT|LLM|TTS|TITLES|GATE|DEEPCHECK)_PROVIDER$/.test(key)
    )
      delete next[key];
    if (!live && /^(OPENAI|OPENROUTER|DEEPGRAM|ELEVENLABS)_API_KEY$/.test(key)) delete next[key];
  }
  const db = 'postgresql+psycopg://tassel:tassel@127.0.0.1:54329/';
  Object.assign(next, {
    TASSEL_PORT: '8861',
    TASSEL_SERVER_URL: 'http://127.0.0.1:8861',
    TASSEL_E2E_PORT: '8862',
    TASSEL_DATABASE_URL: `${db}tassel_t2_webcam`,
    TASSEL_TEST_DATABASE_URL: `${db}tassel_t2_webcam_test`,
    TASSEL_E2E_DATABASE_URL: `${db}tassel_t2_webcam_e2e`,
    TASSEL_S3_BUCKET: 'tassel-t2-webcam',
    TASSEL_E2E_S3_BUCKET: 'tassel-t2-webcam-e2e',
    TASSEL_USER_DATA: env.TASSEL_LOCAL_USER_DATA || join(root, '.cache', 'team2', 'user-data'),
    TASSEL_TUTOR: live ? 'live' : 'fake',
    TASSEL_PROVIDERS: live ? 'live' : 'fake',
    TASSEL_REQUIRE_FAKE_CAPTURE: live ? '0' : '1',
    TASSEL_PAPER_SOURCE: live ? (mode === 'webcam' ? 'webcam' : 'auto') : 'fake-clip',
    TASSEL_VOICE_ENV_FILE: live ? join(root, 'services', 'server', '.env') : '',
    TASSEL_PAPER_DEBUG: '1',
  });
  if (!live)
    for (const provider of ['STT', 'LLM', 'TTS', 'TITLES', 'GATE', 'DEEPCHECK'])
      next[`TASSEL_${provider}_PROVIDER`] = 'fake';
  if (process.platform === 'win32' && env.TASSEL_LOCAL_TOOLS) {
    const tools = env.TASSEL_LOCAL_TOOLS;
    const windows = env.SystemRoot || 'C:\\Windows';
    next.PATH = [
      dirname(process.execPath),
      join(tools, 'node_modules', '.bin'),
      join(tools, 'uv'),
      join(windows, 'System32'),
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\Docker\\Docker\\resources\\bin',
      env.PATH || env.Path || '',
    ].join(delimiter);
    delete next.Path;
    next.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    next.UV_CACHE_DIR = join(tools, 'uv-cache');
  }
  return next;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [mode = 'demo', ...args] = process.argv.slice(2);
  if (
    ![
      'demo',
      'voice',
      'webcam',
      'desktop-test',
      'server-test',
      'e2e',
      'check',
      'build',
      'test',
    ].includes(mode)
  )
    throw new Error('Unknown team2 mode.');
  const env = team2Env(mode, { root });
  function run(command, argv, cwd = root) {
    const result = spawn.sync(command, argv, { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
  if (['demo', 'voice', 'webcam'].includes(mode)) {
    if (mode !== 'demo' && !existsSync(env.TASSEL_VOICE_ENV_FILE))
      throw new Error('Put provider keys in services/server/.env first.');
    run('docker', ['compose', 'up', '-d', '--wait', 'db', 's3']);
    run('uv', [
      'run',
      '--directory',
      'services/server',
      'python',
      '-c',
      "import os; from sqlalchemy import create_engine, text; from sqlalchemy.engine import make_url; u=make_url(os.environ['TASSEL_DATABASE_URL']); name=u.database; assert name.startswith('tassel_t2_'); e=create_engine(u.set(database='tassel'), isolation_level='AUTOCOMMIT'); c=e.connect(); found=c.execute(text('SELECT 1 FROM pg_database WHERE datname=:name'), {'name':name}).scalar(); c.exec_driver_sql('CREATE DATABASE '+e.dialect.identifier_preparer.quote(name)) if not found else None; c.close(); e.dispose()",
    ]);
    run(process.execPath, ['scripts/dev.mjs']);
  } else if (mode === 'desktop-test') run('pnpm', ['--filter', '@tassel/desktop', 'test', ...args]);
  else if (mode === 'server-test')
    run('uv', ['run', '--directory', 'services/server', 'pytest', ...args]);
  else if (mode === 'build') run('pnpm', ['--filter', '@tassel/desktop', 'build']);
  else if (mode === 'e2e') {
    run('pnpm', ['--filter', '@tassel/desktop', 'build']);
    run('pnpm', ['--filter', '@tassel/desktop', 'e2e', ...args]);
  } else run('pnpm', [mode, ...args]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[team2] ${error.message}`);
    process.exitCode = 1;
  }
}
