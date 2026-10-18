// Settings → Tutor: Ada's look, name and voice per language (the tutor editor).
import { TutorEditor } from '../../../avatar/TutorEditor';
import '../../../avatar/avatar.css';
import { SettingsGroup } from '../SettingsView';

export function TutorSection({ open }: { open: boolean }) {
  return (
    <SettingsGroup className="avatar-customizer relative isolate pb-0">
      <TutorEditor open={open} />
    </SettingsGroup>
  );
}
