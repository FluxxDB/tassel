// `pnpm check:api`: regenerates openapi.json and schema.d.ts into a temp dir and exits 1 if the
// committed copies in packages/shared/src/api differ (run `pnpm gen:api` to update them).
// cross-spawn runs uv and pnpm (pnpm.cmd on Windows) without a shell, so this runs on macOS
// and Windows.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committedDir = join(root, 'packages', 'shared', 'src', 'api');
const files = ['openapi.json', 'schema.d.ts'];

function run(command, args) {
  const result = spawn.sync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`\`${command} ${args.join(' ')}\` failed`);
}

// Line endings don't count: a checkout may turn LF into CRLF.
const read = (file) =>
  existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : null;

const temp = mkdtempSync(join(tmpdir(), 'tassel-check-api-'));
try {
  const schema = join(temp, 'openapi.json');
  const exporter = ['run', '--directory', 'services/server', 'python', '-m'];
  run('uv', [...exporter, 'tassel.scripts.export_openapi', schema]);
  const generator = ['--filter', '@tassel/shared', 'exec', 'openapi-typescript'];
  run('pnpm', [...generator, schema, '-o', join(temp, 'schema.d.ts')]);

  const stale = files.filter((file) => read(join(temp, file)) !== read(join(committedDir, file)));
  if (stale.length > 0) {
    console.error(`check:api: stale ${stale.join(' and ')} in packages/shared/src/api.`);
    console.error('Run `pnpm gen:api` and commit the result.');
    process.exitCode = 1;
  } else {
    console.log('check:api: openapi.json and schema.d.ts match the server');
  }
} catch (error) {
  console.error(`check:api: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
