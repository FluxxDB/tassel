// Settings → Voice & audio: the same panel as the dock's audio popover, outside a session too.
import { AudioSettingsPanel } from '../../voice/AudioSettings';
import { SettingsGroup } from '../SettingsView';

export function VoiceSection() {
  return (
    <SettingsGroup>
      <AudioSettingsPanel />
    </SettingsGroup>
  );
}
