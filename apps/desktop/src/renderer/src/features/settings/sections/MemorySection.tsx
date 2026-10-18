// Settings → Memory: the preferences Ada keeps between sessions (tone, pace, language, hints),
// which she can edit or delete all of. Content never carries over (workstream M's server rule).
import { MemoryPanel } from '../../../avatar/MemoryPanel';
import { SettingsGroup } from '../SettingsView';

export function MemorySection({ open }: { open: boolean }) {
  return (
    <SettingsGroup>
      <MemoryPanel open={open} />
    </SettingsGroup>
  );
}
