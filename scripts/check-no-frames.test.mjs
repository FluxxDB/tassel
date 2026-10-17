// Tests for scripts/check-no-frames.mjs, run by the root `pnpm test` through node:test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-no-frames.mjs');
const guard = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const listed = (result) =>
  result.stderr
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => line.trim());

test('refuses every camera-frame extension, in any case', () => {
  // The plan's four, then the five that ruling P3-R21 adds.
  const frames = [
    'a.jpg',
    'b.JPEG',
    'c.Mjpeg',
    'd.y4m',
    'e.mjpg',
    'f.JFIF',
    'g.jpe',
    'h.heic',
    'i.HEIF',
  ];
  const result = guard(['--paths', ...frames]);
  assert.equal(result.status, 1);
  assert.deepEqual(listed(result), frames);
});

test('lets every other path through', () => {
  const result = guard(['--paths', 'docs/x.png', 'notes.jpg.txt', 'x.jpg/notes.md', 'heic']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'check-no-frames: no camera frames tracked');
});

test('the tracked tree holds no camera frame', () => {
  const result = guard([]);
  assert.equal(result.status, 0, result.stderr);
});
