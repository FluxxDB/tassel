// The display-media handler behind getDisplayMedia: the window-capture and screen paper sources.
// "Deny" is always callback(null), which rejects getDisplayMedia with an AbortError. An empty {}
// would make Electron throw "Video was requested, but no video stream was provided".
import type {
  DisplayMediaRequestHandlerHandlerRequest,
  desktopCapturer,
  Session,
  Streams,
} from 'electron';

export interface DisplayMediaOptions {
  platform: NodeJS.Platform;
  /** macOS's major version (process.getSystemVersion()), null elsewhere. */
  macosMajor: number | null;
  fakeDisplay: 'self' | null;
  requireFake: boolean;
  getSources: typeof desktopCapturer.getSources;
  isTrusted(url: string): boolean;
}

export function registerDisplayMedia(session: Session, opts: DisplayMediaOptions): void {
  // macOS 15+ has the system picker (experimental in Electron). When it exists the handler is
  // never invoked, so neither the self fake nor requireFake may turn it on.
  const systemPicker =
    opts.fakeDisplay === null &&
    !opts.requireFake &&
    opts.platform === 'darwin' &&
    (opts.macosMajor ?? 0) >= 15;
  const handler = (
    request: DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Streams | null) => void,
  ): void => {
    void answer(request, opts)
      .catch(() => null)
      .then((streams) => {
        // Electron's callback throws when the requesting frame is already gone.
        try {
          callback(streams);
        } catch (error) {
          console.error('[tassel] display media request:', error);
        }
      });
  };
  if (systemPicker) session.setDisplayMediaRequestHandler(handler, { useSystemPicker: true });
  else session.setDisplayMediaRequestHandler(handler);
}

async function answer(
  request: DisplayMediaRequestHandlerHandlerRequest,
  opts: DisplayMediaOptions,
): Promise<Streams | null> {
  // A frame grant captures its whole webContents, so only the app's own pages get one.
  if (!opts.isTrusted(request.securityOrigin)) return null;
  // E2E: the tab holding the requesting frame, with no picker and no OS permission.
  if (opts.fakeDisplay === 'self') return request.frame ? { video: request.frame } : null;
  if (opts.requireFake) return null;
  // macOS: the system picker answers on 15+ (if this runs anyway, deny), and before 15 there is
  // no picker, so nothing is shared silently (R16).
  if (opts.platform === 'darwin') return null;
  // Windows and Linux: the primary screen.
  const [screen] = await opts.getSources({ types: ['screen'] });
  return screen ? { video: screen } : null;
}
