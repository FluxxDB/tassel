// The typed API client: openapi-fetch over the generated schema. Every request carries the
// device token; on a 401 the client refreshes the token once and retries.
import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './schema';

export type ApiClient = Client<paths>;
export type Session = components['schemas']['SessionOut'];
export type SessionType = Session['type'];
export type Source = Session['source'];
export type SessionCreate = components['schemas']['SessionCreate'];
export type SessionPatch = components['schemas']['SessionPatch'];
type ListQuery = NonNullable<paths['/v1/sessions']['get']['parameters']['query']>;
/** 'recent' | 'created' | 'topic', as the server declares them. */
export type SessionSort = NonNullable<ListQuery['sort']>;

/** The server rejected the device token even after one refresh. */
export class UnauthorizedError extends Error {
  constructor() {
    super('The server rejected the device token, even after refreshing it');
    this.name = 'UnauthorizedError';
  }
}

/** Any other non-2xx response, with its parsed body (FastAPI sends `{ detail }`). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`The API answered ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiClientOptions {
  /** The server's absolute URL, such as http://127.0.0.1:8787. Only its origin gets the token. */
  baseUrl: string;
  getToken: () => Promise<string>;
  /** Registers a new device and returns its token. Called at most once per failed request. */
  refreshToken: () => Promise<string>;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return createClient<paths>({ baseUrl: opts.baseUrl, fetch: withDeviceToken(opts) });
}

function withDeviceToken(opts: ApiClientOptions): (request: Request) => Promise<Response> {
  // Called as a plain function: a browser's fetch throws "Illegal invocation" on a foreign `this`.
  const { getToken, refreshToken, fetch: send = globalThis.fetch } = opts;
  const apiOrigin = new URL(opts.baseUrl).origin;
  let refreshing: Promise<string> | undefined;

  // Requests that fail together share one refresh, so a stale token re-registers only once.
  const refreshOnce = () => {
    refreshing ??= refreshToken().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  const sendWith = (request: Request, token: string) => {
    request.headers.set('Authorization', `Bearer ${token}`);
    return send(request);
  };

  return async (request) => {
    // A call may override baseUrl; the device token never leaves the API's origin.
    if (new URL(request.url).origin !== apiOrigin) return send(request);
    const retry = request.clone(); // the body can only be read once
    const token = await getToken();
    const first = await sendWith(request, token);
    if (first.status !== 401) return first;
    await first.body?.cancel();
    // Another request may already have refreshed the token; only refresh if it hasn't.
    const current = await getToken();
    const second = await sendWith(retry, current === token ? await refreshOnce() : current);
    if (second.status !== 401) return second;
    await second.body?.cancel();
    throw new UnauthorizedError();
  };
}

/** What an openapi-fetch call resolves to: `data` on success, `error` (the parsed body) otherwise. */
type Result<T> = { data?: T; error?: unknown; response: Response };

function dataOf<T>({ data, error, response }: Result<T>): T {
  if (data === undefined) throw new ApiError(response.status, error);
  return data;
}

const byId = (id: string) => ({ params: { path: { session_id: id } } });

export async function listSessions(
  api: ApiClient,
  sort: SessionSort,
  q?: string,
): Promise<Session[]> {
  return dataOf(await api.GET('/v1/sessions', { params: { query: { sort, q } } })).items;
}

export async function createSession(api: ApiClient, body: SessionCreate): Promise<Session> {
  return dataOf(await api.POST('/v1/sessions', { body }));
}

export async function getSession(api: ApiClient, id: string): Promise<Session> {
  return dataOf(await api.GET('/v1/sessions/{session_id}', byId(id)));
}

export async function patchSession(
  api: ApiClient,
  id: string,
  changes: SessionPatch,
): Promise<Session> {
  return dataOf(await api.PATCH('/v1/sessions/{session_id}', { ...byId(id), body: changes }));
}

export async function deleteSession(api: ApiClient, id: string): Promise<void> {
  const { error, response } = await api.DELETE('/v1/sessions/{session_id}', byId(id));
  if (!response.ok) throw new ApiError(response.status, error);
}
