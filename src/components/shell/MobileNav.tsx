"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown01Icon, ArrowRight01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/platform/icon";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/platform/sheet";
import { cn } from "@/components/platform/lib/cn";
import type { NavGroup, NavItem } from "./nav";

/*
 * After humaify-overwatch `src/components/shell/mobile-nav.tsx`: below lg, where the sidebar does not fit, one
 * labelled row names where the user is („Weitere Dokumente › Vorlagen“) and opens the same grouped navigation as the
 * sidebar as a full list in a Platform `Sheet` (Radix Dialog:
 * focus trap, Escape, focus return). The row sticks below the top bar. The caller keys this component by the path,
 * so every navigation closes the menu and it never reopens by itself.
 */
export function MobileNav({ groups, group, item: page, title, closeLabel, openLabel, currentLabel, menuLabel }: { groups: readonly NavGroup[]; group?: NavGroup; item?: NavItem; title: string; closeLabel: string; openLabel: string; currentLabel: string; menuLabel: string }) {
  const [open, setOpen] = useState(false);
  const nested = Boolean(group?.label && page);
  return (
    <nav aria-label={title} className="no-print sticky top-13 z-25 border-b border-line bg-surface px-4 sm:px-6 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-sm text-left font-sans text-lg tracking-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <HugeiconsIcon icon={Menu01Icon} size={16} className="shrink-0 text-ink-muted" />
            <span className="sr-only">{openLabel}{page ? `, ${currentLabel}:` : ""} </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {nested && page ? (
                <>
                  <span className="min-w-0 shrink truncate font-medium text-ink-muted">{group?.label}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={12} className="shrink-0 text-line-strong" />
                  <span className="min-w-0 truncate font-semibold text-ink">{page.label}</span>
                </>
              ) : (
                <span className="min-w-0 truncate font-semibold text-ink">{page?.label ?? title}</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-ink-secondary">
              {menuLabel}
              <HugeiconsIcon icon={ArrowDown01Icon} size={13} className="text-ink-soft" />
            </span>
          </button>
        </SheetTrigger>
        <SheetContent side="left" closeLabel={closeLabel} aria-describedby={undefined}>
          <SheetHeader className="px-5 pr-14 pb-4">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <SheetBody className="border-t border-line px-3 pt-2 pb-6">
            {groups.map((entry) => (
              <div key={entry.key} className="border-b border-line py-2 last:border-b-0">
                {entry.label && <p id={`mobile-nav-group-${entry.key}`} className="px-3 pt-2 pb-1 font-sans text-base font-medium tracking-snug text-ink-muted">{entry.label}</p>}
                <ul aria-labelledby={entry.label ? `mobile-nav-group-${entry.key}` : undefined} className="flex flex-col">
                  {entry.items.map((item) => {
                    const current = page?.key === item.key;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={current ? "page" : undefined}
                          // A link to the current page does not change the path; close explicitly.
                          onClick={() => setOpen(false)}
                          className={cn(
                            "flex min-h-11 flex-col justify-center gap-0.5 rounded-md px-3 py-2 font-sans text-lg tracking-snug outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                            current ? "bg-surface-muted font-semibold text-ink" : "font-medium text-ink-secondary hover:bg-surface-subtle hover:text-ink",
                          )}
                        >
                          <span>{item.label}</span>
                          <span className="font-sans text-base font-normal tracking-snug text-ink-muted">{item.hint}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
