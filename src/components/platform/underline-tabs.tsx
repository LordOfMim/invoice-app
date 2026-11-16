"use client";

import * as React from "react";

import { cn } from "./lib/cn";

/*
 * Page-level section tabs: a 48px row on a full-width hairline, medium labels (13px, `size="lg"` 14px), the active
 * tab in ink with a 2px bar sitting on the hairline, inactive labels in ink-muted, optional 12px counter. The active
 * bar is a plain element and jumps instead of sliding (no `motion` dependency).
 */
export interface UnderlineTabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional counter next to the label, e.g. a line count. */
  count?: React.ReactNode;
  /** Non-interactive tab (e.g. its section doesn't exist yet) — renders
   *  plain like an inactive tab, without hover or pointer cues. */
  disabled?: boolean;
}

export interface UnderlineTabsProps<T extends string>
  extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  items: readonly UnderlineTabItem<T>[];
  value: T;
  onValueChange?: (value: T) => void;
  /** Right-aligned slot, e.g. "View as customer" + an ADMIN badge. */
  trailing?: React.ReactNode;
  /** `lg` = 14px labels. */
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
        "flex w-full flex-wrap items-end gap-x-4 gap-y-0 border-b border-line",
        className,
      )}
      {...props}
    >
      {items.map((item) => {
        const active = item.value === value;
        const content = (
          <span
            className={cn(
              "group relative flex h-12 items-center gap-1.5",
              !item.disabled && "cursor-pointer",
            )}
          >
            <span className={cn("relative whitespace-nowrap font-sans tracking-snug", size === "lg" ? "text-lg" : "text-base")}>
              {/* Invisible twin reserves the label width. */}
              <span aria-hidden className="invisible font-medium">
                {item.label}
              </span>
              <span
                className={cn(
                  "absolute inset-0 transition-colors duration-100",
                  active
                    ? "font-medium text-ink"
                    : cn(
                        "font-medium text-ink-muted",
                        !item.disabled && "group-hover:text-ink",
                      ),
                )}
              >
                {item.label}
              </span>
            </span>
            {item.count != null && (
              <span className="font-sans text-sm tabular-nums text-ink-muted">
                {item.count}
              </span>
            )}
            {/* 2px active bar sits on the row hairline. */}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 bg-fill"
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
