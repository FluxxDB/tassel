// Tassel's icon set: 24px line icons with one 1.6 stroke, drawn in currentColor. Decorative
// only: the control that holds an icon carries the accessible name.
import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

function icon(name: string, paths: ReactNode) {
  function Icon(props: IconProps) {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const Mic = icon(
  'Mic',
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);

export const MicOff = icon(
  'MicOff',
  <>
    <path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 5 2.2" />
    <path d="M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.9 3.4M12 18v3M4 4l16 16" />
  </>,
);

export const Camera = icon(
  'Camera',
  <>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="M16 10l5-3v10l-5-3" />
  </>,
);

export const Screen = icon(
  'Screen',
  <>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5" />
  </>,
);

export const Board = icon(
  'Board',
  <>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M7 14l3-4 3 3 4-5" />
  </>,
);

export const Captions = icon(
  'Captions',
  <>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" />
  </>,
);

export const Globe = icon(
  'Globe',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
);

export const Plus = icon('Plus', <path d="M12 5v14M5 12h14" />);

export const Close = icon('Close', <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);

export const Search = icon(
  'Search',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </>,
);

export const Retry = icon(
  'Retry',
  <>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" />
    <path d="M19.5 4.5V9H15" />
  </>,
);
