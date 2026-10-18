// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from '../../src/renderer/src/app/route-store';
import { SessionScreen } from '../../src/renderer/src/features/session/SessionScreen';
import { useStageStore } from '../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';
import { usePaperStore } from '../../src/renderer/src/paper/paper-store';
import type { PaperBridge } from '../../src/shared/paper-bridge';

const UNTITLED: Session = {
  id: '3a8f0d5e-62a4-4c0b-a3bb-2b5c1f7e9d10',
  title: null,
  title_source: null,
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'paper',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};
const TITLED: Session = {
  ...UNTITLED,
  title: 'Strings that start with 010',
  subject: 'Automata · DFA',
};

/** An API client whose GET answers getSession with `session`, or fails. */
function fakeApi(session: Session | Error) {
  const GET = vi.fn(async () => {
    if (session instanceof Error) throw session;
    return { data: session, response: new Response(null) };
  });
  return { GET, api: { GET } as unknown as ApiClient };
}

async function renderSession({
  session = UNTITLED,
  lang = 'en',
}: {
  session?: Session | Error;
  lang?: Lang;
} = {}) {
  const i18n = await initI18n(lang);
  const { api, GET } = fakeApi(session);
  const user = userEvent.setup();
  const id = session instanceof Error ? UNTITLED.id : session.id;
  useRoute.getState().openSession(id);
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <SessionScreen sessionId={id} />
      </ApiProvider>
    </I18nextProvider>,
  );
  return { user, GET };
}

const stage = () => useStageStore.getState();

beforeEach(() => {
  vi.stubGlobal('tassel', { platform: 'darwin' });
  stage().reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SessionScreen', () => {
  it('untitled session shows localized placeholder (es)', async () => {
    await renderSession({ lang: 'es' });
    const title = await screen.findByRole('heading', { level: 1, name: 'Sesión sin título' });
    expect(title).toHaveClass('text-smoke-text', 'truncate');
  });

  it('shows the title, chips, source, timer and language', async () => {
    await renderSession({ session: TITLED });
    const strip = screen.getByRole('banner');
    const title = await within(strip).findByRole('heading', {
      level: 1,
      name: 'Strings that start with 010',
    });
    expect(title).toHaveAttribute('lang', 'en');
    expect(within(strip).getByText('Automata · DFA')).toHaveClass('mono');
    expect(within(strip).getByText('Homework')).toHaveClass('mono');
    expect(within(strip).getByText('Desk View')).toBeInTheDocument();
    expect(within(strip).getByRole('timer', { name: 'Time elapsed: 00:00' })).toHaveTextContent(
      '00:00',
    );
    expect(within(strip).getByText('English')).toHaveClass('sr-only');
  });

  it('timer formats 14:32', async () => {
    vi.useFakeTimers();
    await renderSession();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000 + 32_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('14:32');
    expect(screen.getByRole('timer')).toHaveAccessibleName('Time elapsed: 14:32');
  });

  it('starts on her paper, with the board out of the way', async () => {
    await renderSession();
    expect(screen.getByRole('region', { name: 'Your paper · Desk View' })).toHaveTextContent(
      'Waiting for Desk View',
    );
    expect(screen.queryByRole('region', { name: "Ada's board" })).not.toBeInTheDocument();
  });

  it('split renders both panes', async () => {
    await renderSession();
    act(() => stage().requestMode('split'));
    expect(screen.getByRole('region', { name: 'Your paper · Desk View' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "Ada's board" })).toBeInTheDocument();
    act(() => stage().requestMode('board'));
    expect(
      screen.queryByRole('region', { name: 'Your paper · Desk View' }),
    ).not.toBeInTheDocument();
  });

  it('dock buttons have accessible names in ko', async () => {
    await renderSession({ lang: 'ko' });
    const dock = screen.getByRole('group', { name: '세션 제어' });
    for (const name of [
      '마이크',
      '카메라',
      '화면 공유',
      '칠판: Ada 따라가기',
      '자막',
      '세션 종료',
    ]) {
      expect(within(dock).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the toggles pressed and offers screen sharing', async () => {
    const { user } = await renderSession();
    const mic = screen.getByRole('button', { name: 'Microphone' });
    expect(mic).toHaveAttribute('aria-pressed', 'true');
    await user.click(mic);
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    expect(stage().micOn).toBe(false);
    const share = screen.getByRole('button', { name: 'Share screen' });
    expect(share).not.toHaveAttribute('aria-disabled');
    expect(share).toHaveAttribute('aria-pressed', 'false');
    await user.click(share);
    expect(share).toHaveAttribute('title', 'Share screen');
  });

  it('M toggles mic, B cycles board, C toggles captions', async () => {
    const { user } = await renderSession();
    await user.keyboard('m');
    expect(screen.getByRole('button', { name: 'Microphone' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.keyboard('b');
    expect(screen.getByRole('button', { name: 'Board: Paper, pinned' })).toBeInTheDocument();
    await user.keyboard('b');
    expect(stage()).toMatchObject({ pinned: 'split', mode: 'split' });
    expect(screen.getByRole('region', { name: "Ada's board" })).toBeInTheDocument();
    await user.keyboard('c');
    expect(screen.getByRole('button', { name: 'Captions' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByTestId('captions')).not.toBeInTheDocument();
  });

  it('ignores the shortcuts with a modifier, while typing, during IME composition and under a sheet', async () => {
    const { user } = await renderSession();
    fireEvent.keyDown(window, { key: 'm', metaKey: true });
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'm', isComposing: true });
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'm' });
    input.remove();
    expect(stage().micOn).toBe(true);

    await user.click(screen.getByRole('button', { name: 'End session' }));
    await user.keyboard('c');
    expect(stage().captionsOn).toBe(true);
  });

  it('reads the shortcuts by key position under a Korean keyboard layout', async () => {
    await renderSession();
    fireEvent.keyDown(window, { key: 'ㅡ', code: 'KeyM' });
    expect(stage().micOn).toBe(false);
  });

  it("names Ada's state on her tile, with the iris ring only while she speaks", async () => {
    await renderSession();
    const tile = screen.getByRole('figure', { name: /Ada/ });
    expect(tile).toHaveTextContent('Connecting');
    expect(tile).not.toHaveClass('shadow-[0_0_0_2px_var(--color-iris)]');
    act(() => stage().setTutorState('speaking'));
    expect(tile).toHaveTextContent('Speaking');
    expect(tile).toHaveClass('shadow-[0_0_0_2px_var(--color-iris)]');
  });

  it('shows the previous and current caption lines with their speakers and languages', async () => {
    await renderSession();
    const captions = screen.getByTestId('captions');
    // Nothing shows before the first line, but the live region is already there to announce it.
    expect(captions).toHaveClass('opacity-0');
    expect(captions.textContent).toBe('');
    expect(captions.querySelector('[aria-live="polite"]')).not.toBeNull();
    act(() => {
      stage().pushCaption('student', 'Hola Ada, estoy haciendo un DFA.', 'es');
      stage().pushCaption('tutor', 'What should happen once you have read 010?', 'en');
    });
    const previous = within(captions).getByText('Hola Ada, estoy haciendo un DFA.');
    expect(previous).toHaveAttribute('lang', 'es');
    expect(previous.parentElement).toHaveTextContent('You');
    const current = within(captions).getByText('What should happen once you have read 010?');
    expect(current.closest('[aria-live="polite"]')).toBeInTheDocument();
    expect(current.parentElement).toHaveTextContent('Ada');
    // With a line to show, the panel fades in (150 ms at most, none under reduced motion).
    expect(captions).toHaveClass('opacity-100', 'motion-safe:duration-150');
  });

  it('fades in only the incoming caption line, also when it repeats the last one', async () => {
    await renderSession();
    const captions = screen.getByTestId('captions');
    act(() => stage().pushCaption('tutor', 'Draw it on paper.', 'en'));
    act(() => stage().pushCaption('student', 'Okay.', 'en'));
    // The line she just read stays put; only the new one fades in.
    const previous = within(captions).getByText('Draw it on paper.').closest('p');
    const current = within(captions).getByText('Okay.').closest('p');
    expect(previous?.className).not.toContain('animate-');
    expect(current?.className).toContain('animate-[caption-in_150ms_ease-out]');
    // The same words again are a new line, so they fade in again.
    act(() => stage().pushCaption('student', 'Okay.', 'en'));
    const repeated = within(captions).getAllByText('Okay.').at(-1)?.closest('p');
    expect(repeated).not.toBe(current);
  });

  it('keeps the interim DOM line in place without restarting its animation', async () => {
    await renderSession();
    act(() => stage().showInterim('student', 'I', 'en'));
    const line = screen.getByText('I').closest('p');
    expect(line?.className).not.toContain('animate-');
    act(() => stage().showInterim('student', 'I think', 'en'));
    expect(screen.getByText('I think').closest('p')).toBe(line);
    act(() => stage().pushCaption('student', 'I think so', 'en'));
    expect(screen.getByText('I think so').closest('p')).toBe(line);
  });

  it("doesn't animate Ada's speaking ring under reduced motion", async () => {
    await renderSession();
    const tile = screen.getByTestId('tutor-tile');
    expect(tile).toHaveClass('motion-safe:transition-shadow');
    expect(tile).not.toHaveClass('transition-shadow');
  });

  it('shows the pin indicator while a view is pinned, and Unpin follows Ada again (R17)', async () => {
    const { user } = await renderSession();
    expect(screen.queryByRole('button', { name: 'Unpin' })).not.toBeInTheDocument();
    act(() => stage().requestMode('board'));
    act(() => stage().pin('paper'));
    expect(screen.getByText('Pinned · Paper')).toBeInTheDocument();
    // A 24px target at least (WCAG 2.2, 2.5.8), inside the 26px pill.
    expect(screen.getByRole('button', { name: 'Unpin' })).toHaveClass('h-6');
    // A request from before the pin isn't news: only one made since is mentioned.
    expect(screen.queryByText(/Ada asks/)).not.toBeInTheDocument();
    act(() => stage().requestMode('split'));
    expect(screen.getByText('Ada asks: Paper and board')).toBeInTheDocument();
    // Pinning another view starts over: her earlier request isn't news to the new pin.
    act(() => stage().pin('board'));
    expect(screen.getByText('Pinned · Board')).toBeInTheDocument();
    expect(screen.queryByText(/Ada asks/)).not.toBeInTheDocument();
    act(() => stage().pin('paper'));
    await user.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(stage()).toMatchObject({ pinned: null, mode: 'split' });
    // It fades out in place: hidden from assistive tech at once, Unpin included.
    expect(screen.queryByRole('button', { name: 'Unpin' })).not.toBeInTheDocument();
    expect(screen.getByText('Pinned · Paper').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Board: following Ada' })).toBeInTheDocument();
  });

  it('hands focus to the Board control when Unpin takes its own pill away', async () => {
    const { user } = await renderSession();
    await screen.findByRole('heading', { level: 1 });
    await user.keyboard('b');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Unpin' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(stage().pinned).toBeNull();
    expect(screen.getByRole('button', { name: 'Board: following Ada' })).toHaveFocus();
  });

  it('gives every icon control a tooltip', async () => {
    await renderSession();
    const dock = screen.getByRole('group', { name: 'Session controls' });
    // The icon-only ones, named by aria-label; End session names itself in text.
    const icons = within(dock)
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-label'));
    expect(icons).toHaveLength(5);
    for (const button of icons) expect(button).toHaveAttribute('title');
    expect(screen.getByRole('button', { name: 'Camera' })).toHaveAttribute('title', 'Camera');
  });

  it('End session asks to confirm then routes to library', async () => {
    const { user } = await renderSession();
    const end = screen.getByRole('button', { name: 'End session' });
    await user.click(end);
    const dialog = screen.getByRole('dialog', { name: 'End this session?' });
    // Keep going comes first, so it has focus, and it returns her to the session.
    expect(within(dialog).getByRole('button', { name: 'Keep going' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Keep going' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useRoute.getState().route).toMatchObject({ name: 'session' });
    expect(end).toHaveFocus();

    await user.click(end);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }),
    );
    expect(useRoute.getState().route).toEqual({ name: 'library' });
  });

  it("starts the next session's screen clean, never from the last one's details", async () => {
    await renderSession({ session: TITLED });
    await screen.findByRole('heading', { level: 1, name: 'Strings that start with 010' });
    cleanup();
    // The next session: if its screen first rendered the last session's title, focus would land
    // there, be lost when it went, and never reach the right title.
    await renderSession({ session: { ...UNTITLED, id: 'another-session' } });
    const title = await screen.findByRole('heading', { level: 1, name: 'Untitled Session' });
    expect(title).toHaveFocus();
  });

  it('lands focus on the session title when she arrives, without a ring', async () => {
    await renderSession({ session: TITLED });
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'Strings that start with 010',
    });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title).toHaveClass('focus-visible:outline-none');
  });

  it('offers no other way back than End session (R18)', async () => {
    await renderSession();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it("says so when the session can't be loaded, and End still leads back", async () => {
    const { user } = await renderSession({ session: new Error('Session not found') });
    expect(await screen.findByText("Couldn't load this session")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'End session' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }),
    );
    expect(useRoute.getState().route).toEqual({ name: 'library' });
  });

  it('starts every session from a fresh stage', async () => {
    stage().pin('board');
    stage().pushCaption('tutor', 'From an earlier session');
    await renderSession();
    expect(stage()).toMatchObject({ mode: 'paper', pinned: null, caption: {} });
  });

  it("a paper session mounts the paper panel under P1's TopLine", async () => {
    // A Mac whose Desk View helper can't start: the capture controller runs, and the panel
    // says so in its card. Nothing here reaches a camera.
    const paper: PaperBridge = {
      getConfig: vi.fn(),
      startHelper: vi.fn(async () => ({ ok: false as const, reason: 'missing-binary' as const })),
      stopHelper: vi.fn(async () => {}),
      cameraAccess: vi.fn(async () => 'granted' as const),
      requestCameraAccess: vi.fn(async () => true),
      openCameraSettings: vi.fn(async () => {}),
    };
    vi.stubGlobal('tassel', { platform: 'darwin', paper });
    await renderSession();
    const region = screen.getByRole('region', { name: 'Your paper · Desk View' });
    const card = await within(region).findByRole('status');
    expect(card).toHaveTextContent('No Desk View camera found');
    expect(paper.startHelper).toHaveBeenCalledTimes(1);
    // P1's TopLine keeps the tag, and lies over the panel's body: after it, and above it.
    const tag = within(region).getByText('Your paper · Desk View');
    const topLine = tag.parentElement as HTMLElement;
    expect(topLine).toHaveClass('z-10', 'pointer-events-none');
    expect(region.lastElementChild).toBe(topLine);
    expect(topLine).not.toContainElement(card);
    // Paper's extras ride on the TopLine, after the pin indicator: here, an upload notice.
    act(() =>
      usePaperStore.getState().setUploads({ sent: 0, pending: 1, failed: 1, lastError: 'offline' }),
    );
    const notice = within(topLine).getByText("Ada can't see your latest work yet. Reconnecting…");
    expect(notice).toHaveClass('pointer-events-auto');
    expect(within(topLine).getByText('Pinned · Paper').compareDocumentPosition(notice)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("an unpinned pin indicator leaves the top line's row, so paper's extras sit by the tag", async () => {
    await renderSession();
    const pill = () => screen.getByText('Pinned · Paper').parentElement as HTMLElement;
    // Unpinned: out of the row (after its fade), not an invisible gap before the extras.
    expect(pill()).toHaveClass('hidden');
    expect(pill()).not.toHaveClass('invisible');
    act(() => stage().pin('paper'));
    expect(pill()).toHaveClass('flex');
    expect(pill()).not.toHaveClass('hidden');
  });

  it("the title strip's dot stays neutral until paper is live", async () => {
    // P1's stub has no paper bridge, so the controller stays idle and the store is the test's.
    await renderSession();
    const strip = screen.getByRole('banner');
    const label = await within(strip).findByText('Desk View');
    const dot = () =>
      within(strip)
        .getByText(/^Desk View/)
        .querySelector('[aria-hidden]');
    expect(dot()).toHaveClass('bg-smoke');
    for (const status of [
      'starting',
      'off',
      'denied',
      'unavailable',
      'lost',
      'ended',
      'error',
    ] as const) {
      act(() => usePaperStore.getState().setStatus(status));
      expect(label).toHaveTextContent(/^Desk View$/);
      expect(dot()).toHaveClass('bg-smoke');
    }
    act(() => usePaperStore.getState().setStatus('live'));
    expect(within(strip).getByText('Desk View · Live')).toBeInTheDocument();
    expect(dot()).toHaveClass('bg-live');
    act(() => usePaperStore.getState().setStatus('lost'));
    expect(within(strip).getByText('Desk View')).toBeInTheDocument();
    expect(dot()).toHaveClass('bg-smoke');
  });

  it("a screen session's dot ignores paper's status", async () => {
    await renderSession({ session: { ...UNTITLED, source: 'screen' } });
    const strip = screen.getByRole('banner');
    await within(strip).findByText('Screen');
    act(() => usePaperStore.getState().setStatus('live'));
    expect(within(strip).getByText('Screen')).toBeInTheDocument();
    expect(within(strip).queryByText('Screen · Live')).not.toBeInTheDocument();
  });
});
