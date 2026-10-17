// The app's runtime configuration, read from TASSEL_* environment variables.
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { app } from 'electron';
import type { AppConfig } from '../shared/bridge';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

/** The launch settings from the environment: everything in AppConfig but the token store's answer. */
export type EnvConfig = Omit<AppConfig, 'tokenReset'>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  return {
    serverUrl: serverUrl(env.TASSEL_SERVER_URL),
    uiLanguage: uiLanguage(env.TASSEL_UI_LANG),
    tutorMode: env.TASSEL_TUTOR === 'live' ? 'live' : 'fake',
    fakeScript: env.TASSEL_FAKE_SCRIPT || 'dfa-opening',
    fakeSpeed: positiveNumber(env.TASSEL_FAKE_SPEED) ?? 1,
  };
}

/**
 * Moves userData (the token store and the single-instance lock) to TASSEL_USER_DATA when it's
 * set. Call it before anything reads userData.
 */
export function applyUserDataOverride(env: NodeJS.ProcessEnv = process.env): void {
  if (env.TASSEL_USER_DATA) app.setPath('userData', env.TASSEL_USER_DATA);
}

/** 'file' (plaintext JSON) when TASSEL_TOKEN_STORE=file, as dev scripts and E2E set; else 'safe'. */
export function tokenStoreMode(env: NodeJS.ProcessEnv = process.env): 'safe' | 'file' {
  return env.TASSEL_TOKEN_STORE === 'file' ? 'file' : 'safe';
}

/**
 * TASSEL_SERVER_URL without trailing slashes. The API client needs an absolute http(s) URL, so
 * anything else falls back to the local dev server, with a warning, instead of a blank window.
 */
function serverUrl(requested: string | undefined): string {
  if (!requested) return DEFAULT_SERVER_URL;
  const url = requested.replace(/\/+$/, '');
  if (URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol)) return url;
  console.warn(
    `[tassel] TASSEL_SERVER_URL=${JSON.stringify(requested)} isn't an http(s) URL, so the app uses ${DEFAULT_SERVER_URL}.`,
  );
  return DEFAULT_SERVER_URL;
}

/** TASSEL_UI_LANG when supported, else the first supported system language, else en. */
function uiLanguage(requested: string | undefined): Lang {
  for (const tag of [requested, ...app.getPreferredSystemLanguages()]) {
    const lang = tag?.split('-')[0].toLowerCase();
    if (isLang(lang)) return lang;
  }
  return 'en';
}

function isLang(value: string | undefined): value is Lang {
  return value !== undefined && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

function positiveNumber(value: string | undefined): number | undefined {
  const number = Number(value);
  return value && Number.isFinite(number) && number > 0 ? number : undefined;
}
