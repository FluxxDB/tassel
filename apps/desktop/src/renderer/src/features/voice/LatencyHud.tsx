import { silenceBudget, VOICE_BUDGETS } from '@tassel/shared/voice';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { percentile } from '../../tutor/live/latency';
import { useVoiceDebug } from './voice-debug';

export function LatencyHud() {
  const { t } = useTranslation();
  const title = useId();
  const { route, turns, client, firstAudio, backchannels, connections, micOpenedAt } =
    useVoiceDebug();
  const lastTurn = turns.at(-1);
  const barge = client.findLast((m) => m.barge_in_ms !== null);
  const yielding = client.findLast((m) => m.barge_in_ms !== null || m.yield_ms !== null);
  const present = (value: number | null): value is number => value !== null;
  // Server typed timings and speaker-measured voice timings have different start/end points.
  // Show percentiles for the displayed source, without blending the two distributions.
  const firstValues =
    firstAudio?.source === 'server'
      ? turns
          .filter((m) => m.input === 'typed')
          .map((m) => m.server_ttfa_ms)
          .filter(present)
      : client.map((m) => m.ttfa_ms).filter(present);
  const duration = (ms: number | null | undefined) =>
    ms == null ? t('voice.hud.unavailable') : t('voice.hud.duration', { ms: Math.round(ms) });
  return (
    <section
      aria-labelledby={title}
      className="mono absolute top-4 left-4 z-20 max-w-[calc(100%-32px)] rounded-card-sm border border-hairline bg-paper/95 p-3 text-[11px] leading-relaxed text-ink"
    >
      <h2 id={title} className="mb-1 font-medium uppercase tracking-[0.025em]">
        {t('voice.hud.title')}
      </h2>
      <p data-testid="hud-route" className="mb-2 break-words text-smoke-text">
        {route
          ? [route.lang, route.stt, route.llm, route.tts].map((s) => s.toUpperCase()).join(' · ')
          : t('voice.hud.unavailable')}
      </p>
      <dl className="space-y-2">
        <Metric
          testId="hud-first-audio"
          label={t('voice.hud.firstAudio')}
          value={firstAudio?.ms ?? null}
          values={firstValues}
          budget={VOICE_BUDGETS.ttfa_ms[firstAudio?.lang ?? route?.lang ?? 'en']}
          server={firstAudio?.source === 'server'}
        />
        <Metric
          testId="hud-barge-in"
          label={t('voice.hud.bargeIn')}
          value={barge?.barge_in_ms ?? null}
          values={client.map((m) => m.barge_in_ms).filter(present)}
          budget={silenceBudget(barge?.sensitivity ?? 'normal')}
        />
        <Metric
          testId="hud-yield"
          label={t('voice.hud.yield')}
          value={yielding?.yield_ms ?? null}
          values={client.map((m) => m.yield_ms).filter(present)}
          budget={VOICE_BUDGETS.yield_ms}
        />
      </dl>
      <dl className="mt-2 flex flex-wrap gap-x-3 border-t border-hairline pt-2 text-smoke-text">
        <div>
          <dt>{t('voice.hud.stt')}</dt>
          <dd>{duration(lastTurn?.stt_ms)}</dd>
        </div>
        <div>
          <dt>{t('voice.hud.llm')}</dt>
          <dd>{duration(lastTurn?.llm_ttfb_ms)}</dd>
        </div>
        <div>
          <dt>{t('voice.hud.tts')}</dt>
          <dd>{duration(lastTurn?.tts_ttfb_ms)}</dd>
        </div>
      </dl>
      <dl className="mt-2 space-y-1 text-smoke-text">
        <div data-testid="hud-backchannels" className="flex justify-between gap-4">
          <dt>{t('voice.hud.backchannels')}</dt>
          <dd>{backchannels}</dd>
        </div>
        <div data-testid="hud-connections" className="flex justify-between gap-4">
          <dt>{t('voice.hud.connections')}</dt>
          <dd>{connections}</dd>
        </div>
        <div data-testid="hud-mic-opened-at" className="flex justify-between gap-4">
          <dt>{t('voice.hud.micOpenedAt')}</dt>
          <dd>{duration(micOpenedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Metric({
  testId,
  label,
  value,
  values,
  budget,
  server = false,
}: {
  testId: string;
  label: string;
  value: number | null;
  values: number[];
  budget: number;
  server?: boolean;
}) {
  const { t } = useTranslation();
  const duration = (ms: number | null) =>
    ms === null ? t('voice.hud.unavailable') : t('voice.hud.duration', { ms: Math.round(ms) });
  return (
    <div
      data-testid={testId}
      className={value !== null && value > budget ? 'text-live' : 'text-ink'}
    >
      <dt>{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-3">
        <span>
          {duration(value)}
          {server && <> · {t('voice.hud.server')}</>}
        </span>
        <span>
          {t('voice.hud.percentiles', {
            p50: duration(percentile(values, 50)),
            p90: duration(percentile(values, 90)),
          })}
        </span>
        <span className="text-smoke-text">{t('voice.hud.budget', { ms: budget })}</span>
      </dd>
    </div>
  );
}
