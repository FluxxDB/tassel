// `node scripts/check-no-frames.mjs`, part of `pnpm check`: a camera frame must never be committed.
// It exits 1, naming each one, when a tracked path ends in a FRAME_EXTENSIONS entry (any case).
// `--paths <path>…` checks the given paths instead of `git ls-files`.
// cross-spawn runs git (git.exe on Windows) without a shell, so this runs on macOS and Windows.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The plan's four, then .mjpg, .jfif, .jpe, .heic and .heif (ruling P3-R21).
const FRAME_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.mjpeg',
  '.y4m',
  '.mjpg',
  '.jfif',
  '.jpe',
  '.heic',
  '.heif',
];
const isFrame = (path) =>
  FRAME_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

function trackedPaths() {
  // -z: NUL-separated and never quoted, so any file name comes back as it is.
  const result = spawn.sync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter(Boolean);
}

try {
  const at = process.argv.indexOf('--paths');
  const paths = at === -1 ? trackedPaths() : process.argv.slice(at + 1);
  const frames = paths.filter(isFrame);
  if (frames.length > 0) {
    console.error('check-no-frames: camera frames must never be committed. Remove from git:');
    for (const frame of frames) console.error(`  ${frame}`);
    process.exitCode = 1;
  } else {
    console.log('check-no-frames: no camera frames tracked');
  }
} catch (error) {
  console.error(`check-no-frames: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
