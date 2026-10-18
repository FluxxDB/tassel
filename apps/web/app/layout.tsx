import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tassel — a live AI tutor for Mac',
  description:
    'Tassel is a tutor that sees your work and draws with you: it watches the paper or screen in front of you, talks it through out loud, and marks up your own work. In English, Spanish and Korean.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
