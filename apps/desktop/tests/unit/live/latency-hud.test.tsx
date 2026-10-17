// @vitest-environment jsdom
import type { ClientMetrics, RouteEvent, TurnMetrics } from '@tassel/shared/voice';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { LatencyHud } from '../../../src/renderer/src/features/voice/LatencyHud';
import { useVoiceDebug } from '../../../src/renderer/src/features/voice/voice-debug';
import { initI18n } from '../../../src/renderer/src/i18n';

const route: RouteEvent = { kind: 'route', lang: 'en', stt: 'fake', llm: 'fake', tts: 'fake' };
const turn: TurnMetrics = {
  turn: 1,
  lang: 'en',
  input: 'typed',
  stt_ms: null,
  llm_ttfb_ms: 120,
  tts_ttfb_ms: 150,
  server_ttfa_ms: 900,
  interrupted: false,
  budget_ms: 1200,
};
const push = (event: Parameters<ReturnType<typeof useVoiceDebug.getState>['push']>[0]) =>
  act(() => useVoiceDebug.getState().push(event));
function client(overrides: Partial<ClientMetrics>) {
  push({
    kind: 'client-metrics',
    ttfa_ms: null,
    barge_in_ms: null,
    yield_ms: null,
    sensitivity: 'normal',
    ...overrides,
  });
}
async function hud() {
  render(
    <I18nextProvider i18n={await initI18n('en')}>
      <LatencyHud />
    </I18nextProvider>,
  );
}
beforeEach(() => useVoiceDebug.getState().reset());
describe('voice debug store', () => {
  it('counts route events, retains histories, and resets the whole session', () => {
    push(route);
    push(route);
    push({ kind: 'backchannel', text: 'uh-huh' });
    push({ kind: 'turn-metrics', metrics: turn });
    client({ ttfa_ms: 900 });
    useVoiceDebug.getState().setMicOpenedAt(0);
    expect(useVoiceDebug.getState()).toMatchObject({
      route,
      connections: 2,
      backchannels: 1,
      turns: [turn],
      client: [{ ttfa_ms: 900 }],
      micOpenedAt: 0,
    });
    useVoiceDebug.getState().reset();
    expect(useVoiceDebug.getState()).toMatchObject({
      route: null,
      connections: 0,
      backchannels: 0,
      turns: [],
      client: [],
      micOpenedAt: null,
    });
  });
});
describe('LatencyHud', () => {
  it('shows a mono stage overlay, route, counts and a mic timestamp including zero', async () => {
    push(route);
    push(route);
    push({ kind: 'backchannel', text: 'yes' });
    useVoiceDebug.getState().setMicOpenedAt(0);
    await hud();
    expect(screen.getByRole('region', { name: 'Latency' })).toHaveClass(
      'mono',
      'absolute',
      'top-4',
      'left-4',
    );
    expect(screen.getByTestId('hud-route')).toHaveTextContent('EN · FAKE · FAKE · FAKE');
    expect(screen.getByTestId('hud-connections')).toHaveTextContent('2');
    expect(screen.getByTestId('hud-backchannels')).toHaveTextContent('1');
    expect(screen.getByTestId('hud-mic-opened-at')).toHaveTextContent('0 ms');
  });
  it.each([
    ['normal', false],
    ['high', true],
  ] as const)('judges barge-in using its recorded %s sensitivity', async (sensitivity, red) => {
    client({ barge_in_ms: 450, yield_ms: 250, sensitivity });
    await hud();
    expect(screen.getByTestId('hud-barge-in').classList.contains('text-live')).toBe(red);
    expect(screen.getByTestId('hud-yield')).not.toHaveClass('text-live');
  });
  it('marks slow English first audio and yield independently, with session percentiles', async () => {
    push(route);
    for (const ttfa_ms of [800, 900, 1000, 1100, 1300, 1500]) client({ ttfa_ms });
    client({ barge_in_ms: 450, yield_ms: 350 });
    await hud();
    expect(screen.getByTestId('hud-first-audio')).toHaveClass('text-live');
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('1500 ms');
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('p50 1000 ms · p90 1500 ms');
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('Budget 1200 ms');
    expect(screen.getByTestId('hud-yield')).toHaveClass('text-live');
  });
  it('uses the language at measurement time for the first-audio budget', async () => {
    push({ ...route, lang: 'ko' });
    client({ ttfa_ms: 1300 });
    push(route);
    await hud();
    expect(screen.getByTestId('hud-first-audio')).not.toHaveClass('text-live');
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('Budget 1400 ms');
  });
  it('shows a typed turn server timing, then allows a newer client measurement to replace it', async () => {
    push(route);
    client({ ttfa_ms: 1500 });
    push({ kind: 'turn-metrics', metrics: turn });
    await hud();
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('900 ms');
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('server');
    expect(screen.getByTestId('hud-first-audio')).not.toHaveClass('text-live');
    expect(screen.getByText('STT')).toBeInTheDocument();
    expect(screen.getByText('120 ms')).toBeInTheDocument();
    expect(screen.getByText('150 ms')).toBeInTheDocument();
    client({ barge_in_ms: 400 });
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('server');
    client({ ttfa_ms: 800 });
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('800 ms');
    expect(screen.getByTestId('hud-first-audio')).not.toHaveTextContent('server');
  });
  it('shows missing measurements as unavailable, never zero or an old typed timing', async () => {
    await hud();
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent('—');
    expect(screen.getByTestId('hud-mic-opened-at')).toHaveTextContent('—');
    push({ kind: 'turn-metrics', metrics: turn });
    push({ kind: 'turn-metrics', metrics: { ...turn, turn: 2, server_ttfa_ms: null } });
    expect(screen.getByTestId('hud-first-audio')).toHaveTextContent(/^First audio— · server/);
  });
});
