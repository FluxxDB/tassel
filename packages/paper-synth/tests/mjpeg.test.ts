import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENERATOR_VERSION, makeClip, writeMjpeg } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'paper-synth-mjpeg-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Splits an MJPEG file into its JPEGs by walking the markers, the way a strict parser does:
 * each frame must start with SOI, its segments must carry their lengths, and its scan must end
 * at EOI. Throws on any byte that isn't part of a frame.
 */
function splitJpegs(b: Uint8Array): Array<[number, number]> {
  const frames: Array<[number, number]> = [];
  let i = 0;
  while (i < b.length) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8) throw new Error(`no SOI at byte ${i}`);
    const start = i;
    i += 2;
    for (;;) {
      if (b[i] !== 0xff) throw new Error(`no marker at byte ${i}`);
      const marker = b[i + 1] ?? 0;
      if (marker === 0xd9) {
        i += 2;
        break;
      }
      const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
      i += 2 + length;
      if (marker === 0xda) {
        // Entropy-coded data runs to the next marker that isn't a stuffed 00 or a restart.
        while (i < b.length) {
          const next = b[i + 1] ?? 0;
          if (b[i] === 0xff && next !== 0x00 && (next < 0xd0 || next > 0xd7)) break;
          i++;
        }
      }
      if (i >= b.length) throw new Error('frame runs past the end of the file');
    }
    frames.push([start, i]);
  }
  return frames;
}

describe('writeMjpeg', () => {
  const path = join(dir, 'dfa-short-960x720.mjpeg');
  let bytes: Buffer;
  let result: { frames: number; bytes: number; sha256: string };

  beforeAll(async () => {
    result = await writeMjpeg(makeClip('dfa-short'), path, { width: 960, height: 720 });
    bytes = readFileSync(path);
  }, 120_000);

  it('the MJPEG has durationMs/1000 × 30 frames, each SOI…EOI', () => {
    const frames = splitJpegs(bytes);
    expect(frames).toHaveLength((makeClip('dfa-short').durationMs / 1000) * 30);
    expect(result.frames).toBe(600);
    expect(result.bytes).toBe(bytes.length);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const [start, end] = frames[0] ?? [0, 0];
    const first = jpeg.decode(bytes.subarray(start, end), { useTArray: true });
    expect([first.width, first.height]).toEqual([960, 720]);
  });

  it('the MJPEG starts with FF D8 and ends with FF D9, with no byte outside a frame', () => {
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
    const frames = splitJpegs(bytes);
    let at = 0;
    for (const [start, end] of frames) {
      expect(start).toBe(at);
      at = end;
    }
    expect(at).toBe(bytes.length);
  });

  it('writes each rendered frame twice, and reuses the bytes of a repeated frame', () => {
    const frames = splitJpegs(bytes).map(([s, e]) => bytes.subarray(s, e));
    for (let k = 0; k + 1 < frames.length; k += 2) {
      expect(Buffer.compare(frames[k] as Buffer, frames[k + 1] as Buffer), `frame ${k}`).toBe(0);
    }
    // The page is blank and still until the hand enters at 5.6 s: one JPEG, repeated.
    expect(Buffer.compare(frames[0] as Buffer, frames[150] as Buffer)).toBe(0);
    // While the hand draws, every rendered frame differs.
    expect(Buffer.compare(frames[200] as Buffer, frames[202] as Buffer)).not.toBe(0);
  });
});

describe('gen-clip', () => {
  const script = join(here, '..', 'scripts', 'gen-clip.ts');
  const out = join(dir, 'clips');
  const run = () =>
    spawnSync(
      process.execPath,
      [script, '--variant', 'shadow-pass', '--out', out, '--width', '64', '--height', '48'],
      { encoding: 'utf8' },
    );

  it('writes the clip and its truth once, prints one JSON line, then skips the work', () => {
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const lines = first.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(Object.keys(line)).toEqual(['mjpeg', 'truth', 'frames', 'sha256']);
    expect(line.mjpeg).toMatch(/shadow-pass-64x48-[0-9a-f]{8}\.mjpeg$/);
    expect(line.truth).toBe(String(line.mjpeg).replace(/\.mjpeg$/, '.truth.json'));
    expect(line.frames).toBe(360);
    const mjpeg = readFileSync(String(line.mjpeg));
    expect(line.sha256).toBe(createHash('sha256').update(mjpeg).digest('hex'));
    const truth = JSON.parse(readFileSync(String(line.truth), 'utf8')) as Record<string, unknown>;
    expect(truth).toMatchObject({ name: 'shadow-pass', width: 64, height: 48 });
    expect(truth.generatorVersion).toBe(GENERATOR_VERSION);

    const written = statSync(String(line.mjpeg)).mtimeMs;
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout.trim())).toEqual(line);
    expect(statSync(String(line.mjpeg)).mtimeMs).toBe(written);
  });

  it('names a different file for different options', () => {
    const noisy = JSON.parse(run().stdout.trim()) as { mjpeg: string };
    const quiet = spawnSync(
      process.execPath,
      [script, '--variant', 'shadow-pass', '--out', out, '--width', '64', '--height', '48'].concat(
        '--no-noise',
      ),
      { encoding: 'utf8' },
    );
    expect(quiet.status, quiet.stderr).toBe(0);
    expect((JSON.parse(quiet.stdout.trim()) as { mjpeg: string }).mjpeg).not.toBe(noisy.mjpeg);
  });

  it('refuses an unknown variant', () => {
    const bad = spawnSync(process.execPath, [script, '--variant', 'nope', '--out', out], {
      encoding: 'utf8',
    });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/variant/);
  });
});
