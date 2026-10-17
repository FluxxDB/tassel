// The language of what Ada puts on the board and the paper: the session's, which can differ from
// the UI's (a Spanish session in an English app). Chrome stays in the UI language.
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { useTranslation } from 'react-i18next';
import { useCurrentSession } from '../features/session/current-session';

/**
 * The open session's language, else (before it loads) the UI language. Use it with
 * `t(key, { lng })`. Like useCurrentSession, it needs <ApiProvider>.
 */
export function useSessionLang(): Lang {
  const { session } = useCurrentSession();
  const { i18n } = useTranslation();
  if (session) return session.language;
  const ui = i18n.resolvedLanguage ?? i18n.language;
  return SUPPORTED_LANGS.find((lang) => lang === ui) ?? 'en';
}
