// Where the Desk View helper binary is. It exists only on macOS.
import { dirname, join } from 'node:path';
import type { PaperSettings } from './config';

/** How far up from startDir (out/main) to look for the repo. */
const MAX_LEVELS = 6;

export function helperPath(
  settings: PaperSettings,
  at: {
    packaged: boolean;
    resourcesPath: string;
    startDir: string;
    platform: NodeJS.Platform;
    exists(path: string): boolean;
  },
): string | null {
  if (at.platform !== 'darwin') return null;
  if (settings.helperPathOverride) return settings.helperPathOverride;
  // P10 places it in the bundle's Resources.
  if (at.packaged) return join(at.resourcesPath, 'deskview-helper');
  // pnpm dev, Playwright and LaunchServices launches all run out/main: the repo is a few levels
  // up, and `node scripts/native.mjs build` builds the helper into it.
  let dir = at.startDir;
  for (let level = 0; level <= MAX_LEVELS; level += 1) {
    const helperPackage = join(dir, 'native', 'deskview-helper');
    if (at.exists(join(helperPackage, 'Package.swift'))) {
      return join(helperPackage, '.build', 'release', 'deskview-helper');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
