import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "./lib/cn";
import { IconButton } from "./icon-button";

/*
 * Source: flow page — page toolbar breadcrumb: back button (28px, radius 7,
 * hairline), 13px medium muted segments, "/" separator in line-strong,
 * 15px semibold ink current segment.
 *
 * Top-bar variant (platform overview, Jul 2026): emblem › chevron ›
 * clickable segments (13px medium, 9px chevron separators in line-strong)
 * — see BreadcrumbLink / BreadcrumbChevron.
 */

export function Breadcrumb({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      aria-label="Breadcrumb"
      data-slot="breadcrumb"
      className={cn("flex min-w-0 items-center gap-3", className)}
      {...props}
    />
  );
}

export interface BreadcrumbBackProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

/** Reuses IconButton (press feedback included); Paper spec: 28px, radius 7. */
export function BreadcrumbBack({ className, ...props }: BreadcrumbBackProps) {
  return (
    <IconButton
      variant="outline"
      size="md"
      aria-label="Back"
      data-slot="breadcrumb-back"
      className={cn("rounded-sm text-ink-secondary", className)}
      {...props}
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
        <path
          d="M8.75 2.9 L4.55 7 L8.75 11.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </IconButton>
  );
}

export function BreadcrumbItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="breadcrumb-item"
      className={cn(
        "min-w-0 truncate font-sans text-base font-medium tracking-snug text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      data-slot="breadcrumb-separator"
      className={cn("shrink-0 font-sans text-base text-line-strong", className)}
      {...props}
    >
      /
    </span>
  );
}

export interface BreadcrumbLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Marks the segment as the current page (`aria-current`). */
  current?: boolean;
  asChild?: boolean;
}

/**
 * Clickable top-bar breadcrumb segment (13px medium ink, Paper 2PJF-0).
 * A real pressable: ghost-style hover fill + the standard press feedback.
 */
export function BreadcrumbLink({
  current = false,
  asChild = false,
  className,
  ...props
}: BreadcrumbLinkProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      data-slot="breadcrumb-link"
      aria-current={current ? "page" : undefined}
      className={cn(
        "-mx-1 min-w-0 cursor-pointer select-none truncate rounded-sm px-1 py-0.5 font-sans text-base/4 font-medium tracking-snug text-ink outline-none transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-muted active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

/** Chevron separator for the top-bar breadcrumb (9px, line-strong). */
export function BreadcrumbChevron({
  className,
  ...props
}: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      data-slot="breadcrumb-chevron"
      width="9"
      height="9"
      viewBox="0 0 9 9"
      className={cn("shrink-0 text-line-strong", className)}
      {...props}
    >
      <path
        d="M3 1.5L6 4.5L3 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BreadcrumbPage({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-current="page"
      data-slot="breadcrumb-page"
      className={cn(
        "min-w-0 truncate font-sans text-xl/4.5 font-semibold tracking-snug text-ink",
        className,
      )}
      {...props}
    />
  );
}
