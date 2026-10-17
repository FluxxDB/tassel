// Generate once on macOS; all platforms can validate the committed PCM fixtures.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const dir = dirname(fileURLToPath(import.meta.url));
const timeline = JSON.parse(readFileSync(join(dir, 'timelines.json'), 'utf8'));
const rate = timeline.sample_rate;
assert.equal(rate, 16000);

function readPcm(file) {
  const wav = readFileSync(file);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', file);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE', file);
  assert.equal(wav.readUInt32LE(4) + 8, wav.length, file);
  let pcm;
  let format;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString('ascii', at, at + 4);
    const length = wav.readUInt32LE(at + 4);
    assert.ok(at + 8 + length <= wav.length, `Truncated chunk: ${file}`);
    const bytes = wav.subarray(at + 8, at + 8 + length);
    if (id === 'fmt ') format = bytes;
    if (id === 'data') pcm = bytes;
    at += 8 + length + (length % 2);
  }
  assert.ok(format && pcm, `Missing PCM chunks: ${file}`);
  assert.equal(format.readUInt16LE(0), 1, 'PCM');
  assert.equal(format.readUInt16LE(2), 1, 'mono');
  assert.equal(format.readUInt32LE(4), rate, '16 kHz');
  assert.equal(format.readUInt32LE(8), rate * 2, 'byte rate');
  assert.equal(format.readUInt16LE(12), 2, 'block alignment');
  assert.equal(format.readUInt16LE(14), 16, '16 bit');
  return pcm;
}

function writePcm(file, pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([header, pcm]));
}

function generate() {
  const temp = mkdtempSync(join(tmpdir(), 'tassel-voice-fixtures-'));
  try {
    // Stage every output first: missing voices or overly long clips never replace committed files.
    const generated = [];
    for (const [name, fixture] of Object.entries(timeline.fixtures)) {
      const pcm = Buffer.alloc((fixture.total_ms * rate * 2) / 1000);
      let previousEnd = 0;
      for (const [index, clip] of fixture.clips.entries()) {
        const file = join(temp, `${name}-${index}.wav`);
        const result = spawn.sync(
          'say',
          [
            '-v',
            fixture.voice,
            '-o',
            file,
            '--file-format=WAVE',
            '--data-format=LEI16@16000',
            clip.say,
          ],
          { encoding: 'utf8', timeout: 60_000 },
        );
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `say ${fixture.voice} failed: ${result.stderr}`);
        const speech = readPcm(file);
        assert.ok(
          speech.some((byte) => byte !== 0),
          `Empty speech: ${name}`,
        );
        const at = (clip.at_ms * rate * 2) / 1000;
        assert.ok(at >= previousEnd, `Overlapping clips: ${name}`);
        assert.ok(
          at + speech.length <= pcm.length - rate * 2,
          `Clip needs more room before trailing silence: ${name}`,
        );
        speech.copy(pcm, at);
        previousEnd = at + speech.length;
      }
      generated.push([name, pcm]);
    }
    for (const [name, pcm] of generated) writePcm(join(dir, `${name}.wav`), pcm);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.platform === 'darwin' && !process.argv.includes('--check')) generate();
for (const [name, fixture] of Object.entries(timeline.fixtures)) {
  const pcm = readPcm(join(dir, `${name}.wav`));
  assert.ok(
    Math.abs((pcm.length * 1000) / (rate * 2) - fixture.total_ms) <= 20,
    `Duration: ${name}`,
  );
  assert.ok(
    pcm.subarray(-rate * 2).every((byte) => byte === 0),
    `Trailing silence: ${name}`,
  );
  for (const clip of fixture.clips) {
    const at = (clip.at_ms * rate * 2) / 1000;
    assert.ok(
      pcm.subarray(at, at + rate * 2).some((byte) => byte !== 0),
      `Missing speech: ${name}`,
    );
  }
  console.log(`${name}: PCM16 mono ${rate} Hz, ${fixture.total_ms} ms, silent tail OK`);
}
