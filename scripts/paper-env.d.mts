import type { SpawnOptions } from 'node:child_process';
export function cameraLaunch(
  inherited: NodeJS.ProcessEnv,
  options: {
    electronApp: string;
    mainEntry: string;
    serverUrl: string;
    tag: string;
    log?: string;
    userData?: string;
    cdpPort?: number;
  },
): { command: string; args: string[]; options: SpawnOptions; message: string };
