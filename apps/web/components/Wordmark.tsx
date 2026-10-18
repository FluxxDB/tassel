// The Tassel wordmark, as in the desktop app (apps/desktop/.../components/Wordmark.tsx): the tassel
// glyph and the name, lowercase. `inverse` draws it in paper on an ink background.
import { cn } from '../lib/cn';

export function Wordmark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-[7px] text-[17px] leading-none font-w520',
        inverse ? 'text-paper' : 'text-ink',
      )}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true" focusable="false">
        <path d="M9 0v4" className={inverse ? 'stroke-paper' : 'stroke-ink'} strokeWidth="1.6" />
        <circle cx="9" cy="6" r="2.6" className={inverse ? 'fill-paper' : 'fill-ink'} />
        <path d="M6 9h6l2 10H4z" className={inverse ? 'fill-paper' : 'fill-ink'} />
        <path
          d="M7.4 11v7M10.6 11v7"
          className={inverse ? 'stroke-ink' : 'stroke-bone'}
          strokeWidth="1"
        />
      </svg>
      <span translate="no" className="lowercase leading-none tracking-[-0.025em]">
        Tassel
      </span>
    </span>
  );
}
