// The Tassel wordmark: the tassel glyph and the name, lowercase, as in the chosen mock.
import { useTranslation } from 'react-i18next';

export function Wordmark() {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-2 text-[17px] leading-none font-w520 text-ink">
      <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true" focusable="false">
        <path d="M9 0v4" className="stroke-ink" strokeWidth="1.6" />
        <circle cx="9" cy="6" r="2.6" className="fill-ink" />
        <path d="M6 9h6l2 10H4z" className="fill-ink" />
        <path d="M7.4 11v7M10.6 11v7" className="stroke-bone" strokeWidth="1" />
      </svg>
      <span className="lowercase">{t('app.name')}</span>
    </span>
  );
}
