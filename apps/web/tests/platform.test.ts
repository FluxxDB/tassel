import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../lib/platform';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  android:
    'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it('recognizes a Mac', () => {
    expect(detectPlatform({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe('mac');
  });

  it('treats a touch-screen "Mac" as an iPad (iPadOS desktop mode)', () => {
    expect(detectPlatform({ userAgent: UA.mac, maxTouchPoints: 5 })).toBe('ipad');
  });

  it('recognizes Windows, Linux, ChromeOS, Android and iPhone', () => {
    expect(detectPlatform({ userAgent: UA.windows })).toBe('windows');
    expect(detectPlatform({ userAgent: UA.linux })).toBe('linux');
    expect(detectPlatform({ userAgent: UA.chromeos })).toBe('chromeos');
    expect(detectPlatform({ userAgent: UA.android })).toBe('android');
    expect(detectPlatform({ userAgent: UA.iphone })).toBe('iphone');
  });

  it('prefers userAgentData.platform when the browser gives it', () => {
    expect(detectPlatform({ userAgent: UA.linux, uaPlatform: 'Windows' })).toBe('windows');
    expect(detectPlatform({ userAgent: UA.windows, uaPlatform: 'macOS' })).toBe('mac');
  });

  it('falls back to unknown', () => {
    expect(detectPlatform({ userAgent: '' })).toBe('unknown');
  });
});
