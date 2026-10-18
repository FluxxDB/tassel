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

export const Pin = icon('Pin', <path d="M9 3h6M10 3v5.5L7 12h10l-3-3.5V3M12 12v8" />);

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

export const Sliders = icon(
  'Sliders',
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>,
);

/** The chat sidebar's toggle: a window with its right column drawn. */
export const Sidebar = icon(
  'Sidebar',
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M14.5 4v16M17 8.5h1M17 11.5h1" />
  </>,
);

export const Paperclip = icon(
  'Paperclip',
  <path d="M19 11.5 12.2 18.3a4.6 4.6 0 0 1-6.5-6.5L12.9 4.6a3 3 0 0 1 4.3 4.3l-7 7a1.5 1.5 0 0 1-2.1-2.1l6.4-6.4" />,
);

/** "Snap my paper": a sheet inside a viewfinder's corners. */
export const Snap = icon(
  'Snap',
  <>
    <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
    <path d="M8.5 7.5h7v9h-7zM10.5 10.5h3M10.5 13.5h2" />
  </>,
);

export const ArrowUp = icon('ArrowUp', <path d="M12 19V5M6 11l6-6 6 6" />);

export const Speaker = icon(
  'Speaker',
  <>
    <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </>,
);

export const SpeakerOff = icon(
  'SpeakerOff',
  <>
    <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </>,
);

/** Her paper, as the stage's paper side. */
export const Paper = icon(
  'Paper',
  <>
    <path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7z" />
    <path d="M14.5 3v4h4M9 12h6M9 15.5h4" />
  </>,
);

export const ImageIcon = icon(
  'Image',
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 15.5-4.5-4.5L7 19.5" />
  </>,
);

/** Undo; mirrored, it's redo. */
export const Undo = icon('Undo', <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />);

/** An arrow down onto a tray: a file saved to the desk. */
export const Download = icon('Download', <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />);
export const Pause = icon('Pause', <path d="M8 5v14M16 5v14" />);
export const Play = icon('Play', <path d="m8 5 11 7-11 7Z" />);
export const Pencil = icon(
  'Pencil',
  <>
    <path d="m4 16-1 5 5-1L20 8l-4-4Z" />
    <path d="m13 7 4 4" />
  </>,
);
export const UndoRound = icon('UndoRound', <path d="M8 4 3 9l5 5M3 9h10a6 6 0 0 1 0 12h-3" />);
