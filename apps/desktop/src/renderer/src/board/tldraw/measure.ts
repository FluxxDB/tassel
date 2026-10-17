// How big Ada's text is when her shapes set it: Track B's MeasureText, in the DOM. Each style is
// the shapes' own (figures.tsx's TEXT_STYLE), in the session's language, so a note or a verdict
// pill wraps where it was measured, Korean words whole.
import type { Lang } from '@tassel/shared/i18n';
import type { MeasureText } from '../scene/placement';
import { TEXT_STYLE } from './shapes/figures';

export interface TextMeasure {
  measure: MeasureText;
  dispose(): void;
}

/** Measures in a hidden element inside `host`, which should hold the shapes too. */
export function createTextMeasure(host: HTMLElement, lang: () => Lang): TextMeasure {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'absolute',
    left: '-10000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: 'max-content',
    whiteSpace: 'normal',
    overflowWrap: 'break-word',
  });
  const text = document.createElement('span');
  box.append(text);
  host.append(box);
  const range = document.createRange();
  const sizes = new Map<string, { w: number; h: number }>();

  const measure: MeasureText = (value, style, maxWidth) => {
    const language = lang();
    const key = JSON.stringify([language, style, maxWidth, value]);
    const known = sizes.get(key);
    if (known) return known;
    const { fontFamily, fontSize, fontWeight, lineHeight } = TEXT_STYLE[style];
    box.lang = language;
    Object.assign(box.style, {
      fontFamily,
      fontSize: `${fontSize}px`,
      fontWeight: String(fontWeight),
      lineHeight,
      maxWidth: `${maxWidth}px`,
    });
    text.textContent = value;
    // The widest line: one client rect per line the text wraps onto.
    range.selectNodeContents(text);
    const lines = [...range.getClientRects()];
    const w = Math.ceil(Math.max(0, ...lines.map((line) => line.width)));
    const h = Math.ceil(box.getBoundingClientRect().height);
    const size = { w, h };
    sizes.set(key, size);
    return size;
  };

  return {
    measure,
    dispose() {
      range.detach();
      box.remove();
      sizes.clear();
    },
  };
}
