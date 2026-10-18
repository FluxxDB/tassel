// The planning half of `pnpm test:changed` and `pnpm test:area`: maps files to the areas in
// scripts/test-areas.mjs and turns them into commands. Nothing here touches git, the disk or a
// process, so scripts/test-select.test.mjs can feed it any diff; scripts/test-changed.mjs gathers
// the inputs and runs the commands.
import { AREAS, NO_TESTS, WIDEN } from './test-areas.mjs';

export const KINDS = ['node', 'unit', 'pytest', 'e2e'];
export const DESKTOP = 'apps/desktop';
export const SERVER = 'services/server';

/** A repo-relative glob (`*`, `**`, `{a,b}`) as an anchored RegExp. */
export function globToRegExp(glob) {
  let source = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      // `a/**/b` also matches `a/b`; a trailing `**` matches everything below.
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '{') {
      source += '(?:';
      braces += 1;
    } else if (char === '}' && braces > 0) {
      source += ')';
      braces -= 1;
    } else if (char === ',' && braces > 0) source += '|';
    else source += char.replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const cache = new Map();
/** Whether a repo-relative path matches any of the globs. */
export function matches(file, globs = []) {
  return globs.some((glob) => {
    let re = cache.get(glob);
    if (!re) {
      re = globToRegExp(glob);
      cache.set(glob, re);
    }
    return re.test(file);
  });
}

const RELATED = /\.(?:[cm]?[jt]sx?|json|css|html)$/;

function emptyPlan() {
  return {
    files: [],
    unit: new Map(), // package dir -> { all, related: Set, files: Set }
    e2e: { all: false, files: new Set() },
    pytest: { all: false, files: new Set() },
    node: { all: false, files: new Set() },
    areas: new Set(),
  };
}

function unitEntry(plan, dir) {
  let entry = plan.unit.get(dir);
  if (!entry) {
    entry = { all: false, related: new Set(), files: new Set() };
    plan.unit.set(dir, entry);
  }
  return entry;
}

function addAll(set, files) {
  for (const file of files) set.add(file);
}

const pick = (inventory, globs) => inventory.filter((file) => matches(file, globs));

function addAreaSuite(plan, kind, area, inventory) {
  if (kind === 'e2e' || kind === 'pytest' || kind === 'node') {
    addAll(plan[kind].files, pick(inventory[kind], area[kind]));
  }
}

function areaNamed(areas, name) {
  const area = areas.find((candidate) => candidate.name === name);
  if (!area) throw new Error(`unknown area "${name}"`);
  return area;
}

/**
 * What a set of changed files needs: per file, the areas and shared rules it falls under, and
 * per kind, the tests to run. `inventory` lists every test file by kind, repo-relative;
 * `packages` lists the Vitest packages as { dir, name, uses: [workspace dirs it imports] }.
 */
export function planChanges(changed, { inventory, packages, exists = () => true, rules = {} }) {
  const areas = rules.areas ?? AREAS;
  const widen = rules.widen ?? WIDEN;
  const noTests = rules.noTests ?? NO_TESTS;
  const plan = emptyPlan();

  for (const file of [...new Set(changed)].sort()) {
    const entry = { file, areas: [], widen: [], note: null };
    plan.files.push(entry);

    // Unit tests: Vitest's import graph decides, in every package that can import the file.
    if (RELATED.test(file) && exists(file)) {
      for (const pkg of packages) {
        if ([pkg.dir, ...pkg.uses].some((dir) => file.startsWith(`${dir}/`))) {
          unitEntry(plan, pkg.dir).related.add(file);
        }
      }
    }
    if (inventory.e2e.includes(file)) plan.e2e.files.add(file);
    if (inventory.pytest.includes(file)) plan.pytest.files.add(file);
    if (inventory.node.includes(file)) plan.node.files.add(file);

    for (const rule of widen) {
      if (!matches(file, rule.match)) continue;
      entry.widen.push(rule.why);
      if (rule.unit === 'all') for (const pkg of packages) unitEntry(plan, pkg.dir).all = true;
      else for (const dir of rule.unit ?? []) unitEntry(plan, dir).all = true;
      for (const kind of ['e2e', 'pytest', 'node']) {
        if (rule[kind] === 'all') plan[kind].all = true;
        else {
          for (const name of rule[kind] ?? []) {
            addAreaSuite(plan, kind, areaNamed(areas, name), inventory);
          }
        }
      }
    }

    for (const area of areas) {
      const asApp = matches(file, area.app);
      const asServer = matches(file, area.server);
      const asUnit = matches(file, area.unit);
      const asE2e = matches(file, area.e2e);
      const asPytest = matches(file, area.pytest);
      const asNode = matches(file, area.node);
      if (!(asApp || asServer || asUnit || asE2e || asPytest || asNode)) continue;
      entry.areas.push(area.name);
      plan.areas.add(area.name);
      if (asServer) addAreaSuite(plan, 'pytest', area, inventory);
      if (asApp) addAreaSuite(plan, 'e2e', area, inventory);
      if (asServer) addAll(plan.e2e.files, pick(inventory.e2e, area.serverE2e ?? area.e2e));
      // A changed helper (a conftest, a probe, a fixture) runs every test of its area.
      if (asE2e && !inventory.e2e.includes(file)) addAreaSuite(plan, 'e2e', area, inventory);
      if (asPytest && !inventory.pytest.includes(file)) {
        addAreaSuite(plan, 'pytest', area, inventory);
      }
      if (area.node && (asApp || asNode)) plan.node.all = true;
    }

    if (entry.areas.length === 0 && entry.widen.length === 0) {
      if (matches(file, noTests)) entry.note = 'no tests';
      else if (file.startsWith(`${SERVER}/`)) {
        // A server file outside every area: the whole server suite is the safe answer.
        entry.note = 'in no area: every server test';
        plan.pytest.all = true;
      } else if ([...inventory.e2e, ...inventory.pytest, ...inventory.node].includes(file)) {
        entry.note = 'a test in no area: runs alone';
      } else {
        entry.note = 'in no area: unit tests through the import graph only';
      }
    }
  }
  return finish(plan);
}

/** Every test of the named areas. */
export function planAreas(names, { inventory, packages, rules = {} }) {
  const areas = rules.areas ?? AREAS;
  const plan = emptyPlan();
  for (const name of names) {
    const area = areaNamed(areas, name);
    plan.areas.add(name);
    for (const kind of ['e2e', 'pytest', 'node']) addAreaSuite(plan, kind, area, inventory);
    for (const file of pick(inventory.unit, area.unit)) {
      const pkg = packages.find((candidate) => file.startsWith(`${candidate.dir}/`));
      if (pkg) unitEntry(plan, pkg.dir).files.add(file);
    }
  }
  return finish(plan);
}

function finish(plan) {
  const sorted = (set) => [...set].sort();
  const suite = ({ all, files }) => ({ all, files: all ? [] : sorted(files) });
  return {
    files: plan.files,
    areas: sorted(plan.areas),
    unit: [...plan.unit.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, { all, related, files }]) => ({
        dir,
        all,
        related: all ? [] : sorted(related),
        files: all ? [] : sorted(files),
      }))
      .filter((entry) => entry.all || entry.related.length > 0 || entry.files.length > 0),
    e2e: suite(plan.e2e),
    pytest: suite(plan.pytest),
    node: suite(plan.node),
  };
}

/**
 * The shortest argument list for `selected` out of `inventory` (both under `root/`): a directory
 * whose every test is selected becomes `dir/`. Returns null when everything is selected.
 */
export function compress(selected, inventory, root) {
  const chosen = new Set(selected);
  const under = inventory.filter((file) => file.startsWith(`${root}/`));
  if (under.length > 0 && under.every((file) => chosen.has(file))) return null;
  const out = selected.filter((file) => !under.includes(file));
  const visit = (prefix, files) => {
    if (prefix !== `${root}/` && files.every((file) => chosen.has(file))) {
      out.push(prefix);
      return;
    }
    const groups = new Map();
    for (const file of files) {
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        if (chosen.has(file)) out.push(file);
      } else {
        const dir = `${prefix}${rest.slice(0, slash + 1)}`;
        groups.set(dir, [...(groups.get(dir) ?? []), file]);
      }
    }
    for (const [dir, group] of groups) {
      if (group.some((file) => chosen.has(file))) visit(dir, group);
    }
  };
  visit(`${root}/`, under);
  return out.sort();
}

const relativeTo = (dir, file) => {
  if (file.startsWith(`${dir}/`)) return file.slice(dir.length + 1);
  const ups = dir.split('/').map(() => '..');
  return [...ups, file].join('/');
};

/**
 * The commands for a plan, in the order they run: script tests, unit tests, server tests, then
 * the desktop build and E2E (the slowest last). `only` limits the kinds.
 */
export function commandsFor(plan, { inventory, packages, only = KINDS }) {
  const commands = [];
  const want = (kind) => only.includes(kind);

  if (want('node') && (plan.node.all || plan.node.files.length > 0)) {
    const files = plan.node.all ? inventory.node : plan.node.files;
    commands.push({
      kind: 'node',
      title: 'script tests',
      command: 'node',
      args: ['--test', ...files],
    });
  }

  if (want('unit')) {
    for (const entry of plan.unit) {
      const pkg = packages.find((candidate) => candidate.dir === entry.dir);
      const filter = ['--filter', pkg.name];
      if (entry.all) {
        commands.push({
          kind: 'unit',
          title: `${pkg.name} unit, all`,
          command: 'pnpm',
          args: [...filter, 'test'],
        });
        continue;
      }
      if (entry.related.length > 0) {
        commands.push({
          kind: 'unit',
          title: `${pkg.name} unit, related to ${entry.related.length} changed file(s)`,
          command: 'pnpm',
          args: [
            ...filter,
            'exec',
            'vitest',
            'related',
            '--run',
            '--passWithNoTests',
            ...entry.related.map((file) => relativeTo(pkg.dir, file)),
          ],
        });
      }
      if (entry.files.length > 0) {
        const unitInventory = inventory.unit.filter((file) => file.startsWith(`${pkg.dir}/`));
        const args = compress(entry.files, unitInventory, pkg.dir);
        commands.push({
          kind: 'unit',
          title: `${pkg.name} unit, ${entry.files.length} file(s)`,
          command: 'pnpm',
          args:
            args === null
              ? [...filter, 'test']
              : [...filter, 'exec', 'vitest', 'run', ...args.map((a) => relativeTo(pkg.dir, a))],
        });
      }
    }
  }

  if (want('pytest') && (plan.pytest.all || plan.pytest.files.length > 0)) {
    const args = plan.pytest.all ? null : compress(plan.pytest.files, inventory.pytest, SERVER);
    commands.push({
      kind: 'pytest',
      title:
        args === null ? 'server tests, all' : `server tests, ${plan.pytest.files.length} file(s)`,
      command: 'uv',
      args: [
        'run',
        '--directory',
        SERVER,
        'pytest',
        ...(args ?? []).map((file) => relativeTo(SERVER, file)),
      ],
    });
  }

  if (want('e2e') && (plan.e2e.all || plan.e2e.files.length > 0)) {
    const args = plan.e2e.all ? null : compress(plan.e2e.files, inventory.e2e, DESKTOP);
    const desktop = packages.find((candidate) => candidate.dir === DESKTOP)?.name ?? DESKTOP;
    commands.push({
      kind: 'e2e',
      title: 'desktop build, for E2E',
      command: 'pnpm',
      args: ['--filter', desktop, 'build'],
    });
    commands.push({
      kind: 'e2e',
      title: args === null ? 'E2E, all' : `E2E, ${plan.e2e.files.length} spec(s)`,
      command: 'pnpm',
      args: [
        '--filter',
        desktop,
        'exec',
        'playwright',
        'test',
        ...(args ?? []).map((file) => relativeTo(DESKTOP, file)),
      ],
    });
  }
  return commands;
}
