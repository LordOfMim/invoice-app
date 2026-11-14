"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./lib/cn";
import { HugeiconsIcon } from "./icon";
import { IconButton } from "./icon-button";

/*
 * Dialog — the centered modal for focused decisions (numbers cell
 * editors). Same flat recipe as the Sheet: `surface` panel, `line`
 * hairline, NO shadow — separation comes from the hairline plus the
 * ink-veil overlay. Width defaults to 440px (`w-110`); hosts size via
 * className.
 *
 * One content edge: header, body and footer share the same 28px (`px-7`)
 * inset, so labels, fields, hints and actions line up; the body only
 * overrides it for full-bleed row lists. The panel keeps a 1rem viewport
 * margin on every side: a long body scrolls between the pinned header and
 * footer (also when they sit inside a `<form>` child, which joins the
 * column). On short viewports (phones in landscape, high browser zoom)
 * pinned zones would leave no room for the body, so the whole panel
 * scrolls as one instead and every field and action stays reachable.
 *
 * Motion: 200ms fade + slight zoom-in with the system ease-out, snappy
 * 150ms exit; both collapse to instant under reduced motion.
 */

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-ink/20",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        "duration-200 ease-out motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** Accessible label for the built-in close button. */
  closeLabel?: string;
}

function DialogContent({
  className,
  children,
  closeLabel = "Close",
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-110 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface outline-none",
          "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-col",
          "[@media(max-height:30rem)]:overflow-y-auto [@media(max-height:30rem)]:[&>form]:shrink-0",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150",
          "ease-out motion-reduce:animate-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={closeLabel}
            className="absolute right-4.5 top-4.5 size-10"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-1.5 px-7 pt-6 pb-5", className)}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-sans text-xl font-semibold tracking-snug text-ink",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "font-sans text-base/4.75 tracking-snug text-ink-body",
        className,
      )}
      {...props}
    />
  );
}

/** Hairline between dialog zones. */
function DialogDivider({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="dialog-divider"
      className={cn("h-px shrink-0 bg-line", className)}
      {...props}
    />
  );
}

/**
 * Scrollable content region on the shared content edge. The 4px vertical
 * padding keeps the 2px focus rings of the first and last field inside the
 * scroll clip.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto px-7 py-1",
        "[@media(max-height:30rem)]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** Bottom action zone. */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex shrink-0 flex-col gap-3 px-7 pb-6 pt-2", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogDivider,
  DialogBody,
  DialogFooter,
};
