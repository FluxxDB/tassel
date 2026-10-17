// The server's frames API, typed by its OpenAPI schema: upload a frame, list a session's frames,
// and fetch one's JPEG.
import { type ApiClient, ApiError, type components } from '@tassel/shared/api';
import type { FrameMetaJson } from './frame-meta';

export type FrameOut = components['schemas']['FrameOut'];

/** One upload: the full JPEG, the crop of what changed (ink needs one), and the meta. */
export interface FrameParts {
  full: Blob;
  crop: Blob | null;
  meta: FrameMetaJson;
}

type UploadBody = components['schemas']['Body_upload_frame_v1_sessions__session_id__frames_post'];

/**
 * A non-2xx answer from the frames API. `retryAfterS` is the answer's Retry-After in seconds
 * (the server sends one with a 429; CORS exposes it), or null when it had none.
 */
export class FramesApiError extends ApiError {
  readonly retryAfterS: number | null;

  constructor(response: Response, body: unknown) {
    super(response.status, body);
    this.retryAfterS = retryAfterSeconds(response.headers.get('Retry-After'));
  }
}

/** Retry-After's delay-seconds form. The HTTP-date form isn't used by this server. */
function retryAfterSeconds(header: string | null): number | null {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header) : null;
}

/** What an openapi-fetch call resolves to: `data` on success, `error` (the parsed body) otherwise. */
type Result<T> = { data?: T; error?: unknown; response: Response };

function dataOf<T>({ data, error, response }: Result<T>): T {
  if (data === undefined) throw new FramesApiError(response, error);
  return data;
}

type CellMask = NonNullable<FrameOut['mask']>;
/** FrameOut as openapi-fetch types a response: its tuple types widen to arrays. */
type FrameOutAsParsed = Omit<FrameOut, 'mask'> & {
  mask: (Omit<CellMask, 'cells'> & { cells: number[][] }) | null;
};

/** The schema says the mask's cells are `[col, row]` pairs, so a parsed frame is a FrameOut. */
const asFrameOut = (frame: FrameOutAsParsed): FrameOut => frame as FrameOut;

/** Posts the multipart parts `frame`, then `crop` when there is one, then `meta` as JSON. */
export async function uploadFrame(
  api: ApiClient,
  sessionId: string,
  parts: FrameParts,
): Promise<FrameOut> {
  const body = { frame: parts.full, crop: parts.crop, meta: JSON.stringify(parts.meta) };
  const response = await api.POST('/v1/sessions/{session_id}/frames', {
    params: { path: { session_id: sessionId } },
    // The one cast: openapi-typescript types the binary parts as strings, and they are Blobs.
    body: body as unknown as UploadBody,
    bodySerializer: () => {
      const form = new FormData();
      form.append('frame', body.frame);
      if (body.crop) form.append('crop', body.crop);
      form.append('meta', body.meta);
      return form;
    },
  });
  return asFrameOut(dataOf(response));
}

/** The session's frames, newest first; the server's default limit is 50, its maximum 200. */
export async function listFrames(
  api: ApiClient,
  sessionId: string,
  limit?: number,
): Promise<FrameOut[]> {
  const params = { path: { session_id: sessionId }, query: { limit } };
  return dataOf(await api.GET('/v1/sessions/{session_id}/frames', { params })).items.map(
    asFrameOut,
  );
}

export async function getFrameImage(
  api: ApiClient,
  sessionId: string,
  frameId: string,
  part: 'full' | 'crop',
): Promise<Blob> {
  return dataOf(
    await api.GET('/v1/sessions/{session_id}/frames/{frame_id}/image', {
      params: { path: { session_id: sessionId, frame_id: frameId }, query: { part } },
      parseAs: 'blob',
    }),
  );
}
