// Settings → Personality: the tutor she wants, in her own words.
import { PersonalityPanel } from '../../../avatar/PersonalityPanel';
import { SettingsGroup } from '../SettingsView';

export function PersonalitySection({ open }: { open: boolean }) {
  return (
    <SettingsGroup>
      <PersonalityPanel open={open} />
    </SettingsGroup>
  );
}
