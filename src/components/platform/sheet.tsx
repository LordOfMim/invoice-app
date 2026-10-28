"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./lib/cn";
import { HugeiconsIcon } from "./icon";
import { IconButton } from "./icon-button";

/*
 * Sheet — a modal side panel sliding in over the page (favorites list,
 * secondary detail). Built on the shadcn/Radix Dialog skeleton per the
 * system rule, re-skinned flat: `surface` panel with a `line` hairline on
 * the page side, NO shadow (separation comes from the hairline plus the
 * ink-veil overlay — same rule as the DropdownMenu plate). Width matches
 * the 400px inspector column (`w-100`).
 *
 * Motion: the panel slides in from its edge over 250ms with the system
 * ease-out; the exit snaps in 200ms (deliberate in, snappy out). The
 * overlay fades alongside. Both collapse to instant under reduced motion.
 *
 * A11y: a sheet without a `SheetDescription` must pass
 * `aria-describedby={undefined}` on `SheetContent` — Radix's sanctioned
 * opt-out of the missing-description warning.
 */

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
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

export interface SheetContentProps
  extends React.ComponentProps<typeof SheetPrimitive.Content> {
  /** Edge the panel slides in from. */
  side?: "right" | "left";
  /**
   * Panel width. `default` matches the 400px inspector column; `wide` is the
   * 560px form panel (workspace-create flow).
   */
  size?: "default" | "wide";
  /** Accessible label for the built-in close button. */
  closeLabel?: string;
}

function SheetContent({
  className,
  children,
  side = "right",
  size = "default",
  closeLabel = "Close",
  ...props
}: SheetContentProps) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-50 flex h-full max-w-[calc(100%-2rem)] flex-col bg-surface outline-none",
          size === "wide" ? "w-140" : "w-100",
          "data-[state=open]:animate-in data-[state=open]:duration-250 data-[state=closed]:animate-out data-[state=closed]:duration-200",
          "ease-out motion-reduce:animate-none",
          side === "right"
            ? "right-0 border-l border-line data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
            : "left-0 border-r border-line data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close asChild>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={closeLabel}
            className="absolute right-5 top-5 size-10"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </IconButton>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-1.5 px-7 pt-6 pb-5", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-sans text-2xl font-semibold tracking-snug text-ink",
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("font-sans text-base/4.75 tracking-snug text-ink-body", className)}
      {...props}
    />
  );
}

/** Hairline between the header and the scrollable body. */
function SheetDivider({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="sheet-divider"
      className={cn("h-px shrink-0 bg-line", className)}
      {...props}
    />
  );
}

/** Scrollable content region below the header. */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
      {...props}
    />
  );
}

/**
 * Pinned action row at the bottom of the panel — cancel/back on the left,
 * commits on the right. Deliberately no hairline above it (workspace-create
 * revision): the footer separates itself through whitespace alone.
 */
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex shrink-0 items-center justify-between px-7 pt-4 pb-6",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetDivider,
  SheetBody,
  SheetFooter,
};
