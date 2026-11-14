"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/platform/icon";
import { cn } from "@/components/platform/lib/cn";

/**
 * After humaify-overwatch `src/components/ui/disclosure.tsx`: a collapsible section on the `PageSection` head. The
 * title is the toggle (heading > button with aria-expanded); the content stays mounted while closed. The chevron is
 * Hugeicons ArrowDown01Icon as in the source. Optionally controlled.
 */
export function Disclosure({
  id,
  title,
  summary,
  status,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  as: Heading = "h3",
  className,
  children,
}: {
  id?: string;
  title: ReactNode;
  summary?: ReactNode;
  /** Short state after the title, e.g. "2 Angaben prüfen". */
  status?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  as?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  const contentId = useId();
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <section id={id} className={cn("flex min-w-0 scroll-mt-24 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading className="font-sans text-xl/5.5 font-semibold tracking-snug text-ink">
          <button type="button" aria-expanded={open} aria-controls={contentId} onClick={toggle} className="group inline-flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <HugeiconsIcon icon={ArrowDown01Icon} size={15} className={cn("shrink-0 text-ink-muted transition-transform duration-150 ease-out motion-reduce:transition-none", !open && "-rotate-90")} />
            <span className="underline-offset-4 decoration-line-strong group-hover:underline">{title}</span>
            {status}
          </button>
        </Heading>
        {summary !== undefined && summary !== null && <div className="pl-5 font-sans text-base tracking-snug text-ink-muted">{summary}</div>}
      </div>
      <div id={contentId} className={cn("flex min-w-0 flex-col gap-4 pl-5", !open && "hidden")}>{children}</div>
    </section>
  );
}
