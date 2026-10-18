// Tests for the test areas and the selector (scripts/test-areas.mjs, scripts/test-select.mjs),
// run by the root `pnpm test` through node:test.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AREAS, NO_TESTS, WIDEN } from './test-areas.mjs';
import { inventoryOf, vitestPackages, walk } from './test-inventory.mjs';
import {
  commandsFor,
  compress,
  globToRegExp,
  matches,
  planAreas,
  planChanges,
} from './test-select.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const E2E = 'apps/desktop/tests/e2e';
const UNIT = 'apps/desktop/tests/unit';
const R = 'apps/desktop/src/renderer/src';
const PY = 'services/server/tests';

// A small checkout: a few tests of each kind, at their real paths.
const inventory = {
  unit: [
    `${UNIT}/board/board-panel.test.tsx`,
    `${UNIT}/session-tiles.test.tsx`,
    `${UNIT}/library.test.tsx`,
    'packages/shared/tests/i18n.test.ts',
  ],
  e2e: [
    `${E2E}/board/board-canvas.spec.ts`,
    `${E2E}/board/live-board.spec.ts`,
    `${E2E}/fake-tutor.spec.ts`,
    `${E2E}/library.spec.ts`,
    `${E2E}/new-session.spec.ts`,
    `${E2E}/paper-fake-clip.spec.ts`,
    `${E2E}/paper-states.spec.ts`,
    `${E2E}/session-layout.spec.ts`,
    `${E2E}/shell.spec.ts`,
    `${E2E}/voice-conversation.spec.ts`,
  ],
  pytest: [
    `${PY}/board/test_history.py`,
    `${PY}/domains/test_machine.py`,
    `${PY}/test_sessions.py`,
    `${PY}/test_tables.py`,
    `${PY}/vision/test_contract.py`,
    `${PY}/vision/test_gate.py`,
    `${PY}/voice/test_bot_pipeline.py`,
    `${PY}/voice/test_director.py`,
  ],
  node: ['scripts/paper-env.test.mjs', 'scripts/test-select.test.mjs'],
};
const packages = [
  {
    dir: 'apps/desktop',
    name: '@tassel/desktop',
    uses: ['packages/shared', 'packages/paper-synth'],
  },
  { dir: 'packages/paper-synth', name: '@tassel/paper-synth', uses: [] },
  { dir: 'packages/shared', name: '@tassel/shared', uses: [] },
];
const plan = (files, exists) => planChanges(files, { inventory, packages, exists });
const unitOf = (result, dir) => result.unit.find((entry) => entry.dir === dir);
const none = { all: false, files: [] };

test('globs: * stays in a directory, ** crosses them, {a,b} picks either', () => {
  assert.ok(matches('a/b.ts', ['a/*.ts']));
  assert.ok(!matches('a/c/b.ts', ['a/*.ts']));
  assert.ok(matches('a/c/d/b.ts', ['a/**']));
  assert.ok(matches('a/b.ts', ['a/**/b.ts']));
  assert.ok(matches('a/x/y/b.ts', ['a/**/b.ts']));
  assert.ok(matches('t/x.test.tsx', ['t/{x,y}.test.{ts,tsx}']));
  assert.ok(!matches('t/z.test.ts', ['t/{x,y}.test.{ts,tsx}']));
  assert.ok(!matches('a.b', ['a?b']), 'only *, ** and braces are special');
  assert.equal(globToRegExp('a.ts').test('aXts'), false);
});

test('a board source runs its importers and the board specs, and no server tests', () => {
  const result = plan([`${R}/board/BoardPanel.tsx`]);
  assert.deepEqual(result.files[0].areas, ['board']);
  assert.deepEqual(unitOf(result, 'apps/desktop').related, [`${R}/board/BoardPanel.tsx`]);
  assert.equal(unitOf(result, 'packages/shared'), undefined);
  assert.deepEqual(result.e2e.files, [
    `${E2E}/board/board-canvas.spec.ts`,
    `${E2E}/board/live-board.spec.ts`,
  ]);
  assert.deepEqual(result.pytest, none);
  assert.deepEqual(result.node, none);
});

test('the session stage runs the session screen specs', () => {
  const result = plan([`${R}/features/session/Stage.tsx`, `${R}/components/FloatingTile.tsx`]);
  assert.deepEqual(result.areas, ['session']);
  assert.deepEqual(result.e2e.files, [
    `${E2E}/fake-tutor.spec.ts`,
    `${E2E}/session-layout.spec.ts`,
  ]);
});

test('a server voice change runs the voice tests and the voice specs, no unit tests', () => {
  const result = plan(['services/server/src/tassel/voice/bot.py']);
  assert.deepEqual(result.unit, []);
  assert.deepEqual(result.pytest.files, [
    `${PY}/voice/test_bot_pipeline.py`,
    `${PY}/voice/test_director.py`,
  ]);
  assert.deepEqual(result.e2e.files, [
    `${E2E}/board/live-board.spec.ts`,
    `${E2E}/voice-conversation.spec.ts`,
  ]);
});

test('a server frames change runs only the specs that upload frames', () => {
  const result = plan(['services/server/src/tassel/frames/jpeg.py']);
  assert.deepEqual(result.areas, ['paper']);
  assert.deepEqual(result.e2e.files, [`${E2E}/paper-fake-clip.spec.ts`]);
  assert.deepEqual(plan([`${R}/paper/paper-store.ts`]).e2e.files, [
    `${E2E}/paper-fake-clip.spec.ts`,
    `${E2E}/paper-states.spec.ts`,
  ]);
});

test('a changed test runs alone; a changed helper runs its whole area', () => {
  assert.deepEqual(plan([`${PY}/vision/test_gate.py`]).pytest.files, [`${PY}/vision/test_gate.py`]);
  assert.deepEqual(plan([`${PY}/vision/conftest.py`]).pytest.files, [
    `${PY}/vision/test_contract.py`,
    `${PY}/vision/test_gate.py`,
  ]);
  assert.deepEqual(plan([`${E2E}/shell.spec.ts`]).e2e.files, [`${E2E}/shell.spec.ts`]);
  assert.deepEqual(plan([`${E2E}/board/paper-probe.tsx`]).e2e.files, [
    `${E2E}/board/board-canvas.spec.ts`,
    `${E2E}/board/live-board.spec.ts`,
  ]);
  // A unit test is its own importer: vitest related runs it.
  const unit = plan([`${UNIT}/session-tiles.test.tsx`]);
  assert.deepEqual(unitOf(unit, 'apps/desktop').related, [`${UNIT}/session-tiles.test.tsx`]);
  assert.deepEqual(unit.e2e, none);
});

test('UI strings reach every package that imports them and the screen specs', () => {
  const result = plan(['packages/shared/src/i18n/en.json']);
  assert.deepEqual(result.files[0].areas, []);
  assert.equal(result.files[0].widen.length, 1);
  assert.deepEqual(unitOf(result, 'apps/desktop').related, ['packages/shared/src/i18n/en.json']);
  assert.deepEqual(unitOf(result, 'packages/shared').related, ['packages/shared/src/i18n/en.json']);
  assert.equal(unitOf(result, 'packages/paper-synth'), undefined);
  assert.deepEqual(result.e2e.files, [
    `${E2E}/fake-tutor.spec.ts`,
    `${E2E}/library.spec.ts`,
    `${E2E}/new-session.spec.ts`,
    `${E2E}/session-layout.spec.ts`,
    `${E2E}/shell.spec.ts`,
  ]);
  assert.deepEqual(result.pytest, none);
});

test('shared fixtures the server reads run the server tests that read them', () => {
  const result = plan(['packages/shared/src/vision/fixtures.json']);
  assert.deepEqual(result.areas, ['domains', 'vision']);
  assert.deepEqual(result.pytest.files, [
    `${PY}/domains/test_machine.py`,
    `${PY}/vision/test_contract.py`,
    `${PY}/vision/test_gate.py`,
  ]);
  assert.deepEqual(unitOf(result, 'apps/desktop').related, [
    'packages/shared/src/vision/fixtures.json',
  ]);
});

test('a migration runs every server test and the library specs', () => {
  const result = plan(['services/server/alembic/versions/0006_new.py']);
  assert.equal(result.pytest.all, true);
  assert.deepEqual(result.e2e.files, [`${E2E}/library.spec.ts`, `${E2E}/new-session.spec.ts`]);
  assert.deepEqual(result.unit, []);
});

test('harness and dependency files widen to whole suites', () => {
  assert.equal(plan([`${E2E}/fixtures.ts`]).e2e.all, true);
  assert.equal(plan([`${PY}/conftest.py`]).pytest.all, true);
  assert.equal(plan(['services/server/src/tassel/config.py']).pytest.all, true);
  assert.equal(unitOf(plan([`${UNIT}/setup.ts`]), 'apps/desktop').all, true);
  const lock = plan(['pnpm-lock.yaml']);
  assert.deepEqual(
    lock.unit.map(({ dir, all }) => [dir, all]),
    packages.map(({ dir }) => [dir, true]),
  );
  assert.equal(lock.e2e.all, true);
  assert.equal(lock.node.all, true);
  assert.deepEqual(lock.pytest, none);
});

test('a script change runs the script tests; docs run nothing', () => {
  assert.equal(plan(['scripts/dev.mjs']).node.all, true);
  const docs = plan(['docs/superpowers/plans/p6.md', 'PRODUCT.md', 'biome.json']);
  assert.deepEqual(
    docs.files.map(({ note }) => note),
    ['no tests', 'no tests', 'no tests'],
  );
  assert.deepEqual(commandsFor(docs, { inventory, packages }), []);
});

test('a file in no area is reported, and the server falls back to its whole suite', () => {
  const server = plan(['services/server/src/tassel/brand_new.py']);
  assert.equal(server.files[0].note, 'in no area: every server test');
  assert.equal(server.pytest.all, true);
  const desktop = plan([`${R}/brand-new/thing.ts`]);
  assert.match(desktop.files[0].note, /import graph only/);
  assert.deepEqual(unitOf(desktop, 'apps/desktop').related, [`${R}/brand-new/thing.ts`]);
  assert.deepEqual(desktop.e2e, none);
});

test("a deleted file selects its area but isn't passed to vitest related", () => {
  const result = plan([`${R}/board/Gone.tsx`], () => false);
  assert.deepEqual(result.unit, []);
  assert.equal(result.e2e.files.length, 2);
});

test('commands: node, unit, server, then the build right before E2E', () => {
  const result = plan([
    `${R}/board/BoardPanel.tsx`,
    'packages/shared/src/i18n/en.json',
    `${PY}/vision/test_gate.py`,
    'scripts/dev.mjs',
  ]);
  const commands = commandsFor(result, { inventory, packages });
  assert.deepEqual(
    commands.map(({ command, args }) => [command, ...args].join(' ')),
    [
      'node --test scripts/paper-env.test.mjs scripts/test-select.test.mjs',
      'pnpm --filter @tassel/desktop exec vitest related --run --passWithNoTests src/renderer/src/board/BoardPanel.tsx ../../packages/shared/src/i18n/en.json',
      'pnpm --filter @tassel/shared exec vitest related --run --passWithNoTests src/i18n/en.json',
      'uv run --directory services/server pytest tests/vision/test_gate.py',
      'pnpm --filter @tassel/desktop build',
      'pnpm --filter @tassel/desktop exec playwright test tests/e2e/board/ tests/e2e/fake-tutor.spec.ts tests/e2e/library.spec.ts tests/e2e/new-session.spec.ts tests/e2e/session-layout.spec.ts tests/e2e/shell.spec.ts',
    ],
  );
  const noE2e = commandsFor(result, { inventory, packages, only: ['unit', 'pytest', 'node'] });
  assert.ok(
    noE2e.every(({ kind }) => kind !== 'e2e'),
    'no build without E2E',
  );
  assert.deepEqual(
    commandsFor(plan([`${E2E}/fixtures.ts`]), { inventory, packages, only: ['e2e'] }).map(
      ({ args }) => args,
    ),
    [
      ['--filter', '@tassel/desktop', 'build'],
      ['--filter', '@tassel/desktop', 'exec', 'playwright', 'test'],
    ],
  );
});

test('compress: a fully selected directory becomes dir/, everything becomes null', () => {
  const all = ['r/a/1', 'r/a/2', 'r/b/1', 'r/c'];
  assert.equal(compress(all, all, 'r'), null);
  assert.deepEqual(compress(['r/a/1', 'r/a/2', 'r/c'], all, 'r'), ['r/a/', 'r/c']);
  assert.deepEqual(compress(['r/a/1', 'x/y'], all, 'r'), ['r/a/1', 'x/y']);
});

test('test:area runs every test of the named areas', () => {
  const result = planAreas(['board', 'api'], { inventory, packages });
  assert.deepEqual(unitOf(result, 'apps/desktop').files, [`${UNIT}/board/board-panel.test.tsx`]);
  assert.deepEqual(result.pytest.files, [
    `${PY}/board/test_history.py`,
    `${PY}/test_sessions.py`,
    `${PY}/test_tables.py`,
  ]);
  assert.deepEqual(result.e2e.files, [
    `${E2E}/board/board-canvas.spec.ts`,
    `${E2E}/board/live-board.spec.ts`,
    `${E2E}/library.spec.ts`,
    `${E2E}/new-session.spec.ts`,
  ]);
  assert.throws(() => planAreas(['nope'], { inventory, packages }), /unknown area "nope"/);
});

// The checkout itself: every test and every source file has a place.
const realPackages = vitestPackages(root);
const real = inventoryOf(root, realPackages);

test('the checkout has tests of every kind to place', () => {
  assert.ok(real.unit.length > 100 && real.e2e.length > 10 && real.pytest.length > 50);
  assert.ok(real.node.includes('scripts/test-select.test.mjs'), 'pnpm test runs this file');
  assert.deepEqual(realPackages.map(({ dir }) => dir).sort(), [
    'apps/desktop',
    'apps/web',
    'packages/paper-synth',
    'packages/shared',
  ]);
});

for (const kind of ['unit', 'e2e', 'pytest', 'node']) {
  test(`every ${kind} test belongs to an area`, () => {
    const homeless = real[kind].filter((file) => !AREAS.some((area) => matches(file, area[kind])));
    assert.deepEqual(homeless, [], `add these to an area's ${kind} list in scripts/test-areas.mjs`);
  });
}

test('every source file selects an area or a shared rule', () => {
  const sources = [
    ...walk(root, 'apps/desktop/src', () => true),
    ...walk(root, 'apps/desktop/config', () => true),
    ...walk(root, 'services/server/src', (path) => path.endsWith('.py') || path.endsWith('.json')),
    ...walk(root, 'services/server/alembic', (path) => path.endsWith('.py')),
    ...walk(root, 'packages/shared/src', () => true),
    ...walk(root, 'packages/shared/scripts', () => true),
    ...walk(root, 'packages/paper-synth/src', () => true),
    ...walk(root, 'scripts', () => true),
  ];
  assert.ok(sources.length > 300);
  const placed = (file) =>
    AREAS.some((area) => matches(file, area.app) || matches(file, area.server)) ||
    WIDEN.some((rule) => matches(file, rule.match)) ||
    matches(file, NO_TESTS);
  const homeless = sources.filter((file) => !placed(file));
  assert.deepEqual(
    homeless,
    [],
    "add these to an area's app or server list in scripts/test-areas.mjs",
  );
});

test('area names are unique and every shared rule names real areas', () => {
  const names = AREAS.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length);
  for (const rule of WIDEN) {
    for (const kind of ['e2e', 'pytest']) {
      if (Array.isArray(rule[kind]))
        for (const name of rule[kind]) assert.ok(names.includes(name), name);
    }
  }
});
