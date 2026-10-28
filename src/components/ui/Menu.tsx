"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Slottable } from "@radix-ui/react-slot";
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/platform/dropdown-menu";
import { HugeiconsIcon } from "@/components/platform/icon";
import { cn } from "@/components/platform/lib/cn";
import { buttonClasses, iconButtonClasses } from "./Button";

export type MenuItem =
  | { kind?: "action"; label: ReactNode; onSelect: () => void; tone?: "default" | "danger" }
  | { kind: "link"; label: ReactNode; href: string }
  | { kind: "separator" }
  | { kind: "label"; label: ReactNode };

/** Menu rows at the readability size: at least 40px, 13px (Platform rows are 32px/12.5px). */
const rowSize = "h-auto min-h-10 py-2 text-base";

/**
 * humaify-overwatch `OverflowMenu` on the Platform `DropdownMenu` (Radix): secondary actions behind an icon-only „…“
 * trigger (named by its label) or a labelled secondary button. Radix provides roles, roving focus, arrow keys,
 * typeahead, Escape and focus return. Below md, in table cards, the „…“ trigger also reads „Aktionen“.
 */
export function OverflowMenu({ items, label, trigger, align = "end", className }: { items: readonly (MenuItem | false | null | undefined)[]; label: string; trigger?: ReactNode; align?: "start" | "end"; className?: string }) {
  const entries = items.filter(Boolean) as MenuItem[];
  if (!entries.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ? (
          <button type="button" data-slot="button" aria-label={label} className={buttonClasses({ variant: "secondary", className })}>{trigger}</button>
        ) : (
          <button
            type="button"
            data-slot="icon-button"
            aria-label={label}
            title={label}
            className={iconButtonClasses({ variant: "outline", className: cn("max-md:[[role=cell]_&]:w-auto max-md:[[role=cell]_&]:gap-1.5 max-md:[[role=cell]_&]:px-3 max-md:[[role=cell]_&]:font-sans max-md:[[role=cell]_&]:text-base max-md:[[role=cell]_&]:font-medium max-md:[[role=cell]_&]:text-ink-secondary", className) })}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
            <span className="hidden max-md:[[role=cell]_&]:inline">Aktionen</span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} aria-label={label} collisionPadding={8} className="max-w-[calc(100vw-1rem)]">
        {entries.map((item, index) => {
          if (item.kind === "separator") return <DropdownMenuSeparator key={index} />;
          if (item.kind === "label") return <DropdownMenuLabel key={index} className="font-mono text-xs font-medium tracking-caps text-ink-muted uppercase">{item.label}</DropdownMenuLabel>;
          if (item.kind === "link") {
            // The Platform item renders an icon lane next to its children, so the link is the slot target.
            return <DropdownMenuItem key={index} asChild className={rowSize}><Slottable><Link href={item.href}>{item.label}</Link></Slottable></DropdownMenuItem>;
          }
          return <DropdownMenuItem key={index} variant={item.tone ?? "default"} className={rowSize} onSelect={item.onSelect}>{item.label}</DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
