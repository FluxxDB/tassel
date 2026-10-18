// "How you'll work": paper, screen share or just talk, as option cards, each saying what it
// means. Shared by the new session sheet and Settings → Session defaults. Paper can't be chosen
// on Windows (no Desk View) unless the run plays the fake clip or uses a webcam.
import type { Source } from '@tassel/shared/api';
import { useTranslation } from 'react-i18next';
import type { Platform } from '../../../../shared/bridge';
import { Mic, Paper, Screen } from '../../components/icons';
import { OptionCards } from '../../components/OptionCards';
import { getPaperConfig } from '../../paper/paper-config';
import { paperUnavailable } from './defaults';

const SOURCES: readonly Source[] = ['paper', 'screen', 'talk'];
const ICONS = { paper: <Paper />, screen: <Screen />, talk: <Mic /> } as const;

export interface SourceCardsProps {
  platform: Platform;
  value: Source;
  onChange(value: Source): void;
  paperFakeClip?: boolean;
  paperWebcam?: boolean;
  describedBy?: string;
}

export function SourceCards({
  platform,
  value,
  onChange,
  paperFakeClip = getPaperConfig().fakeClip,
  paperWebcam = getPaperConfig().source === 'webcam',
  describedBy,
}: SourceCardsProps) {
  const { t } = useTranslation();
  return (
    <OptionCards<Source>
      label={t('newSession.groups.source')}
      describedBy={describedBy}
      value={value}
      onChange={onChange}
      options={SOURCES.map((source) => ({
        value: source,
        icon: ICONS[source],
        label:
          source === 'paper' && paperWebcam
            ? t('paper.webcam.choice')
            : t(`newSession.source.${source}`),
        description:
          source === 'paper' && paperWebcam
            ? t('newSession.sourceHint.webcam')
            : t(`newSession.sourceHint.${source}`),
        disabled: source === 'paper' && paperUnavailable(platform, paperFakeClip, paperWebcam),
      }))}
    />
  );
}
