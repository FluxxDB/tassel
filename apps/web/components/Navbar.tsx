import { DownloadButton } from './DownloadButton';
import { Wordmark } from './Wordmark';

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#tutor', label: 'Your tutor' },
  { href: '#download', label: 'Download' },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-bone/90 backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <a href="#top" aria-label="Tassel home" className="rounded-input">
          <Wordmark />
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <ul className="hidden items-center gap-1 sm:flex">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex h-9 items-center rounded-pill px-3.5 text-sm text-smoke-text transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <DownloadButton size="sm" />
        </div>
      </nav>
    </header>
  );
}
