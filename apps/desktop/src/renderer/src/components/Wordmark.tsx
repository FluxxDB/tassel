// The Tassel wordmark: the tassel glyph and the name, lowercase, as in the chosen mock. It looks
// the same in every UI language: its tracking and leading are set here, not by :lang(ko).
import { useTranslation } from 'react-i18next';

/** `small` in the session's strip, where the title leads. */
export function Wordmark({ small = false }: { small?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`flex shrink-0 items-center leading-none font-w520 text-ink ${small ? 'gap-1.5 text-[15px]' : 'gap-[7px] text-[17px]'}`}
    >
      <svg
        width={small ? 15 : 18}
        height={small ? 17 : 20}
        viewBox="0 0 18 20"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9 0v4" className="stroke-ink" strokeWidth="1.6" />
        <circle cx="9" cy="6" r="2.6" className="fill-ink" />
        <path d="M6 9h6l2 10H4z" className="fill-ink" />
        <path d="M7.4 11v7M10.6 11v7" className="stroke-bone" strokeWidth="1" />
      </svg>
      <span translate="no" className="lowercase leading-none tracking-[-0.025em]">
        {t('app.name')}
      </span>
    </span>
  );
}
