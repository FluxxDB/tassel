// Which OS the visitor is on, from the browser's user agent. Tassel ships for macOS only, so the
// download buttons only need to tell a Mac from everything else, and name the "everything else".
export type Platform =
  | 'mac'
  | 'windows'
  | 'linux'
  | 'chromeos'
  | 'android'
  | 'iphone'
  | 'ipad'
  | 'unknown';

/** Display names for the "Not available for …" label. */
export const PLATFORM_NAMES: Record<Exclude<Platform, 'mac'>, string> = {
  windows: 'Windows',
  linux: 'Linux',
  chromeos: 'ChromeOS',
  android: 'Android',
  iphone: 'iPhone',
  ipad: 'iPad',
  unknown: 'this device',
};

export interface PlatformHints {
  userAgent: string;
  /** navigator.userAgentData.platform (Chromium only): "macOS", "Windows", "Android"… */
  uaPlatform?: string;
  /** navigator.maxTouchPoints: tells an iPad (which claims to be a Mac) from a real Mac. */
  maxTouchPoints?: number;
}

export function detectPlatform({
  userAgent,
  uaPlatform,
  maxTouchPoints = 0,
}: PlatformHints): Platform {
  // iPadOS asks for the desktop site with a Mac user agent; only the touch screen gives it away.
  const macOrIpad = (): Platform => (maxTouchPoints > 1 ? 'ipad' : 'mac');

  // Chromium's client hint is the most reliable source when it exists.
  switch (uaPlatform?.toLowerCase()) {
    case 'macos':
      return macOrIpad();
    case 'windows':
      return 'windows';
    case 'android':
      return 'android';
    case 'chrome os':
    case 'chromeos':
      return 'chromeos';
    case 'ios':
      return /iPad/i.test(userAgent) ? 'ipad' : 'iphone';
    case 'linux':
      return 'linux';
  }

  // Order matters: Android's UA also says Linux, and iPhone's says "like Mac OS X".
  const ua = userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPod/i.test(ua)) return 'iphone';
  if (/iPad/i.test(ua)) return 'ipad';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Windows|Win64|Win32/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return macOrIpad();
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

interface NavigatorUAData {
  platform?: string;
}

export function detectBrowserPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  return detectPlatform({
    userAgent: navigator.userAgent,
    uaPlatform: uaData?.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}
