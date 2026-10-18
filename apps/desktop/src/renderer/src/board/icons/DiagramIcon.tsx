// The icons a diagram's nodes show (DIAGRAM_ICONS): small stroke drawings on a 24 px grid, in the
// ink they're drawn in (currentColor), 1.5 px, round caps, no fills: DESIGN.md's minimal
// monochrome strokes. Inline SVG, so the board loads nothing for them, and plain React, so they
// draw in jsdom too.
import type { DiagramIcon as Icon } from '@tassel/shared/beats';
import type { JSX } from 'react';

/** Each icon's marks inside a 24 × 24 view box. */
const MARKS: Readonly<Record<Icon, JSX.Element>> = {
  // Cisco's router: a disc with two arrows in and two out.
  router: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 7.5l3 3m0 0H8m2.5 0V8M16.5 16.5l-3-3m0 0H16m-2.5 0V16" />
      <path d="M13.5 10.5l3-3m0 0H14m2.5 0V10M10.5 13.5l-3 3m0 0H10m-2.5 0V14" />
    </>
  ),
  // A switch: a flat box with traffic both ways.
  switch: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <path d="M7 10.25h9.5m-2-2 2 2-2 2M17 13.75H7.5m2-2-2 2 2 2" />
    </>
  ),
  pc: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M12 16v4M8.5 20h7" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1" />
      <path d="M2.5 18.5h19L19.5 15h-15z" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="3.5" width="16" height="7" rx="1.5" />
      <rect x="4" y="13.5" width="16" height="7" rx="1.5" />
      <path d="M7.5 7h.01M7.5 17h.01M11 7h5.5M11 17h5.5" />
    </>
  ),
  cloud: <path d="M7 18h10.5a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.3 9.5 4.25 4.25 0 0 0 7 18z" />,
  // A firewall: a wall of offset bricks.
  firewall: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 9.67h18M3 14.33h18M9 5v4.67M15 5v4.67M6 9.67v4.66M12 9.67v4.66M18 9.67v4.66M9 14.33V19M15 14.33V19" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6M5 12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" />
    </>
  ),
  box: <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />,
  circle: <circle cx="12" cy="12" r="8" />,
};

/** `icon` at `size` px, ink-colored by its parent. Decorative: its node card names it. */
export function DiagramIcon({ icon, size }: { icon: Icon; size: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={icon}
    >
      {MARKS[icon] ?? MARKS.box}
    </svg>
  );
}
