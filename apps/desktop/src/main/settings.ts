// The settings the main process reads at launch, saved by the Settings view: the UI language and
// her paper source. They live in userData/settings.json, next to the device token. Only known,
// correctly typed values are read or written; anything else in the file is dropped.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { SAVED_PAPER_SOURCES, type SavedSettings } from '../shared/bridge';

const FILE = 'settings.json';

export function readSavedSettings(dir: string): SavedSettings {
  try {
    return cleanSettings(JSON.parse(readFileSync(join(dir, FILE), 'utf8')));
  } catch {
    // Missing or unreadable: the launch uses its defaults.
    return {};
  }
}

/** Merges `patch` into the saved settings and writes them atomically; returns what was saved. */
export function writeSavedSettings(dir: string, patch: unknown): SavedSettings {
  const next = cleanSettings({ ...readSavedSettings(dir), ...cleanPatch(patch) });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${path}.tmp`, path);
  return next;
}

function cleanPatch(value: unknown): Partial<SavedSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const patch: Record<string, unknown> = {};
  for (const key of ['uiLanguage', 'paperSource'] as const) {
    if (key in value) patch[key] = Reflect.get(value, key);
  }
  return patch as Partial<SavedSettings>;
}

export function cleanSettings(value: unknown): SavedSettings {
  const result: SavedSettings = {};
  if (typeof value !== 'object' || value === null) return result;
  const lang = Reflect.get(value, 'uiLanguage');
  if ((SUPPORTED_LANGS as readonly unknown[]).includes(lang)) {
    result.uiLanguage = lang as SavedSettings['uiLanguage'];
  }
  const source = Reflect.get(value, 'paperSource');
  if ((SAVED_PAPER_SOURCES as readonly unknown[]).includes(source)) {
    result.paperSource = source as SavedSettings['paperSource'];
  }
  return result;
}
