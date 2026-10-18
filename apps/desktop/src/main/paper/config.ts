// Paper's launch settings, read from TASSEL_* environment variables (P3). A packaged app honors
// TASSEL_PAPER_SOURCE only as auto, webcam, deskview-helper or window-capture, and ignores every fake
// and dev switch.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { app } from 'electron';
import type { SavedSettings } from '../../shared/bridge';
import type { CameraAccess, PaperConfig, PaperSourceKind } from '../../shared/paper-bridge';

export interface PaperSettings {
  /** What the renderer gets from window.tassel.paper.getConfig(). */
  config: PaperConfig;
  /** TASSEL_FAKE_CLIP, absolute, for Chromium's fake camera (the fake-clip source). */
  fakeClipPath: string | null;
  /**
   * TASSEL_HELPER_CLIP, absolute, for the helper to play instead of the camera. It's kept even
   * when the file is missing: the helper then fails to start, rather than falling back to the
   * camera.
   */
  helperClipPath: string | null;
  helperPathOverride: string | null;
  helperTag: string | null;
  fakeDisplay: 'self' | null;
  fakeCameraAccess: CameraAccess | null;
  /** TASSEL_REQUIRE_FAKE_CAPTURE=1: no helper without a clip, no real display media, no prompt. */
  requireFake: boolean;
}

const SOURCES: readonly (PaperSourceKind | 'auto')[] = [
  'auto',
  'webcam',
  'deskview-helper',
  'window-capture',
  'fake-clip',
  'screen',
];
/** The sources a packaged app honors; anything else is auto. */
const PACKAGED_SOURCES: readonly (PaperSourceKind | 'auto')[] = [
  'auto',
  'webcam',
  'deskview-helper',
  'window-capture',
];
const FAKE_CAMERA_ACCESS: readonly CameraAccess[] = ['granted', 'denied', 'not-determined'];

/**
 * `saved` is the source she chose in Settings → Camera & paper (main/settings.ts). It applies
 * only when TASSEL_PAPER_SOURCE is unset and the run doesn't require fake capture, so dev runs
 * and E2E keep the source they pin.
 */
export function readPaperSettings(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = app.isPackaged,
  exists: (path: string) => boolean = existsSync,
  saved: SavedSettings = {},
): PaperSettings {
  const requested =
    env.TASSEL_PAPER_SOURCE ||
    (env.TASSEL_REQUIRE_FAKE_CAPTURE === '1' ? undefined : saved.paperSource);
  const source = paperSource(requested, packaged ? PACKAGED_SOURCES : SOURCES);
  if (packaged) {
    return {
      config: { source, debug: false, helperClip: false, fakeClip: false, params: {} },
      fakeClipPath: null,
      helperClipPath: null,
      helperPathOverride: null,
      helperTag: null,
      fakeDisplay: null,
      fakeCameraAccess: null,
      requireFake: false,
    };
  }
  const fakeClipPath = absolute(env.TASSEL_FAKE_CLIP);
  const helperClipPath = absolute(env.TASSEL_HELPER_CLIP);
  const fakeCameraAccess = env.TASSEL_FAKE_CAMERA_ACCESS as CameraAccess | undefined;
  return {
    config: {
      source,
      debug: env.TASSEL_PAPER_DEBUG === '1',
      helperClip: helperClipPath !== null && exists(helperClipPath),
      fakeClip:
        (source === 'fake-clip' ||
          (source === 'webcam' && env.TASSEL_REQUIRE_FAKE_CAPTURE === '1')) &&
        fakeClipPath !== null &&
        exists(fakeClipPath),
      params: detectorParams(env.TASSEL_PAPER_PARAMS),
    },
    fakeClipPath,
    helperClipPath,
    helperPathOverride: env.TASSEL_DESKVIEW_HELPER || null,
    helperTag: env.TASSEL_HELPER_TAG || null,
    fakeDisplay: env.TASSEL_FAKE_DISPLAY === 'self' ? 'self' : null,
    fakeCameraAccess:
      fakeCameraAccess && FAKE_CAMERA_ACCESS.includes(fakeCameraAccess) ? fakeCameraAccess : null,
    requireFake: env.TASSEL_REQUIRE_FAKE_CAPTURE === '1',
  };
}

function paperSource(
  requested: string | undefined,
  allowed: readonly (PaperSourceKind | 'auto')[],
): PaperSourceKind | 'auto' {
  return allowed.find((source) => source === requested) ?? 'auto';
}

/** An absolute path, or null when unset. Empty counts as unset, as a shell's `VAR=` means. */
function absolute(path: string | undefined): string | null {
  return path ? resolve(path) : null;
}

/**
 * The finite numbers in TASSEL_PAPER_PARAMS, a JSON object of DetectorParams overrides. Bad JSON
 * gives {} with one warning, and so does anything but an object; other values are dropped with
 * one warning naming them.
 */
function detectorParams(json: string | undefined): Record<string, number> {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn(
      '[tassel] TASSEL_PAPER_PARAMS is not a JSON object, so the detector uses its defaults.',
    );
    return {};
  }
  const params: Record<string, number> = {};
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value)) params[name] = value;
    else dropped.push(name);
  }
  if (dropped.length > 0) {
    console.warn(
      `[tassel] TASSEL_PAPER_PARAMS: ${dropped.join(', ')} not finite numbers; ignored.`,
    );
  }
  return params;
}
