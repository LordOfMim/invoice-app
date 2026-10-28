import * as React from "react";

import { cn } from "./lib/cn";

/*
 * Source: flow page — 60px top bar with a hairline bottom border:
 * left slot (line switcher), absolutely centered slot (nav tabs),
 * right slot (dialer, stage badge, publish). The left padding is owned by
 * the shell layout (rail width), not this component.
 *
 * Sticky at the top of its scroll container: the chrome (breadcrumb,
 * account) stays reachable while the page scrolls underneath. z-30 keeps it
 * above page content and below overlays (dialogs, sheets, menus at z-50).
 */
export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Centered content, e.g. NavTabs. Rendered absolutely so it stays centered. */
  center?: React.ReactNode;
  /** Right-aligned actions. */
  actions?: React.ReactNode;
  /**
   * Classes for the centered inner content wrapper — pass the page body's
   * max-width (e.g. `max-w-[1600px]`) so the bar content stays aligned
   * with the body on ultra-wide viewports instead of hugging the screen
   * edges. Border and background always span the full width.
   */
  contentClassName?: string;
}

export function TopBar({
  center,
  actions,
  className,
  contentClassName,
  children,
  ...props
}: TopBarProps) {
  return (
    <header
      data-slot="top-bar"
      className={cn(
        "sticky top-0 z-30 flex h-15 shrink-0 items-center border-b border-line bg-surface px-6",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "relative mx-auto flex w-full items-center justify-between",
          contentClassName,
        )}
      >
        <div className="relative flex min-w-0 items-center gap-3">
          {children}
        </div>
        {center != null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto">{center}</div>
          </div>
        )}
        <div className="relative flex shrink-0 items-center gap-2.5">
          {actions}
        </div>
      </div>
    </header>
  );
}

/*
 * Page toolbar — the 52px secondary bar below the top bar (breadcrumb left,
 * view switcher right).
 */
export function PageToolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "flex h-13 shrink-0 items-center justify-between gap-3.5 border-b border-line bg-surface px-6",
        className,
      )}
      {...props}
    />
  );
}
