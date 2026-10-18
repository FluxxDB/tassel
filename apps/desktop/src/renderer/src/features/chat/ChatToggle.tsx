// The title strip's chat toggle, the rightmost control, above where the sidebar opens. T does
// the same. It names what it shows and says whether the sidebar is open (aria-expanded).
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { Sidebar } from '../../components/icons';
import { cn } from '../../lib/cn';
import { SHORTCUT_KEYS } from '../session/shortcuts';
import { useChatOpen } from './chat-prefs';
import { CHAT_SIDEBAR_ID, toggleChat, useFocusRequest } from './toggle';

export function ChatToggle() {
  const { t } = useTranslation();
  const open = useChatOpen();
  const label = t('session.chat.toggle');
  const button = useRef<HTMLButtonElement>(null);
  // The sidebar closed with focus inside it: focus comes back here.
  useFocusRequest('toggle', () => button.current?.focus());
  return (
    <IconButton
      ref={button}
      label={label}
      title={t('session.dock.withShortcut', { label, key: SHORTCUT_KEYS.chat })}
      aria-keyshortcuts={SHORTCUT_KEYS.chat}
      aria-expanded={open}
      aria-controls={CHAT_SIDEBAR_ID}
      data-chat-toggle=""
      onClick={toggleChat}
      className={cn('-mr-1.5 size-9 [&>svg]:size-5', open && 'bg-ink/[0.06]')}
    >
      <Sidebar />
    </IconButton>
  );
}
