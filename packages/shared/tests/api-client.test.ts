import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  patchSession,
  type Session,
  type SessionSort,
  UnauthorizedError,
} from '../src/api';

const session: Session = {
  id: '00000000-0000-4000-8000-000000000001',
  title: null,
  title_source: null,
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'paper',
  created_at: '2026-10-17T14:00:00Z',
  last_activity_at: '2026-10-17T14:00:00Z',
};

type Reply = { status: number; body?: unknown };

/** A fake server: answers requests with `replies` in order and records what it was sent. */
function fakeServer(...replies: Reply[]) {
  const requests: Request[] = [];
  const bodies: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    bodies.push(await request.text());
    const reply = replies.shift() ?? { status: 500 };
    const body = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(body, {
      status: reply.status,
      headers: body === null ? {} : { 'Content-Type': 'application/json' },
    });
  };
  return { fetch, requests, bodies };
}

function apiFor(
  server: ReturnType<typeof fakeServer>,
  tokens: { getToken?: () => Promise<string>; refreshToken?: () => Promise<string> } = {},
) {
  return createApiClient({
    baseUrl: 'http://127.0.0.1:8787',
    getToken: tokens.getToken ?? (async () => 't1'),
    refreshToken: tokens.refreshToken ?? (async () => 't2'),
    fetch: server.fetch,
  });
}

const authorization = (request: Request | undefined) => request?.headers.get('Authorization');

describe('createApiClient', () => {
  it('sends bearer token', async () => {
    const server = fakeServer({ status: 200, body: { items: [] } });
    await listSessions(apiFor(server), 'recent');
    expect(authorization(server.requests[0])).toBe('Bearer t1');
  });

  it('refreshes once after 401 then succeeds', async () => {
    const server = fakeServer({ status: 401 }, { status: 200, body: { items: [session] } });
    const refreshToken = vi.fn(async () => 't2');
    await expect(listSessions(apiFor(server, { refreshToken }), 'recent')).resolves.toEqual([
      session,
    ]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(authorization(server.requests[1])).toBe('Bearer t2');
  });

  it('throws UnauthorizedError when the retry is also 401', async () => {
    const server = fakeServer({ status: 401 }, { status: 401 });
    const refreshToken = vi.fn(async () => 't2');
    await expect(listSessions(apiFor(server, { refreshToken }), 'recent')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(server.requests).toHaveLength(2);
  });

  it('retries with the same method and body', async () => {
    const server = fakeServer({ status: 401 }, { status: 201, body: session });
    const created = { type: 'homework', language: 'en', source: 'paper' } as const;
    await expect(createSession(apiFor(server), created)).resolves.toEqual(session);
    expect(server.requests.map((r) => r.method)).toEqual(['POST', 'POST']);
    expect(server.bodies).toEqual([JSON.stringify(created), JSON.stringify(created)]);
  });

  it('shares one refresh between requests that fail together', async () => {
    const empty = { status: 200, body: { items: [] } };
    const server = fakeServer({ status: 401 }, { status: 401 }, empty, empty);
    // Resolves on a later task, after both requests have seen their 401.
    const refreshToken = vi.fn(() => new Promise<string>((done) => setTimeout(done, 10, 't2')));
    const api = apiFor(server, { refreshToken });
    await Promise.all([listSessions(api, 'recent'), listSessions(api, 'created')]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(server.requests.slice(2).map(authorization)).toEqual(['Bearer t2', 'Bearer t2']);
  });

  it('sends the token only to the API origin', async () => {
    const server = fakeServer({ status: 200, body: { items: [] } });
    const elsewhere = { baseUrl: 'https://elsewhere.example', params: { query: {} } };
    await apiFor(server).GET('/v1/sessions', elsewhere);
    expect(server.requests[0]?.url).toBe('https://elsewhere.example/v1/sessions');
    expect(authorization(server.requests[0])).toBeNull();
  });

  it('reuses a token that another request already refreshed', async () => {
    const server = fakeServer({ status: 401 }, { status: 200, body: { items: [] } });
    const getToken = vi.fn<() => Promise<string>>().mockResolvedValueOnce('t1');
    getToken.mockResolvedValue('t2');
    const refreshToken = vi.fn(async () => 't3');
    await listSessions(apiFor(server, { getToken, refreshToken }), 'recent');
    expect(refreshToken).not.toHaveBeenCalled();
    expect(authorization(server.requests[1])).toBe('Bearer t2');
  });
});

describe('session helpers', () => {
  it('listSessions passes sort and q', async () => {
    const server = fakeServer({ status: 200, body: { items: [] } });
    await listSessions(apiFor(server), 'topic', 'dfa');
    expect(server.requests[0]?.url.endsWith('/v1/sessions?sort=topic&q=dfa')).toBe(true);
  });

  it('listSessions omits q when there is no search', async () => {
    expectTypeOf<SessionSort>().toEqualTypeOf<'recent' | 'created' | 'topic'>();
    const server = fakeServer({ status: 200, body: { items: [] } });
    await listSessions(apiFor(server), 'created');
    expect(server.requests[0]?.url).toBe('http://127.0.0.1:8787/v1/sessions?sort=created');
  });

  it('get, patch and delete address the session by id', async () => {
    const server = fakeServer(
      { status: 200, body: session },
      { status: 200, body: { ...session, title: 'DFA practice', title_source: 'student' } },
      { status: 204 },
    );
    const api = apiFor(server);
    await expect(getSession(api, session.id)).resolves.toEqual(session);
    await expect(patchSession(api, session.id, { title: 'DFA practice' })).resolves.toMatchObject({
      title_source: 'student',
    });
    await expect(deleteSession(api, session.id)).resolves.toBeUndefined();
    const url = `http://127.0.0.1:8787/v1/sessions/${session.id}`;
    expect(server.requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', url],
      ['PATCH', url],
      ['DELETE', url],
    ]);
    expect(server.bodies[1]).toBe(JSON.stringify({ title: 'DFA practice' }));
  });

  it('throws ApiError with the status and body on a non-2xx response', async () => {
    const notFound = { status: 404, body: { detail: 'Session not found' } };
    const server = fakeServer(notFound, notFound);
    const api = apiFor(server);
    const error = await getSession(api, session.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, body: { detail: 'Session not found' } });
    await expect(deleteSession(api, session.id)).rejects.toMatchObject({ status: 404 });
  });
});
