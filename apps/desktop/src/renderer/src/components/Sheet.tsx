// A modal sheet on Radix Dialog: a white card with the 24px hero radius over a light ink scrim.
// Radix traps focus inside, closes on Escape or a click outside, and returns focus to the
// control that opened it.
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25 motion-safe:data-[state=open]:animate-[scrim-in_180ms_cubic-bezier(0.16,1,0.3,1)] motion-safe:data-[state=closed]:animate-[scrim-out_120ms_ease-in_forwards]" />
        <Dialog.Content
          // Without a description, say so: Radix otherwise warns that one is missing.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-48px)] w-[calc(100%-48px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-y-auto rounded-hero bg-paper p-8 motion-safe:data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(0.16,1,0.3,1)] motion-safe:data-[state=closed]:animate-[sheet-out_120ms_ease-in_forwards]',
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
