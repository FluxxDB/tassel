// The desktop app's line icons (apps/desktop/src/renderer/src/components/icons.tsx) that the hero's
// session mock shows: 24px, one 1.6 stroke, currentColor, decorative only.
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function icon(paths: ReactNode) {
  return function Icon(props: IconProps) {
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
  };
}

export const Mic = icon(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);

export const Camera = icon(
  <>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="M16 10l5-3v10l-5-3" />
  </>,
);

export const Screen = icon(
  <>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5" />
  </>,
);

export const Board = icon(
  <>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M7 14l3-4 3 3 4-5" />
  </>,
);

export const Captions = icon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" />
  </>,
);

export const Paperclip = icon(
  <path d="M19 11.5 12.2 18.3a4.6 4.6 0 0 1-6.5-6.5L12.9 4.6a3 3 0 0 1 4.3 4.3l-7 7a1.5 1.5 0 0 1-2.1-2.1l6.4-6.4" />,
);
