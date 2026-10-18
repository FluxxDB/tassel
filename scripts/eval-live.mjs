// `pnpm eval:live [scenario...] [--dry-run] [--fake] [--budget N] [--thinker-effort low] ...`:
// the live tutor's real-token eval (services/server/src/tassel/evals). It runs scripted student
// turns through the real voice pipeline in process, with fake TTS and typed turns, and writes a
// JSON and Markdown report under services/server/.cache/evals/<timestamp>/.
//
// A real run reads provider keys through the server's own settings from TASSEL_VOICE_ENV_FILE;
// this script never opens that file and passes it on untouched. `--dry-run` and `--fake` need
// no keys. Every argument goes to `python -m tassel.evals.live` (`--help` lists them).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'services', 'server');

/** The command that runs the eval with these arguments. */
export function evalCommand(args, env = process.env) {
  return {
    command: 'uv',
    args: ['run', '--directory', serverDir, 'python', '-m', 'tassel.evals.live', ...args],
    // Pipecat logs every frame at DEBUG; the run prints its own progress (--verbose: all logs).
    env: args.includes('--verbose') ? env : { LOGURU_LEVEL: 'ERROR', ...env },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { command, args, env } = evalCommand(process.argv.slice(2));
  const child = spawn(command, args, { stdio: 'inherit', env });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
