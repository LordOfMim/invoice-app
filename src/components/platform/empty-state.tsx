import * as React from "react";

import { cn } from "./lib/cn";
import { HugeiconsIcon, type IconSvgElement } from "./icon";

/*
 * Empty state — minimalist centered block for "nothing here" moments
 * (no workspaces yet, no search hits): a 40px hairline icon plate, a quiet
 * title and an optional muted caption. Deliberately no CTA slot — the
 * surrounding page owns any action.
 */
export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: IconSvgElement;
  title: React.ReactNode;
  caption?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  caption,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-14 text-center",
        className,
      )}
      {...props}
    >
      {icon != null && (
        <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted">
          <HugeiconsIcon icon={icon} size={18} />
        </span>
      )}
      <div className="flex flex-col gap-1">
        <span className="font-sans text-base font-medium tracking-snug text-ink-secondary">
          {title}
        </span>
        {caption != null && (
          <span className="font-sans text-md tracking-snug text-ink-muted">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
