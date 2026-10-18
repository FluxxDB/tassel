// A title being renamed in place: a text field that takes focus with its text selected. Enter
// (or leaving the field) saves, Escape cancels. An unchanged or empty title saves nothing. While
// the save runs the field stays; if it fails, it stays open and says so.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';

/** The server's limit (SessionPatch.title). */
export const TITLE_MAX = 80;

export interface TitleFieldProps {
  initial: string;
  label: string;
  lang?: string;
  onSave(title: string): Promise<void>;
  /** After a save, or a cancel. */
  onDone(): void;
  className?: string;
}

export function TitleField({ initial, label, lang, onSave, onDone, className }: TitleFieldProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Escape and Enter end the edit before the blur that follows, which must then do nothing.
  const ended = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = async () => {
    if (ended.current || saving) return;
    const title = value.trim();
    if (title === '' || title === initial.trim()) {
      ended.current = true;
      onDone();
      return;
    }
    setSaving(true);
    try {
      await onSave(title);
      ended.current = true;
      onDone();
    } catch {
      setFailed(true);
      setSaving(false);
      input.current?.focus();
    }
  };

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <input
        ref={input}
        value={value}
        lang={lang}
        name="title"
        autoComplete="off"
        maxLength={TITLE_MAX}
        aria-label={label}
        aria-invalid={failed || undefined}
        readOnly={saving}
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          setFailed(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void finish();
          } else if (event.key === 'Escape') {
            // Only the edit ends: not the sheet or view around it.
            event.preventDefault();
            event.stopPropagation();
            ended.current = true;
            onDone();
          }
        }}
        onBlur={() => void finish()}
        className={cn(
          'w-full rounded-input bg-paper text-ink shadow-[0_0_0_1px_var(--color-smoke)] outline-none focus-visible:shadow-[0_0_0_1.5px_var(--color-ink)] aria-invalid:shadow-[0_0_0_1.5px_var(--color-live)]',
          className,
        )}
      />
      {failed && (
        <span role="alert" className="text-[12px] leading-4 font-normal text-ink">
          {t('session.title.renameFailed')}
        </span>
      )}
    </span>
  );
}
