// Writes a synthetic clip and its truth:
//
//   node packages/paper-synth/scripts/gen-clip.ts --variant <name> --out <dir>
//     [--width 960 --height 720 --quality 80 --no-noise]
//
// The files are <dir>/<variant>-<w>x<h>-<hash8>.mjpeg and .truth.json, where hash8 is the first 8
// hex digits of the SHA-256 of the options and GENERATOR_VERSION. When both already exist the
// work is skipped. Either way it prints one JSON line: {"mjpeg","truth","frames","sha256"}.
// Node runs this file directly (type stripping), on macOS and Windows.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  GENERATOR_VERSION,
  makeClip,
  truthJson,
  VARIANTS,
  type VariantName,
  writeMjpeg,
} from '../src/index.ts';

const FPS = 30;
const MOTION_FPS = 15;

function fail(message: string): never {
  console.error(`gen-clip: ${message}`);
  process.exit(2);
}

function integer(name: string, text: string, min: number, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`--${name} must be a whole number from ${min} to ${max}, got "${text}"`);
  }
  return value;
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function main(): Promise<void> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      options: {
        variant: { type: 'string' },
        out: { type: 'string' },
        width: { type: 'string', default: '960' },
        height: { type: 'string', default: '720' },
        quality: { type: 'string', default: '80' },
        'no-noise': { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const variant = String(values.variant ?? '');
  if (!(VARIANTS as readonly string[]).includes(variant)) {
    fail(`--variant must be one of ${VARIANTS.join(', ')}; got "${variant}"`);
  }
  if (!values.out) fail('--out <dir> is required');
  const width = integer('width', String(values.width), 16, 4096);
  const height = integer('height', String(values.height), 16, 4096);
  const quality = integer('quality', String(values.quality), 1, 100);
  const noise = values['no-noise'] !== true;

  const options = { variant, width, height, quality, noise, fps: FPS, motionFps: MOTION_FPS };
  const hash8 = createHash('sha256')
    .update(JSON.stringify({ ...options, generatorVersion: GENERATOR_VERSION }))
    .digest('hex')
    .slice(0, 8);
  const base = resolve(String(values.out), `${variant}-${width}x${height}-${hash8}`);
  const mjpeg = `${base}.mjpeg`;
  const truth = `${base}.truth.json`;
  const clip = makeClip(variant as VariantName);
  const frames = Math.round((clip.durationMs / 1000) * FPS);

  let sha256: string;
  if (existsSync(mjpeg) && existsSync(truth)) {
    sha256 = await fileSha256(mjpeg);
  } else {
    await mkdir(String(values.out), { recursive: true });
    const result = await writeMjpeg(clip, mjpeg, {
      width,
      height,
      quality,
      noise,
      fps: FPS,
      motionFps: MOTION_FPS,
    });
    sha256 = result.sha256;
    await writeFile(
      `${truth}.partial`,
      `${JSON.stringify(truthJson(clip, width, height), null, 2)}\n`,
    );
    await rename(`${truth}.partial`, truth);
  }
  console.log(JSON.stringify({ mjpeg, truth, frames, sha256 }));
}

await main();
