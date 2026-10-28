"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "./lib/cn";
import { HugeiconsIcon } from "./icon";
import type { IconSvgElement } from "./icon";

/*
 * Dropdown menu — the floating account/action menu behind chrome controls
 * (UserChip, icon buttons). Styled strictly flat per the system: white
 * surface with a `line` hairline, rounded-lg (10px input-surface radius),
 * NO shadow — separation comes from the hairline alone (introducing a
 * popover shadow would need an approved DESIGN.md extension).
 *
 * Rows are 32px, rounded-md, `label`-scale text on the ink ramp; hovers
 * step onto surface-muted like every other control. A leading 16px icon
 * lane keeps labels aligned across rows (fixed lane, not gap — the same
 * rule as step lists).
 *
 * Motion mirrors the Tooltip plate: 150ms ease-out fade + zoom from the
 * anchored side, origin-aware via the Radix transform-origin variable,
 * inert under reduced motion.
 */

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn(
        // Radix opens on pointerdown and prevents its default, which
        // suppresses the trigger's own :active press scale. Hold the 0.97
        // press state while the menu is open instead: feedback lands on
        // press and the trigger reads as "holding" the menu until close.
        "data-[state=open]:scale-[0.97] motion-reduce:data-[state=open]:scale-100",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-56 overflow-y-auto overscroll-contain origin-(--radix-dropdown-menu-content-transform-origin) rounded-lg border border-line bg-surface p-1.5",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          "duration-150 ease-out motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps
  extends React.ComponentProps<typeof DropdownMenuPrimitive.Item> {
  /** Leading glyph, rendered in a fixed 16px lane via the icon wrapper. */
  icon?: IconSvgElement;
  /** Steps the row onto the danger hue (e.g. destructive actions). */
  variant?: "default" | "danger";
}

function DropdownMenuItem({
  className,
  icon,
  variant = "default",
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 font-sans text-md font-medium tracking-snug outline-none transition-colors duration-100",
        variant === "danger"
          ? "text-danger data-highlighted:bg-danger/5"
          : "text-ink-secondary data-highlighted:bg-surface-muted data-highlighted:text-ink",
        "data-disabled:pointer-events-none data-disabled:text-ink-disabled",
        className,
      )}
      {...props}
    >
      {icon != null && (
        <span className="flex w-4 shrink-0 items-center justify-center text-current">
          <HugeiconsIcon icon={icon} size={15} />
        </span>
      )}
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

/**
 * Non-navigating control row: same anatomy as an item (icon lane + label)
 * plus a trailing control slot (e.g. a SegmentedControl). Activating the
 * row (click on the label area, Enter/Space via keyboard) calls
 * `onCycle` and keeps the menu open, so embedded two-state toggles stay
 * keyboard-operable; pointer clicks on the control itself hit the control
 * directly.
 */
export interface DropdownMenuControlRowProps
  extends Omit<
    React.ComponentProps<typeof DropdownMenuPrimitive.Item>,
    "onSelect"
  > {
  icon?: IconSvgElement;
  /** The trailing control (visual state + pointer target). */
  control: React.ReactNode;
  /** Advance the control to its next state (keyboard/row activation). */
  onCycle?: () => void;
}

function DropdownMenuControlRow({
  className,
  icon,
  control,
  onCycle,
  children,
  ...props
}: DropdownMenuControlRowProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-control-row"
      onSelect={(event) => {
        // Stay open: the row is a stateful control, not a navigation.
        event.preventDefault();
        onCycle?.();
      }}
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 font-sans text-md font-medium tracking-snug text-ink-secondary outline-none transition-colors duration-100 data-highlighted:bg-surface-muted data-highlighted:text-ink",
        className,
      )}
      {...props}
    >
      {icon != null && (
        <span className="flex w-4 shrink-0 items-center justify-center text-current">
          <HugeiconsIcon icon={icon} size={15} />
        </span>
      )}
      <span className="flex-1">{children}</span>
      {/* stopPropagation keeps a direct segment click from also triggering
          the row's toggle underneath it. */}
      <span
        className="shrink-0"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {control}
      </span>
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-line", className)}
      {...props}
    />
  );
}

/** Free-form non-interactive block (e.g. the account identity header). */
function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuControlRow,
  DropdownMenuSeparator,
  DropdownMenuLabel,
};
