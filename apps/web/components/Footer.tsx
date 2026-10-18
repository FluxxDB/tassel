import { Wordmark } from './Wordmark';

const LINKS = [
  { href: '#download', label: 'Download' },
  { href: '#features', label: 'Features' },
  { href: '#', label: 'Privacy' },
  { href: '#', label: 'Contact' },
];

export function Footer() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-xs text-sm text-smoke-text">
            A live AI tutor that sees your work and draws with you.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} className="text-smoke-text transition-colors hover:text-ink">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-hairline px-4 py-6 text-smoke-text sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-[13px]">© 2026 Tassel</p>
        <p className="mono text-[11px]">Made for macOS</p>
      </div>
    </footer>
  );
}
