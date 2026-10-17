// @vitest-environment jsdom
import type { ApiClient, Session, SessionSort } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/src/app/App';
import { useRoute } from '../../src/renderer/src/app/route-store';
import {
  LibraryScreen,
  type LibraryScreenProps,
} from '../../src/renderer/src/features/library/LibraryScreen';
import { useSessions } from '../../src/renderer/src/features/library/useSessions';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';

const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    title: null,
    title_source: null,
    subject: null,
    type: 'homework',
    language: 'en',
    source: 'paper',
    created_at: hoursAgo(2),
    last_activity_at: hoursAgo(2),
    ...overrides,
  };
}

const DFA = session({
  id: 's-dfa',
  title: 'Strings that start with 010',
  subject: 'Automata · DFA',
});
const CALCULUS = session({
  id: 's-calc',
  title: 'Derivatives of composite functions',
  subject: 'Calculus',
  type: 'studying',
});
const UNTITLED = session({ id: 's-new', type: 'research', language: 'ko' });

/** What openapi-fetch resolves to for a 200 from GET /v1/sessions. */
const listed = (items: Session[]) => ({ data: { items }, response: new Response(null) });
const searchOf = (call: unknown[]) =>
  (call[1] as { params: { query: { q?: string } } }).params.query.q;

/** An API client whose GET is a mock: listSessions reads its `{ data, error, response }`. */
function fakeApi() {
  const GET = vi.fn();
  return { api: { GET } as unknown as ApiClient, GET };
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function renderLibrary(api: ApiClient, props: LibraryScreenProps = {}, lang: Lang = 'en') {
  const i18n = await initI18n(lang);
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <LibraryScreen {...props} />
      </ApiProvider>
    </I18nextProvider>,
  );
  return { user };
}

beforeEach(() => {
  // AppFrame reads the platform from the preload bridge.
  vi.stubGlobal('tassel', { platform: 'darwin' });
  useRoute.getState().goLibrary();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LibraryScreen', () => {
  it('LibraryScreen shows empty state with New session', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([]));
    const { user } = await renderLibrary(api);

    const empty = await screen.findByRole('region', { name: 'No sessions yet' });
    expect(empty).toHaveTextContent('Start a session and work through a problem with Ada.');
    const cta = within(empty).getByRole('button', { name: 'New session' });
    await user.click(cta);
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cta).toHaveFocus();
    // There's nothing to sort yet.
    expect(screen.queryByRole('radiogroup', { name: 'Sort sessions' })).not.toBeInTheDocument();
  });

  it("opens the new session sheet from the strip's pill too", async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([DFA]));
    const { user } = await renderLibrary(api);
    await screen.findByRole('button', { name: DFA.title ?? '' });
    const pill = within(screen.getByRole('banner')).getByRole('button', { name: 'New session' });
    await user.click(pill);
    const sheet = screen.getByRole('dialog', { name: 'New session' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pill).toHaveFocus();
  });

  it('shows error state and retries', async () => {
    const { api, GET } = fakeApi();
    // A failed device registration rejects with its own Error, not an ApiError (Task 7).
    GET.mockRejectedValueOnce(new Error('Device registration failed: fetch failed'));
    GET.mockResolvedValue(listed([DFA]));
    const { user } = await renderLibrary(api);

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: "Couldn't reach Tassel's server" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent('Check your connection, then try again.');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: DFA.title ?? '' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('moves focus to the heading once a Retry succeeds, and keeps it on Retry while it fails', async () => {
    const { api, GET } = fakeApi();
    GET.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    GET.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    GET.mockResolvedValue(listed([DFA]));
    const { user } = await renderLibrary(api);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: DFA.title ?? '' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Your sessions' });
    expect(heading).toHaveFocus();
    // A landing spot, not a control: no focus ring around the heading.
    expect(heading).toHaveClass('focus-visible:outline-none');
  });

  it('shows the error state for an error status from the server too', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue({
      error: { detail: 'boom' },
      response: new Response(null, { status: 500 }),
    });
    await renderLibrary(api);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Tassel's server");
  });

  it('keeps the error state up, busy, while Retry runs, and ignores more clicks', async () => {
    const { api, GET } = fakeApi();
    const retry = pending<ReturnType<typeof listed>>();
    GET.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    GET.mockReturnValueOnce(retry.promise);
    const { user } = await renderLibrary(api);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    const busy = within(screen.getByRole('alert')).getByRole('button', { name: 'Retrying…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(GET).toHaveBeenCalledTimes(2);

    await act(async () => retry.resolve(listed([DFA])));
    expect(await screen.findByRole('button', { name: DFA.title ?? '' })).toBeInTheDocument();
  });

  it('switching sort to topic renders group headers', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([UNTITLED, CALCULUS, DFA]));
    const { user } = await renderLibrary(api);
    await screen.findByRole('button', { name: DFA.title ?? '' });
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Topic' }));

    await waitFor(() =>
      expect(GET).toHaveBeenLastCalledWith('/v1/sessions', {
        params: { query: { sort: 'topic', q: undefined } },
      }),
    );
    const headers = screen.getAllByRole('heading', { level: 2 });
    expect(headers.map((h) => h.textContent)).toEqual(['Automata · DFA', 'Calculus', 'No topic']);
    const calculus = screen.getByRole('region', { name: 'Calculus' });
    expect(within(calculus).getByRole('button', { name: CALCULUS.title ?? '' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'No topic' })).getByRole('button', {
        name: 'Untitled Session',
      }),
    ).toBeVisible();
  });

  it('long Spanish title clamps to two lines', async () => {
    const title =
      'Cómo demostrar por inducción que la suma de los primeros n números impares es n²';
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([session({ id: 's-es', title, language: 'es' })]));
    await renderLibrary(api, {}, 'es');
    const titleText = await screen.findByText(title);
    expect(titleText).toHaveClass('line-clamp-2');
    expect(titleText).toHaveAttribute('lang', 'es');
    // Two lines at Korean leading are reserved for every title, so rows match in any language.
    expect(titleText).toHaveClass('min-h-[3.2em]');
  });

  it('shows each session as a card named by its title, and opens it', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([DFA, UNTITLED]));
    const { user } = await renderLibrary(api);

    const card = await screen.findByRole('button', { name: 'Strings that start with 010' });
    // The rest of the card describes it; the language reads as its name, not its code.
    for (const part of [/Automata · DFA/, /Homework/, /2 hours ago/, /English/]) {
      expect(card).toHaveAccessibleDescription(part);
    }
    expect(card).not.toHaveAccessibleDescription(/\bEN\b/);
    const time = within(card).getByText('2 hours ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', DFA.last_activity_at);
    expect(screen.getByRole('list', { name: 'Your sessions' }).children).toHaveLength(2);

    // An untitled session shows the placeholder, in the quieter text color.
    const untitled = screen.getByRole('button', { name: 'Untitled Session' });
    expect(within(untitled).getByText('Untitled Session')).toHaveClass('text-smoke-text');
    expect(within(untitled).getByText('Research')).toBeInTheDocument();

    await user.click(card);
    expect(useRoute.getState().route).toEqual({ name: 'session', sessionId: DFA.id });
  });

  it('dates each card by its creation under Date created', async () => {
    const { api, GET } = fakeApi();
    const reopened = session({
      id: 's-old',
      title: 'Cell respiration',
      created_at: new Date(Date.now() - 3 * 24 * HOUR).toISOString(),
      last_activity_at: hoursAgo(2),
    });
    GET.mockResolvedValue(listed([reopened]));
    const { user } = await renderLibrary(api);
    const card = await screen.findByRole('button', { name: 'Cell respiration' });
    expect(within(card).getByText('2 hours ago')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Date created' }));
    expect(await within(card).findByText('3 days ago')).toBeInTheDocument();
  });

  it('shows skeleton cards when the first load is slow', async () => {
    const { api, GET } = fakeApi();
    GET.mockReturnValue(new Promise(() => {}));
    await renderLibrary(api);
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
    // A fast load never flashes them.
    expect(screen.queryAllByTestId('session-skeleton')).toHaveLength(0);
    expect(await screen.findAllByTestId('session-skeleton')).toHaveLength(6);
  });

  it('searches titles and topics, and offers to clear a search with no results', async () => {
    const { api, GET } = fakeApi();
    GET.mockImplementation(async (path: string, options: unknown) =>
      listed(searchOf([path, options]) ? [] : [DFA, CALCULUS]),
    );
    const { user } = await renderLibrary(api);
    await screen.findByRole('button', { name: DFA.title ?? '' });

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    // Search outcomes are announced politely (WCAG 4.1.3).
    const outcome = screen.getByTestId('search-outcome');
    expect(outcome).toHaveAttribute('role', 'status');
    expect(outcome).toBeEmptyDOMElement();
    await user.type(search, 'zzz');
    const noResults = await screen.findByRole('region', { name: 'No sessions match "zzz"' });
    expect(outcome).toHaveTextContent('No sessions match "zzz"');
    await user.click(within(noResults).getByRole('button', { name: 'Clear search' }));

    expect(search).toHaveValue('');
    // The panel and its button are gone, so focus goes back to the search field.
    expect(search).toHaveFocus();
    expect(await screen.findByRole('button', { name: DFA.title ?? '' })).toBeInTheDocument();
    // Three keystrokes made one search request.
    expect(GET.mock.calls.map(searchOf)).toEqual([undefined, 'zzz', undefined]);
  });

  it('announces how many sessions a search found', async () => {
    const { api, GET } = fakeApi();
    GET.mockImplementation(async (path: string, options: unknown) =>
      listed(searchOf([path, options]) ? [DFA] : [DFA, CALCULUS]),
    );
    const { user } = await renderLibrary(api);
    await screen.findByRole('button', { name: DFA.title ?? '' });
    await user.type(screen.getByRole('searchbox'), 'dfa');
    await waitFor(() =>
      expect(screen.getByTestId('search-outcome')).toHaveTextContent('1 session'),
    );
    await user.clear(screen.getByRole('searchbox'));
    await waitFor(() => expect(screen.getByTestId('search-outcome')).toBeEmptyDOMElement());
  });

  it('clears the search with Escape or the clear button in the field', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([DFA]));
    const { user } = await renderLibrary(api);
    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    // The search landmark (jsdom's role table doesn't know <search> yet).
    const field = search.closest('search') as HTMLElement;
    expect(field).toBeInTheDocument();
    expect(within(field).queryByRole('button')).not.toBeInTheDocument();

    await user.type(search, 'dfa');
    await user.click(within(field).getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();

    await user.type(search, 'dfa{Escape}');
    expect(search).toHaveValue('');
  });

  it('never shows the empty library while a cleared search reloads', async () => {
    const { api, GET } = fakeApi();
    const all = pending<ReturnType<typeof listed>>();
    GET.mockResolvedValueOnce(listed([DFA]));
    GET.mockResolvedValueOnce(listed([]));
    GET.mockReturnValueOnce(all.promise);
    const { user } = await renderLibrary(api);
    const search = await screen.findByRole('searchbox');
    await user.type(search, 'zzz');
    await screen.findByRole('region', { name: 'No sessions match "zzz"' });

    await user.clear(search);
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('region', { name: 'No sessions yet' })).not.toBeInTheDocument();
    await act(async () => all.resolve(listed([DFA])));
    expect(await screen.findByRole('button', { name: DFA.title ?? '' })).toBeInTheDocument();
  });

  it('tells the learner when this launch had to start a fresh library', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([]));
    const onDismissTokenNotice = vi.fn();
    const { user } = await renderLibrary(api, { tokenNotice: true, onDismissTokenNotice });
    const notice = screen.getByText(/couldn't read this device's saved ID/);
    expect(notice.closest('[role="status"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismissTokenNotice).toHaveBeenCalledTimes(1);
  });

  it('labels everything in Korean', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([DFA]));
    await renderLibrary(api, {}, 'ko');
    expect(await screen.findByRole('heading', { level: 1, name: '내 세션' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '세션 정렬' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '세션 검색' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 세션' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: DFA.title ?? '' })).getByText('2시간 전'),
    ).toBeInTheDocument();
  });
});

describe('useSessions', () => {
  function wrapperFor(api: ApiClient) {
    return ({ children }: { children: ReactNode }) => (
      <ApiProvider client={api}>{children}</ApiProvider>
    );
  }

  it('q is debounced 250 ms: a, au and aut typed quickly send one search', async () => {
    vi.useFakeTimers();
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([]));
    const { result, rerender } = renderHook(({ q }) => useSessions('recent', q), {
      wrapper: wrapperFor(api),
      initialProps: { q: '' },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(GET).toHaveBeenCalledTimes(1);

    rerender({ q: 'a' });
    await act(() => vi.advanceTimersByTimeAsync(100));
    rerender({ q: 'au' });
    await act(() => vi.advanceTimersByTimeAsync(100));
    rerender({ q: ' aut ' });
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(GET).toHaveBeenCalledTimes(1);
    expect(result.current.query).toBe('');

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(GET).toHaveBeenCalledTimes(2);
    expect(GET).toHaveBeenLastCalledWith('/v1/sessions', {
      params: { query: { sort: 'recent', q: 'aut' } },
    });
    expect(result.current.query).toBe('aut');
  });

  it('sends no search for blank text, and clears a search at once', async () => {
    vi.useFakeTimers();
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([]));
    const { rerender } = renderHook(({ q }) => useSessions('recent', q), {
      wrapper: wrapperFor(api),
      initialProps: { q: '   ' },
    });
    await act(() => vi.advanceTimersByTimeAsync(300));
    rerender({ q: 'dfa' });
    await act(() => vi.advanceTimersByTimeAsync(250));
    rerender({ q: '' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(GET.mock.calls.map(searchOf)).toEqual([undefined, 'dfa', undefined]);
  });

  it('an older response never replaces a newer one', async () => {
    const { api, GET } = fakeApi();
    const slow = pending<ReturnType<typeof listed>>();
    GET.mockReturnValueOnce(slow.promise);
    GET.mockResolvedValueOnce(listed([CALCULUS]));
    const { result, rerender } = renderHook(({ sort }) => useSessions(sort, ''), {
      wrapper: wrapperFor(api),
      initialProps: { sort: 'recent' as SessionSort },
    });
    rerender({ sort: 'topic' });
    await waitFor(() => expect(result.current.items).toEqual([CALCULUS]));

    await act(async () => slow.resolve(listed([DFA])));
    expect(result.current.items).toEqual([CALCULUS]);
  });

  it('keeps the last results up while a new sort loads', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValueOnce(listed([DFA]));
    const next = pending<ReturnType<typeof listed>>();
    GET.mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ sort }) => useSessions(sort, ''), {
      wrapper: wrapperFor(api),
      initialProps: { sort: 'recent' as SessionSort },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ sort: 'created' });
    expect(result.current).toMatchObject({ status: 'ready', items: [DFA] });
    await act(async () => next.resolve(listed([DFA, CALCULUS])));
    expect(result.current).toMatchObject({ status: 'ready', items: [DFA, CALCULUS] });
  });

  it('loads again after a failure when refetched', async () => {
    const { api, GET } = fakeApi();
    const failure = new Error('Device registration failed');
    GET.mockRejectedValueOnce(failure);
    const again = pending<ReturnType<typeof listed>>();
    GET.mockReturnValueOnce(again.promise);
    const { result } = renderHook(() => useSessions('recent', ''), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current).toMatchObject({ status: 'error', error: failure }));

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe('loading'));
    await act(async () => again.resolve(listed([DFA])));
    expect(result.current).toMatchObject({ status: 'ready', items: [DFA] });
    expect(result.current.error).toBeUndefined();
  });
});

describe('App', () => {
  it('keeps the fresh-library notice until it is dismissed, across a visit to a session', async () => {
    const { api, GET } = fakeApi();
    GET.mockResolvedValue(listed([]));
    const i18n = await initI18n('en');
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <App api={api} tokenReset />
      </I18nextProvider>,
    );
    const notice = /couldn't read this device's saved ID/;
    expect(screen.getByText(notice)).toBeInTheDocument();

    act(() => useRoute.getState().openSession(DFA.id));
    act(() => useRoute.getState().goLibrary());
    expect(screen.getByText(notice)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    // The notice took its button with it: focus moves on to the heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Your sessions' })).toHaveFocus();
    act(() => useRoute.getState().openSession(DFA.id));
    act(() => useRoute.getState().goLibrary());
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    await screen.findByRole('region', { name: 'No sessions yet' });
  });
});
