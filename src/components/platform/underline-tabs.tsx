"use client";

import * as React from "react";

import { cn } from "./lib/cn";

/*
 * From humaify-platform `packages/ui/src/primitives/underline-tabs.tsx`
 * (cc5090a). Markup and classes are unchanged. Adapted: the active bar is a
 * plain element instead of a `motion` shared-layout element; Helferlein does
 * not add the `motion` dependency (docs/design-reference.md, deviation 5).
 * The bar therefore jumps instead of sliding, which is also what the source
 * does under prefers-reduced-motion. A `size="lg"` option sets the labels
 * to 14.5px for the Helferlein readability profile (deviation 2).
 *
 * Source: workspace overview v3 — the page-level section tabs (Überblick ·
 * Lines · Mitglieder & Zugriff · …): 13px labels on a full-width hairline,
 * the active tab semibold ink with a 1.5px ink bar sitting on the hairline,
 * inactive labels medium ink-muted, optional 10px mono counter (ink-faint).
 * A distinct pattern from the pill NavTabs (top-bar nav). Labels reserve
 * their semibold width so the row doesn't shift when the active weight
 * changes.
 */
export interface UnderlineTabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional mono counter next to the label, e.g. a line count. */
  count?: React.ReactNode;
  /** Non-interactive tab (e.g. its section doesn't exist yet) — renders
   *  plain like Paper's inactive tabs, without hover or pointer cues. */
  disabled?: boolean;
}

export interface UnderlineTabsProps<T extends string>
  extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  items: readonly UnderlineTabItem<T>[];
  value: T;
  onValueChange?: (value: T) => void;
  /** Right-aligned slot, e.g. "View as customer" + an ADMIN badge. */
  trailing?: React.ReactNode;
  /** `lg` = 14.5px labels (Helferlein readability profile). */
  size?: "md" | "lg";
  /** Render a tab item, e.g. as a Next.js Link. Defaults to a button. */
  renderItem?: (
    item: UnderlineTabItem<T>,
    content: React.ReactNode,
  ) => React.ReactNode;
}

export function UnderlineTabs<T extends string>({
  items,
  value,
  onValueChange,
  trailing,
  size = "md",
  renderItem,
  className,
  ...props
}: UnderlineTabsProps<T>) {
  return (
    <nav
      data-slot="underline-tabs"
      className={cn(
        // flex-wrap: below the row's intrinsic width (~500px for six
        // labels) tabs wrap instead of forcing the page to scroll
        // sideways; the hairline stays under the whole block.
        "flex w-full flex-wrap items-end gap-x-7 gap-y-2 border-b border-line",
        className,
      )}
      {...props}
    >
      {items.map((item) => {
        const active = item.value === value;
        const content = (
          <span
            className={cn(
              "group relative flex items-center gap-1.75 pb-3",
              !item.disabled && "cursor-pointer",
            )}
          >
            <span className={cn("relative whitespace-nowrap font-sans tracking-snug", size === "lg" ? "text-lg/5" : "text-base/4")}>
              {/* Invisible semibold twin reserves the active width. */}
              <span aria-hidden className="invisible font-semibold">
                {item.label}
              </span>
              <span
                className={cn(
                  "absolute inset-0 transition-colors duration-100",
                  active
                    ? "font-semibold text-ink"
                    : cn(
                        "font-medium text-ink-muted",
                        !item.disabled && "group-hover:text-ink-secondary",
                      ),
                )}
              >
                {item.label}
              </span>
            </span>
            {item.count != null && (
              <span className="font-mono text-2xs/3 tracking-loose text-ink-faint">
                {item.count}
              </span>
            )}
            {/* 1.5px active bar sits on the row hairline. */}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-[1.5px] bg-ink"
              />
            )}
          </span>
        );
        if (renderItem) {
          return (
            <React.Fragment key={item.value}>
              {renderItem(item, content)}
            </React.Fragment>
          );
        }
        if (item.disabled) {
          return (
            <span key={item.value} aria-disabled>
              {content}
            </span>
          );
        }
        return (
          <button
            key={item.value}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onValueChange?.(item.value)}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {content}
          </button>
        );
      })}
      {trailing != null && (
        <div className="mb-2 ml-auto flex shrink-0 items-center gap-2">
          {trailing}
        </div>
      )}
    </nav>
  );
}
