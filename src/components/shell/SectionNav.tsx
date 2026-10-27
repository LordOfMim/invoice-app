"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/components/platform/lib/cn";
import type { NavItem } from "./nav";

/*
 * After humaify-overwatch `src/components/shell/section-nav.tsx` (Platform `SectionNav` of the customer and account
 * shells): one hairline row of text tabs. Active = semibold ink + 1.5px ink bar. `sub` is the quieter 40px SubNav
 * row on `surface-subtle`. Should the row be too narrow it scrolls sideways and keeps the active tab visible
 * (`use-keep-active-visible.ts`). Readability profile: 14.5px main row, 13px sub row (design-reference, deviation 2).
 */
const tabClasses = (sub: boolean, current: boolean) => cn(
  "relative inline-flex items-center gap-1.75 whitespace-nowrap px-3 font-sans tracking-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
  sub ? "h-10 text-base" : "h-11 text-lg",
  current ? "font-semibold text-ink" : "font-medium text-ink-muted hover:text-ink-secondary",
);

export function SectionNav({ items, activeKey, exactKey, label, sub = false, className }: { items: readonly NavItem[]; activeKey?: string; exactKey?: string; label: string; sub?: boolean; className?: string }) {
  const listRef = useRef<HTMLUListElement>(null);

  // Scroll only the row itself (instantly), never the page, and never move focus.
  useEffect(() => {
    const row = listRef.current;
    const item = row?.querySelector<HTMLElement>("[data-active]");
    if (!row || !item) return;
    const rowBox = row.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.left >= rowBox.left && itemBox.right <= rowBox.right) return;
    row.scrollLeft += itemBox.left - rowBox.left - (row.clientWidth - itemBox.width) / 2;
  }, [activeKey]);

  return (
    <nav aria-label={label} className={cn("no-print border-b border-line", sub ? "bg-surface-subtle" : "bg-surface", className)}>
      <ul ref={listRef} className="mx-auto -mb-px flex w-full max-w-[1312px] gap-1 overflow-x-auto overflow-y-hidden px-1 sm:px-0">
        {items.map((item) => {
          const current = activeKey === item.key;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                title={item.hint}
                data-active={current ? "" : undefined}
                aria-current={current ? (exactKey === item.key ? "page" : "true") : undefined}
                className={tabClasses(sub, current)}
              >
                {item.label}
                {current && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[1.5px] bg-ink" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
