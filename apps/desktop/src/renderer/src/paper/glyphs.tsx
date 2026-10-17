// The paper panel's state glyphs: 32px line drawings in icons.tsx's hand (one 1.6 stroke, round
// ends, currentColor). Decorative only: the state card's title says what each one means.
import type { ReactNode, SVGProps } from 'react';

export type GlyphProps = SVGProps<SVGSVGElement>;

function glyph(name: string, paths: ReactNode) {
  function Glyph(props: GlyphProps) {
    return (
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
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
  Glyph.displayName = name;
  return Glyph;
}

const CAMERA = (
  <>
    <rect x="4" y="9" width="17" height="14" rx="3.5" />
    <path d="m21 13.5 7-4v13l-7-4" />
  </>
);

/** Starting: the camera, waiting. */
export const CameraGlyph = glyph('CameraGlyph', CAMERA);

/** Off: the camera, struck through. */
export const CameraOffGlyph = glyph(
  'CameraOffGlyph',
  <>
    {CAMERA}
    <path d="m5 5 22 22" />
  </>,
);

/** Denied: a padlock. The camera is there, but Tassel may not use it. */
export const LockGlyph = glyph(
  'LockGlyph',
  <>
    <rect x="8" y="14" width="16" height="12" rx="3" />
    <path d="M11.5 14v-3a4.5 4.5 0 0 1 9 0v3M16 19v2.5" />
  </>,
);

/** Unavailable: P1's Desk View glyph (a camera looking down at a sheet), with an empty sheet. */
export const DeskViewGlyph = glyph(
  'DeskViewGlyph',
  <>
    <rect x="11" y="3" width="10" height="6.5" rx="2" />
    <path d="m13 12.5-3.5 5.5M19 12.5l3.5 5.5" strokeDasharray="1.5 2.5" />
    <path d="M5 20h22l-2.7 8.5H7.7z" />
  </>,
);

/** Lost: the camera's outline broken up, as if it faded out. */
export const CameraLostGlyph = glyph(
  'CameraLostGlyph',
  <>
    <rect x="4" y="9" width="17" height="14" rx="3.5" strokeDasharray="3 2.6" />
    <path d="m21 13.5 7-4v13l-7-4" strokeDasharray="3 2.6" />
  </>,
);

/** Ended: a window, its sharing stopped. */
export const WindowGlyph = glyph(
  'WindowGlyph',
  <>
    <rect x="4" y="6" width="24" height="20" rx="3" />
    <path d="M4 11h24M7.5 8.5h.01M10.5 8.5h.01M12.5 16.5l7 7M19.5 16.5l-7 7" />
  </>,
);

/** Error: a circle with a mark. */
export const AlertGlyph = glyph(
  'AlertGlyph',
  <>
    <circle cx="16" cy="16" r="11" />
    <path d="M16 10.5v7M16 21.5v.01" />
  </>,
);
