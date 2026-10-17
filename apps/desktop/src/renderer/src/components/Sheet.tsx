// A modal sheet on Radix Dialog: a white card with the 24px hero radius over a light ink scrim.
// Radix traps focus inside and closes on Escape. A click on the scrim closes it too, except the
// second click of a double click, which lands there when a double click opened the sheet; a
// press on the scrim never takes focus out. Radix returns focus only to a Dialog.Trigger, which
// a controlled sheet doesn't have, so the sheet remembers what had focus when it opened and puts
// focus back there when it closes.
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useRef } from 'react';
import { cn } from '../lib/cn';
import { firstClickOnly } from '../lib/first-click';

export interface SheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** Optional text under the title; the dialog's accessible description. */
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Sheet({ open, onOpenChange, title, description, children, className }: SheetProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="sheet-scrim"
          onMouseDown={(event) => event.preventDefault()}
          onClick={firstClickOnly(() => onOpenChange(false))}
          className="fixed inset-0 z-40 bg-ink/25 motion-safe:data-[state=open]:animate-[scrim-in_180ms_cubic-bezier(0.16,1,0.3,1)] motion-safe:data-[state=closed]:animate-[scrim-out_120ms_ease-in_forwards]"
        />
        <Dialog.Content
          // The scrim's click closes the sheet, not Radix's press outside: a press can't tell a
          // double click's second click apart (its click count is 0), and a click can.
          onPointerDownOutside={(event) => event.preventDefault()}
          // Fires before focus moves in, so the active element is still the opener.
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            // Preventing the default also skips Radix's return to its (missing) trigger.
            event.preventDefault();
            const target = opener.current;
            opener.current = null;
            if (target?.isConnected) target.focus();
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-48px)] w-[calc(100%-48px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-y-auto overscroll-contain rounded-hero bg-paper p-8 motion-safe:data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(0.16,1,0.3,1)] motion-safe:data-[state=closed]:animate-[sheet-out_120ms_ease-in_forwards]',
            className,
          )}
        >
          <div className="flex flex-col gap-2">
            <Dialog.Title className="text-2xl leading-tight font-w520 text-balance">
              {title}
            </Dialog.Title>
            {description && (
              <Dialog.Description className="text-sm text-smoke-text">
                {description}
              </Dialog.Description>
            )}
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
