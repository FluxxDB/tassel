// The inputs scripts/test-changed.mjs plans with, read from the checkout: the Vitest packages and
// every test file by kind. scripts/test-select.test.mjs uses them to check that every test sits
// in an area.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'test-results', '.venv', 'out']);

/** Repo-relative paths under `dir` that `keep` accepts. */
export function walk(root, dir, keep) {
  const found = [];
  const abs = join(root, dir);
  if (!existsSync(abs)) return found;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(root, path, keep));
    } else if (keep(path)) found.push(path);
  }
  return found;
}

/** The Vitest packages, and the workspace packages each one imports. */
export function vitestPackages(root) {
  const dirs = ['apps', 'packages'].flatMap((parent) =>
    existsSync(join(root, parent))
      ? readdirSync(join(root, parent)).map((name) => `${parent}/${name}`)
      : [],
  );
  const manifests = dirs
    .filter((dir) => existsSync(join(root, dir, 'package.json')))
    .map((dir) => ({
      dir,
      json: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')),
    }));
  const dirOf = new Map(manifests.map(({ dir, json }) => [json.name, dir]));
  return manifests
    .filter(({ json }) => /\bvitest\b/.test(json.scripts?.test ?? ''))
    .map(({ dir, json }) => ({
      dir,
      name: json.name,
      uses: Object.entries({ ...json.dependencies, ...json.devDependencies })
        .filter(([, version]) => String(version).startsWith('workspace:'))
        .map(([name]) => dirOf.get(name))
        .filter(Boolean),
    }));
}

/** Every test file by kind: unit (Vitest), e2e (Playwright), pytest, node (script tests). */
export function inventoryOf(root, packages) {
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return {
    unit: packages.flatMap(({ dir }) =>
      walk(
        root,
        `${dir}/tests`,
        (path) => /\.test\.tsx?$/.test(path) && !path.includes('/tests/e2e/'),
      ),
    ),
    e2e: walk(root, 'apps/desktop/tests/e2e', (path) => path.endsWith('.spec.ts')),
    pytest: walk(root, 'services/server/tests', (path) => /\/test_[^/]*\.py$/.test(path)),
    // The script tests are the ones the root `pnpm test` runs.
    node: (rootPkg.scripts.test.match(/scripts\/[\w.-]+\.test\.mjs/g) ?? []).sort(),
  };
}
