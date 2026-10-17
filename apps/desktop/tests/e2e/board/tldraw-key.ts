// Whether this build carries a tldraw license key (P5-R2). A production build on app://tassel
// without one blanks the board 5 s after tldraw starts, so the specs that need the board past
// that window skip without a key: `test.skip(!hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)')`.
import { readTldrawLicenseKey } from '../../../config/tldraw-license';

/**
 * True when the environment or services/server/.env holds a key, the same lookup the build
 * makes. Run the specs with the environment the app was built with. Never exposes the key.
 */
export function hasTldrawKey(): boolean {
  return readTldrawLicenseKey().key !== null;
}
