// Ada's marks in words, for screen readers: a visually hidden list in the session's language,
// one line per mark, in the order she made them.
import { type PaperMark, type PaperTarget, parseElementRef } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import type { TFunction } from 'i18next';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function MarksDescription({
  marks,
  lang,
}: {
  marks: PaperMark[];
  lang: Lang;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (marks.length === 0) return null;
  return (
    <ul aria-label={t('marks.description.label', { lng: lang })} lang={lang} className="sr-only">
      {marks.map((mark) => (
        <li key={`${mark.type}-${mark.id}`}>{describeMark(t, mark, lang)}</li>
      ))}
    </ul>
  );
}

function describeMark(t: TFunction, mark: PaperMark, lng: Lang): string {
  switch (mark.type) {
    case 'step':
      return t('marks.description.step', {
        n: mark.n,
        target: describeTarget(t, mark.target, lng),
        lng,
      });
    case 'circle':
      return t('marks.description.circle', { target: describeTarget(t, mark.target, lng), lng });
    case 'callout':
      return t('marks.description.note', { text: mark.text, lng });
    case 'arrow':
      return t('marks.description.arrow', { target: describeTarget(t, mark.to, lng), lng });
    case 'strike':
      return t('marks.description.strike', { target: describeTarget(t, mark.target, lng), lng });
    case 'underline':
      return t('marks.description.underline', {
        target: describeTarget(t, mark.target, lng),
        lng,
      });
    case 'check':
      return t('marks.description.check', { target: describeTarget(t, mark.target, lng), lng });
  }
}

/** "state q1", "q0 to q1", "the start arrow", or, for a point or a box, "a spot on your paper". */
function describeTarget(t: TFunction, target: PaperTarget, lng: Lang): string {
  const ref = 'el' in target ? parseElementRef(target.el) : null;
  if (ref?.kind === 'state') return t('marks.target.state', { id: ref.id, lng });
  if (ref?.kind === 'edge') return t('marks.target.edge', { from: ref.from, to: ref.to, lng });
  if (ref?.kind === 'start') return t('marks.target.start', { lng });
  return t('marks.target.point', { lng });
}
