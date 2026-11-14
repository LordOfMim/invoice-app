"use client";

import { useEffect, useRef } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/platform/dialog";
import { Button } from "./Button";
import { StatusNote } from "./Layout";

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
  /** Focus target after closing when the opener no longer exists (e.g. a deleted table row). */
  returnFocusSelector?: string;
};

/**
 * Overwatch `ActionDialog` / Platform `Dialog` (Radix): title as a question or action, one sentence about the
 * consequence, then "Abbrechen" (secondary) and the action (primary, or danger for deletions) right-aligned. Radix
 * traps focus, closes on Escape and returns focus to the opener.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Bestätigen",
  cancelLabel = "Abbrechen",
  warningLabel,
  variant = "default",
  returnFocusSelector,
}: ConfirmDialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) return;
    // Capture the persistent trigger while a menu is still open: its
    // aria-controls may be removed before the dialog's autofocus event.
    const rememberFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const focused = event.target;
      if (focused === document.body || focused.closest('[data-slot="dialog-content"]')) return;
      const menu = focused.closest<HTMLElement>('[role="menu"]');
      const trigger = menu?.id
        ? Array.from(document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"][aria-controls]'))
          .find((element) => element.getAttribute("aria-controls") === menu.id)
        : undefined;
      openerRef.current = trigger ?? focused;
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        closeLabel={cancelLabel === "Cancel" ? "Close" : "Schließen"}
        onOpenAutoFocus={() => {
          const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const menu = focused?.closest<HTMLElement>('[role="menu"]');
          // A menu item disappears when its action opens this dialog. Restore
          // its persistent menu trigger instead of the transient item.
          const menuTrigger = menu?.id
            ? Array.from(document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"][aria-controls]'))
              .find((element) => element.getAttribute("aria-controls") === menu.id)
            : undefined;
          openerRef.current = menuTrigger ?? (menu || focused === document.body ? openerRef.current : focused);
        }}
        onCloseAutoFocus={(event) => {
          // Controlled dialogs have no Radix DialogTrigger. Prevent its empty
          // trigger restoration and return to the actual initiating control.
          event.preventDefault();
          const opener = openerRef.current;
          const target = opener?.isConnected
            ? opener
            : document.querySelector<HTMLElement>(returnFocusSelector ?? "#inhalt");
          target?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="pr-14">
          <DialogTitle className="text-2xl">{title}</DialogTitle>
          {description ? <DialogDescription className="text-lg/6">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {variant === "danger" && warningLabel && (
          <DialogBody className="pb-2">
            <StatusNote tone="error">{warningLabel}</StatusNote>
          </DialogBody>
        )}
        <DialogFooter className="flex-row flex-wrap justify-end pt-4 max-sm:[&>button]:flex-1">
          <Button variant="secondary" onClick={onClose}>{cancelLabel}</Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
