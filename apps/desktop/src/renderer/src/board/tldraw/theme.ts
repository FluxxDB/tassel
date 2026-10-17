// The board's tldraw theme: tldraw's light palette in Tassel's hand. Black is ink, violet is
// Ada's iris-ink and light violet her iris (DESIGN.md: iris belongs to Ada alone), and text sets
// in Geist, with Pretendard for Hangul, which P1's fonts.css already loads.
import { DEFAULT_THEME, type TLDefaultColor, type TLTheme } from 'tldraw';

declare module 'tldraw' {
  interface TLThemes {
    tassel: TLTheme;
  }
}

const INK = '#222222';
const IRIS_INK = '#7d4fc4';
const IRIS = '#c094e4';

const light = DEFAULT_THEME.colors.light;

/** A palette color whose strokes and solid fills are `hex`; its washes stay tldraw's. */
function solid(color: TLDefaultColor, hex: string): TLDefaultColor {
  return { ...color, solid: hex, fill: hex };
}

export const TASSEL_THEME: TLTheme = {
  ...DEFAULT_THEME,
  id: 'tassel',
  fonts: {
    ...DEFAULT_THEME.fonts,
    sans: { fontFamily: 'Geist, "Pretendard Variable", sans-serif' },
    mono: { fontFamily: '"Geist Mono", "Pretendard Variable", monospace' },
  },
  colors: {
    ...DEFAULT_THEME.colors,
    light: {
      ...light,
      black: solid(light.black, INK),
      violet: solid(light.violet, IRIS_INK),
      'light-violet': solid(light['light-violet'], IRIS),
    },
  },
};
