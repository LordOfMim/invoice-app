"use client";

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  returnFocusSelector?: string;
};

export function Dialog({ open, onClose, children, returnFocusSelector }: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const closeDialog = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const content = contentRef.current;
    const title = content?.querySelector("h2");
    if (title) {
      title.id ||= "active-dialog-title";
      content?.setAttribute("aria-labelledby", title.id);
    }
    const focusable = () => Array.from(content?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    ) ?? []).filter((element) => {
      const style = window.getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== "hidden" &&
        !element.closest('[hidden], [inert], [aria-hidden="true"]');
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        content?.focus();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !content?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !content?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    (focusable()[0] ?? content)?.focus();
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      // An action can open a dialog and close its surrounding disclosure.
      // Return to that disclosure's visible trigger instead of a hidden button.
      const returnTarget = (returnFocusSelector ? document.querySelector<HTMLElement>(returnFocusSelector) : null) ?? (previousFocus?.getClientRects().length
        ? previousFocus
        : previousFocus?.closest("details:not([open])")?.querySelector<HTMLElement>("summary"));
      returnTarget?.focus();
    };
  }, [open, returnFocusSelector]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 dialog-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Content */}
      <div
        ref={contentRef}
        tabIndex={-1}
        className="relative dialog-content w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

type DialogHeaderProps = {
  title: string;
  description?: string;
  onClose?: () => void;
};

export function DialogHeader({ title, description, onClose }: DialogHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 p-5 pb-0">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{title}</h2>
        {description && (
          <p className="text-sm text-[var(--color-ink-muted)]">{description}</p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Schließen / Close"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-ink-subtle)] hover:bg-[var(--color-sand-100)] hover:text-[var(--color-ink-muted)] transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function DialogBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

export function DialogFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-2 border-t border-[var(--glass-border)] bg-[var(--color-sand-50)]/50 px-5 py-4 rounded-b-[var(--radius-xl)] ${className}`}>
      {children}
    </div>
  );
}

// Confirm dialog component
type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  warningLabel?: string;
  variant?: "default" | "danger";
  returnFocusSelector?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  warningLabel,
  variant = "default",
  returnFocusSelector,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} returnFocusSelector={returnFocusSelector}>
      <DialogHeader title={title} description={description} />
      <DialogBody>
        {variant === "danger" && warningLabel && (
          <div className="flex items-center gap-3 rounded-xl bg-[var(--color-danger)]/10 p-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-danger)]/10">
              <svg className="h-5 w-5 text-[var(--color-danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm text-[var(--color-danger)]">
              {warningLabel}
            </p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center min-h-11 rounded-lg px-4 py-2.5 text-base font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-sand-100)] transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`inline-flex items-center justify-center min-h-11 rounded-lg px-4 py-2.5 text-base font-medium transition-colors ${
            variant === "danger"
              ? "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]/90"
              : "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
          }`}
        >
          {confirmLabel}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
