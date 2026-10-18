// `pnpm test:changed` runs only the tests a change needs; `pnpm test:area <name...>` runs every
// test of the named areas. The areas live in scripts/test-areas.mjs, the planning in
// scripts/test-select.mjs. Both print what they run; --dry-run prints it and stops.
//
//   pnpm test:changed [--base <ref>] [--files <a,b,...>] [--only node,unit,pytest,e2e]
//                     [--no-e2e] [--dry-run] [--keep-going]
//   pnpm test:area <name...> [same flags]      pnpm test:area --list
//
// The changed files are everything that differs from the merge-base with the base, committed or
// not, plus untracked files. The base is --base, else TASSEL_TEST_BASE, else the origin branch
// this checkout is fewest commits ahead of (its own once pushed, else the branch it came from).
// --files skips git and plans for the files given.
//
// Unit tests come from Vitest's import graph (`vitest related`); E2E and server tests come from
// the areas. E2E builds the desktop app first and needs `docker compose up -d db s3`, like
// `pnpm e2e`; the server tests need Postgres, like `pnpm test`. cross-spawn runs pnpm, uv and git
// without a shell, so this works on macOS and Windows.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import { AREAS } from './test-areas.mjs';
import { inventoryOf, vitestPackages } from './test-inventory.mjs';
import { commandsFor, KINDS, planAreas, planChanges } from './test-select.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function git(args) {
  const result = spawn.sync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout;
}

/** The origin branch HEAD is fewest commits ahead of, with that count. */
function nearestOriginBranch() {
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
    .split('\n')
    .filter((ref) => ref && ref !== 'origin/HEAD' && ref !== 'origin');
  let best = null;
  for (const ref of refs) {
    const ahead = Number(git(['rev-list', '--count', `${ref}..HEAD`]).trim());
    if (best === null || ahead < best.ahead) best = { ref, ahead };
  }
  if (best === null) throw new Error('no origin branches: pass --base <ref>');
  return best;
}

function changedFiles(baseRef) {
  const mergeBase = git(['merge-base', 'HEAD', baseRef]).trim();
  const split = (out) => out.split('\0').filter(Boolean);
  const files = [
    ...split(git(['diff', '--name-only', '--no-renames', '-z', mergeBase])),
    ...split(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ];
  return { mergeBase, files };
}

function parseArgs(argv) {
  const options = { area: null, only: [...KINDS], files: null, dryRun: false, keepGoing: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--') continue;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--keep-going') options.keepGoing = true;
    else if (arg === '--no-e2e') options.only = options.only.filter((kind) => kind !== 'e2e');
    else if (arg === '--only') options.only = value().split(',');
    else if (arg === '--base') options.base = value();
    else if (arg === '--files') options.files = [...(options.files ?? []), ...value().split(',')];
    else if (arg === '--area') options.area = [];
    else if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-') && options.area) options.area.push(arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  const unknown = options.only.filter((kind) => !KINDS.includes(kind));
  if (unknown.length > 0) throw new Error(`--only takes ${KINDS.join(',')}, not ${unknown}`);
  return options;
}

function listAreas() {
  for (const area of AREAS) console.log(`  ${area.name.padEnd(9)} ${area.title}`);
}

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

function main() {
  const options = parseArgs(process.argv.slice(2));
  const name = options.area ? 'test:area' : 'test:changed';
  if (options.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport')[0]);
    return 0;
  }
  if (options.list || (options.area && options.area.length === 0)) {
    console.log(`${name}: the areas (scripts/test-areas.mjs)`);
    listAreas();
    return options.list ? 0 : 1;
  }

  const packages = vitestPackages(root);
  const inventory = inventoryOf(root, packages);
  let plan;
  if (options.area) {
    plan = planAreas(options.area, { inventory, packages });
    console.log(`${name}: every test of ${options.area.join(', ')}`);
  } else {
    let files = options.files;
    if (files) console.log(`${name}: the ${files.length} file(s) given`);
    else {
      const base = options.base ?? process.env.TASSEL_TEST_BASE;
      const nearest = base ? null : nearestOriginBranch();
      const baseRef = base ?? nearest.ref;
      const changed = changedFiles(baseRef);
      files = changed.files;
      const ahead = nearest ? `, ${nearest.ahead} commit(s) ahead` : '';
      console.log(
        `${name}: changes since ${baseRef} (merge-base ${changed.mergeBase.slice(0, 7)}${ahead}), committed or not`,
      );
    }
    plan = planChanges(files, {
      inventory,
      packages,
      exists: (file) => existsSync(join(root, file)),
    });
    if (plan.files.length === 0) {
      console.log('  no changed files: nothing to run');
      return 0;
    }
    const width = Math.min(72, Math.max(...plan.files.map(({ file }) => file.length)));
    for (const { file, areas, widen, note } of plan.files) {
      const what = [...areas, ...widen.map((why) => `[${why}]`), ...(note ? [`(${note})`] : [])];
      console.log(`  ${file.padEnd(width)}  ${what.join(', ')}`);
    }
  }

  const commands = commandsFor(plan, { inventory, packages, only: options.only });
  if (commands.length === 0) {
    console.log(`${name}: no tests to run`);
    return 0;
  }
  console.log(`${name}: ${options.dryRun ? 'would run' : 'running'}`);
  for (const [index, { title, command, args }] of commands.entries()) {
    console.log(`  ${index + 1}. ${title}\n     ${[command, ...args].map(quote).join(' ')}`);
  }
  if (commands.some(({ kind }) => kind === 'e2e')) {
    console.log('  E2E needs `docker compose up -d db s3`; the server tests need Postgres.');
  }
  if (options.dryRun) return 0;

  const results = [];
  for (const { title, command, args } of commands) {
    console.log(`\n${name}: ${title}`);
    const started = Date.now();
    const result = spawn.sync(command, args, { cwd: root, stdio: 'inherit' });
    const ok = !result.error && result.status === 0;
    if (result.error) console.error(`${name}: ${result.error.message}`);
    results.push({ title, ok, seconds: Math.round((Date.now() - started) / 1000) });
    if (!ok && !options.keepGoing) break;
  }
  console.log(`\n${name}: summary`);
  for (const { title, ok, seconds } of results) {
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${title} (${seconds}s)`);
  }
  const skipped = commands.length - results.length;
  if (skipped > 0) console.log(`  skipped ${skipped} after the failure (--keep-going runs them)`);
  return results.every(({ ok }) => ok) && skipped === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`test:changed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
