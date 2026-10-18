// Tassel's test areas: which tests belong to which part of the product, and which files select
// them. `pnpm test:changed` and `pnpm test:area` (scripts/test-changed.mjs) read this file;
// scripts/test-select.test.mjs fails when a test or source file belongs to no area, and names
// the file to place here.
//
// Paths are repo-relative globs: `*` stays within a directory, `**` crosses directories and
// `{a,b}` is either. An area may list:
//   app     desktop and shared sources. A change runs the area's E2E specs; the unit tests come
//           from Vitest's import graph (`vitest related`), not from this list.
//   server  server sources (and the shared fixtures the server reads). A change runs the area's
//           pytest files and its E2E specs, since E2E runs against the real server.
//   unit    Vitest test files (and their helpers) for `pnpm test:area`.
//   e2e     Playwright specs and their helpers. A changed spec runs alone; a changed helper runs
//           every spec of the area.
//   pytest  server test files and their helpers, the same way.
//   serverE2e  the specs a server change runs, when they're fewer than `e2e`.
//   node    node:test files under scripts/ (a change to any script runs them all; they're quick).
// A file may sit in more than one area.

const D = 'apps/desktop';
const R = `${D}/src/renderer/src`;
const UNIT = `${D}/tests/unit`;
const E2E = `${D}/tests/e2e`;
const S = 'services/server';
const SRC = `${S}/src/tassel`;
const PY = `${S}/tests`;

export const AREAS = [
  {
    name: 'screen',
    title: 'Screen capture, desktop overlay and reset interruption',
    app: [
      `${D}/src/main/overlay/**`,
      `${D}/playwright.screen.config.ts`,
      `${D}/src/shared/screen-bridge.ts`,
      `${R}/screen/**`,
      `${R}/overlay/**`,
      `${R}/board/tldraw/**`,
      `${R}/board/engine.ts`,
    ],
    server: [`${SRC}/screen/**`],
    unit: [`${UNIT}/screen/**`],
    e2e: [`${E2E}/screen-overlay.spec.ts`],
    pytest: [`${PY}/screen/**`],
  },
  {
    name: 'shell',
    title:
      'App shell: main process, preload bridge, protocol, IPC, token store, app frame, components',
    app: [
      `${D}/src/main/*.ts`,
      `${D}/src/preload/**`,
      `${D}/src/shared/bridge.ts`,
      `${D}/src/renderer/index.html`,
      `${D}/config/**`,
      `${R}/{main.tsx,i18n.ts}`,
      `${R}/{app,lib,styles}/**`,
      `${R}/components/{Button,Chip,IconButton,SegmentedControl,Sheet,Wordmark,icons}.tsx`,
    ],
    unit: [
      `${UNIT}/{api,app-protocol,cn,components,config,downloads,i18n,ipc,route-store,token-store,windows}.test.{ts,tsx}`,
      'packages/shared/tests/{i18n,tokens}.test.ts',
    ],
    e2e: [`${E2E}/shell.spec.ts`],
  },
  {
    name: 'library',
    title: 'Library and the new session sheet',
    app: [`${R}/features/{library,new-session}/**`, `${R}/lib/api.tsx`],
    unit: [`${UNIT}/{group-by-topic,library,new-session,relative-time}.test.{ts,tsx}`],
    e2e: [`${E2E}/{library,new-session}.spec.ts`],
  },
  {
    name: 'session',
    title: 'Session screen: stage, floating tiles, captions, dock, scripted fake tutor',
    app: [
      `${R}/features/session/**`,
      `${R}/components/{FloatingTile.tsx,use-reduced-motion.ts}`,
      `${R}/tutor/*.ts`,
      `${R}/tutor/scripts/dfa-opening.json`,
    ],
    unit: [
      `${UNIT}/{fake-client,floating-tile,session-screen,session-tiles,stage-store,tutor-contract,use-elapsed,use-tutor-session}.test.{ts,tsx}`,
    ],
    e2e: [`${E2E}/{fake-tutor,session-layout}.spec.ts`],
  },
  {
    name: 'board',
    title: 'Board: tldraw canvas, scenes, beats, marks, diagrams, automata',
    app: [
      `${R}/board/**`,
      `${R}/tutor/scripts/{board,diagram,marks,image,trace}-demo.json`,
      `${R}/tutor/scripts/board-snapshot.json`,
    ],
    server: [`${SRC}/{board,beats}/**`, 'packages/shared/src/beats/**'],
    unit: [`${UNIT}/board/**`, 'packages/shared/tests/beats.test.ts'],
    e2e: [`${E2E}/board/**`],
    pytest: [`${PY}/{board,beats}/**`],
  },
  {
    name: 'paper',
    title: 'Paper and the camera: capture sources, detector worker, frame uploads, the fake clip',
    app: [
      `${D}/src/main/paper/**`,
      `${D}/src/shared/paper-bridge.ts`,
      `${R}/paper/**`,
      'packages/paper-synth/{src,scripts}/**',
    ],
    server: [`${SRC}/frames/**`],
    unit: [
      `${UNIT}/paper/**`,
      `${UNIT}/{camera-workflow,capture-guard}.test.ts`,
      // The owner-only camera suite: only its unit-tested helpers run here, never the camera.
      `${D}/tests/camera/**`,
      'packages/paper-synth/tests/**',
    ],
    e2e: [`${E2E}/{capture-fake-devices,paper-*,webcam}.spec.ts`, `${E2E}/paper/**`],
    pytest: [`${PY}/frames/**`],
    // The specs that upload frames.
    serverE2e: [`${E2E}/{paper-fake-clip,paper-helper-clip,webcam}.spec.ts`],
  },
  {
    name: 'vision',
    title: 'Vision: paper and student-image marks, gates, transcription, the read-back card',
    app: [`${R}/vision/**`],
    server: [`${SRC}/vision/**`, 'packages/shared/src/vision/**'],
    unit: [`${UNIT}/vision/**`, 'packages/shared/tests/vision-contract.test.ts'],
    pytest: [
      `${PY}/vision/**`,
      `${PY}/image_marks_fixtures.py`,
      `${PY}/voice/test_pointer_marks.py`,
    ],
  },
  {
    name: 'voice',
    title: 'Voice and the live tutor: mic, live client, voice session, the bot pipeline',
    app: [
      `${D}/src/main/voice/**`,
      `${D}/src/shared/voice-bridge.ts`,
      `${R}/features/voice/**`,
      `${R}/tutor/live/**`,
      `${D}/tests/fixtures/audio/**`,
    ],
    server: [`${SRC}/voice/**`, 'packages/shared/src/voice/**'],
    unit: [
      `${UNIT}/{live,voice-main}/**`,
      `${UNIT}/session-voice.test.tsx`,
      'packages/shared/tests/voice-messages.test.ts',
    ],
    e2e: [
      `${E2E}/{fake-mic,voice-bundle,voice-conversation}.spec.ts`,
      `${E2E}/board/live-board.spec.ts`,
    ],
    pytest: [`${PY}/voice/**`, `${PY}/evals/**`],
  },
  {
    name: 'chat',
    title: 'The chat sidebar: conversation, typed messages, student images, saved history',
    app: [`${R}/features/chat/**`],
    server: [`${SRC}/chat/**`],
    unit: [`${UNIT}/chat/**`],
    e2e: [`${E2E}/chat*.spec.ts`],
    pytest: [`${PY}/chat/**`],
  },
  {
    name: 'evals',
    title: 'The live tutor eval: scenarios, page fixtures, checks, the budget, reports',
    server: [`${SRC}/evals/**`],
    // The voice area runs these too: the fake-provider run drives the whole voice pipeline.
    pytest: [`${PY}/evals/**`],
  },
  {
    name: 'avatar',
    title: 'Avatar, tutor settings and learner memory',
    app: [`${R}/avatar/**`],
    server: [
      `${SRC}/learner_memory.py`,
      `${SRC}/learner_personalization.py`,
      `${SRC}/api/memory.py`,
      `${SRC}/scripts/export_avatar_voices.py`,
    ],
    unit: [`${UNIT}/{avatar,avatar-motion,memory,personality,voice-preview}.test.{ts,tsx}`],
    e2e: [`${E2E}/{avatar,memory-close}.spec.ts`],
    pytest: [
      `${PY}/test_learner_memory.py`,
      `${PY}/test_tutor_personality.py`,
      `${PY}/scripts/test_avatar_voices.py`,
    ],
  },
  {
    name: 'api',
    title: 'Server API and storage: app, auth, devices, sessions, tables, the typed client',
    app: ['packages/shared/src/api/**'],
    server: [
      `${SRC}/{__init__,__main__,app,auth,models}.py`,
      `${SRC}/api/{__init__,devices,health,sessions}.py`,
      `${SRC}/storage/**`,
      `${SRC}/scripts/{__init__,export_openapi}.py`,
    ],
    unit: ['packages/shared/tests/api-client.test.ts'],
    e2e: [`${E2E}/{library,new-session}.spec.ts`],
    pytest: [
      `${PY}/test_{db,devices,export_openapi,health,isolation,main,openapi,sessions,tables}.py`,
    ],
  },
  {
    name: 'domains',
    title: 'Tutoring domains on the server: DFAs, regexes, networks',
    server: [`${SRC}/domains/**`, 'packages/shared/src/vision/fixtures.json'],
    pytest: [`${PY}/domains/**`],
  },
  {
    name: 'tooling',
    title:
      'Repo scripts and the Docker backend: dev, live, start, camera launch, checks, test selection',
    app: [
      'scripts/**',
      'docker-compose.yml',
      `${S}/{Dockerfile,.dockerignore,no-provider-keys.env}`,
    ],
    // The server container's start, and the settings its Compose environment must cover.
    server: [`${SRC}/scripts/{container,ensure_database}.py`, `${SRC}/{voice,vision}/settings.py`],
    node: ['scripts/*.test.mjs'],
    pytest: [`${PY}/scripts/{test_container,test_docker_setup}.py`],
  },
];

// Files that many areas share. Each rule adds to what the areas select: `unit` names Vitest
// packages to run in full, `e2e` and `pytest` take 'all' or area names, `node` takes 'all'.
export const WIDEN = [
  {
    why: 'workspace dependencies',
    match: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.node-version'],
    unit: 'all',
    e2e: 'all',
    node: 'all',
  },
  {
    why: 'desktop build and dependencies',
    match: [`${D}/{package.json,electron.vite.config.ts,tsconfig*.json}`],
    unit: [D],
    e2e: 'all',
  },
  {
    why: 'Vitest setup',
    match: [`${D}/vitest.config.mts`, `${UNIT}/setup.ts`],
    unit: [D],
  },
  {
    why: 'E2E harness',
    match: [`${D}/playwright.config.ts`, `${E2E}/{capture-guard,fixtures,global-setup}.ts`],
    e2e: 'all',
  },
  {
    why: 'shared package exports and build',
    match: ['packages/shared/{package.json,tsconfig.json}'],
    unit: ['packages/shared', D],
    e2e: 'all',
  },
  {
    why: 'paper-synth package build',
    match: ['packages/paper-synth/{package.json,tsconfig.json}'],
    unit: ['packages/paper-synth', D],
  },
  {
    why: 'UI strings: every screen renders them and some specs fit them',
    match: ['packages/shared/src/i18n/**', 'packages/shared/scripts/check-i18n.ts'],
    e2e: ['shell', 'library', 'session'],
  },
  {
    why: 'design tokens and fonts: every screen uses them',
    match: ['packages/shared/src/{styles,fonts}/**', 'packages/shared/scripts/copy-fonts.mjs'],
    e2e: ['shell', 'library', 'session'],
  },
  {
    why: 'migrations: every server test runs on the migrated schema, and E2E migrates tassel_e2e',
    match: [`${S}/alembic/**`, `${S}/alembic.ini`],
    pytest: 'all',
    e2e: ['api'],
  },
  {
    why: 'server dependencies, settings and test setup',
    match: [`${S}/{pyproject.toml,uv.lock}`, `${SRC}/config.py`, `${PY}/conftest.py`],
    pytest: 'all',
  },
];

// Files no test covers: docs, records, editor and lint settings, the owner-only camera config.
export const NO_TESTS = [
  '**/*.md',
  'docs/**',
  'graphify-out/**',
  '.impeccable/**',
  '.claude/**',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  'biome.json',
  'tsconfig.base.json',
  `${D}/playwright.camera.config.ts`,
  `${S}/src/tassel/voice/playbook.md`,
];
