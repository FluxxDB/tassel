// Explicit metadata-only import. The server's normal settings reader holds the key;
// no key crosses to this process or the renderer. Never run at app startup.
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

if (!process.argv.includes('--refresh')) {
  console.error('Use --refresh for an explicit metadata-only lookup.');
  process.exitCode = 1;
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawn.sync(
    'uv',
    [
      'run',
      '--directory',
      'services/server',
      'python',
      '-m',
      'tassel.scripts.export_avatar_voices',
      '--metadata-only',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    console.error(
      result.error ? 'Could not start server metadata exporter.' : result.stderr.trim(),
    );
    process.exitCode = 1;
  } else {
    const catalog = JSON.parse(result.stdout);
    if (catalog.synthesisEnabled !== false || !catalog.voices?.length)
      throw new Error('Invalid metadata export; existing catalog preserved.');
    writeFileSync(
      join(root, 'apps', 'desktop', 'src', 'renderer', 'src', 'avatar', 'voices.json'),
      `${JSON.stringify(catalog, null, 2)}\n`,
    );
    console.log(
      `Saved ${catalog.voices.length} public voice records; ${catalog.missing.length} regional queries had no results. No speech generated or previews fetched.`,
    );
  }
}
