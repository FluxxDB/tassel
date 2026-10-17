import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { app } from 'electron';

const warnedMissing = new Set<string>();
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** No flag means real devices, including in development. Packaged apps always use real devices. */
export function voiceSwitches(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
  exists: (p: string) => boolean = isFile,
): Array<[string] | [string, string]> {
  if (packaged || !env.TASSEL_FAKE_MIC) return [];
  const path = resolve(env.TASSEL_FAKE_MIC);
  if (!exists(path)) {
    if (!warnedMissing.has(path)) {
      warnedMissing.add(path);
      console.warn(
        '[tassel] TASSEL_FAKE_MIC file is missing; fake media switches were not applied.',
      );
    }
    return [];
  }
  return [
    ['use-fake-device-for-media-stream'],
    [
      'use-file-for-fake-audio-capture',
      `${path}${env.TASSEL_FAKE_MIC_LOOP === '1' ? '' : '%noloop'}`,
    ],
  ];
}

/** Must run before app.whenReady(), before Chromium starts its audio service. */
export function applyVoiceSwitches(
  cmd: { appendSwitch(n: string, v?: string): void },
  env: NodeJS.ProcessEnv = process.env,
  packaged = app.isPackaged,
): void {
  for (const args of voiceSwitches(env, packaged)) {
    if (args.length === 1) cmd.appendSwitch(args[0]);
    else cmd.appendSwitch(args[0], args[1]);
  }
}
