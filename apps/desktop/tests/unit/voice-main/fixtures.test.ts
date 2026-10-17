import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import voice from '../../../../../packages/shared/src/voice/fixtures.json';

type Timeline = {
  sample_rate: number;
  fixtures: Record<
    string,
    {
      total_ms: number;
      scenario: [keyof typeof voice.scenario_lines, 'en' | 'es' | 'ko'] | null;
      clips: { at_ms: number; say: string; transcript?: string; heard?: boolean }[];
    }
  >;
};
const audioDir = join(__dirname, '../../fixtures/audio');

it('every WAV is PCM16 mono 16 kHz, lasts its timeline and ends in a full second of silence', () => {
  const timeline: Timeline = JSON.parse(readFileSync(join(audioDir, 'timelines.json'), 'utf8'));
  expect(Object.keys(timeline.fixtures)).toHaveLength(7);
  for (const [name, fixture] of Object.entries(timeline.fixtures)) {
    const wav = readFileSync(join(audioDir, `${name}.wav`));
    expect(wav.toString('ascii', 0, 4), name).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12), name).toBe('WAVE');
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length);
    let data: Buffer | undefined;
    let fmt: Buffer | undefined;
    for (let at = 12; at + 8 <= wav.length; ) {
      const size = wav.readUInt32LE(at + 4);
      const chunk = wav.subarray(at + 8, at + 8 + size);
      const id = wav.toString('ascii', at, at + 4);
      if (id === 'fmt ') fmt = chunk;
      if (id === 'data') data = chunk;
      at += 8 + size + (size % 2);
    }
    expect(fmt?.readUInt16LE(0)).toBe(1);
    expect(fmt?.readUInt16LE(2)).toBe(1);
    expect(fmt?.readUInt32LE(4)).toBe(16000);
    expect(fmt?.readUInt16LE(14)).toBe(16);
    expect(data).toBeDefined();
    if (!data) throw new Error(`No PCM data: ${name}`);
    expect(Math.abs(data.length / 32 - fixture.total_ms)).toBeLessThanOrEqual(20);
    expect(
      data.subarray(-32000).every((byte) => byte === 0),
      name,
    ).toBe(true);
    for (const clip of fixture.clips) {
      // A silent placeholder cannot stand in for speech in the live checks.
      expect(
        data.subarray(clip.at_ms * 32, (clip.at_ms + 1000) * 32).some((byte) => byte !== 0),
        name,
      ).toBe(true);
      expect(
        data
          .subarray(Math.max(0, clip.at_ms - 100) * 32, clip.at_ms * 32)
          .every((byte) => byte === 0),
        name,
      ).toBe(true);
    }
  }
});
it('heard transcripts are a prefix of Task 1 scenario_lines', () => {
  const timeline: Timeline = JSON.parse(readFileSync(join(audioDir, 'timelines.json'), 'utf8'));
  for (const fixture of Object.values(timeline.fixtures)) {
    if (!fixture.scenario) continue;
    const heard = fixture.clips
      .filter((clip) => clip.heard !== false)
      .map((clip) => clip.transcript ?? clip.say);
    const [scenario, lang] = fixture.scenario;
    expect(heard).toEqual(voice.scenario_lines[scenario][lang].slice(0, heard.length));
  }
});
