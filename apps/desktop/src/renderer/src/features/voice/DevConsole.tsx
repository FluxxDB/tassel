import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';

export function DevConsole({ onSend }: { onSend(text: string): void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const composing = useRef(false);
  return (
    <form
      className="rounded-card-sm border border-hairline bg-paper p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const message = text.trim();
        if (!message || composing.current) return;
        onSend(message);
        setText('');
      }}
    >
      <label
        htmlFor={id}
        className="mono mb-2 block text-[11px] uppercase tracking-[0.025em] text-smoke-text"
      >
        {t('voice.dev.label')}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          value={text}
          placeholder={t('voice.dev.placeholder')}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
            )
              event.preventDefault();
          }}
          className="h-10 min-w-0 flex-1 rounded-input border border-hairline bg-paper px-3 text-sm text-ink placeholder:text-smoke-text"
        />
        <Button type="submit" disabled={!text.trim()}>
          {t('voice.dev.send')}
        </Button>
      </div>
    </form>
  );
}
