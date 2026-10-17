// The app:// protocol, which serves the built renderer (out/renderer) as the app://tassel origin.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

const APP_SCHEME = 'app';
const APP_HOST = 'tassel';

/** The renderer's entry page in a built app. */
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** Registers app:// as a standard, secure scheme. Call it before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Serves app://tassel/* from rendererRoot. Anything else gets a 404. */
export function handleAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppFile(rendererRoot, request.url);
    if (!file) return notFound();
    try {
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound();
    }
  });
}

/**
 * Maps an app:// URL to a file inside rendererRoot. Returns null for another host, a malformed
 * escape, or a path that would leave the root once decoded (such as "..%2f").
 */
export function resolveAppFile(rendererRoot: string, requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname) || '/';
  } catch {
    return null;
  }
  // Backslashes separate paths on Windows, and NUL truncates them in native code.
  if (path.includes('\\') || path.includes('\0')) return null;
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(rendererRoot, `.${path}`);
  const fromRoot = relative(rendererRoot, file);
  const escapes = fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  return fromRoot === '' || escapes ? null : file;
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
