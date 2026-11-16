import * as React from "react";

import { cn } from "./lib/cn";

/*
 * Identity block of one object: 44px square mark on the near-black fill (radius 10) with 14px semibold initials,
 * name row (24px semibold + status pill) and a muted 14px description row with an optional reference.
 */
export interface IdentityHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
  name: React.ReactNode;
  /** Mark initials; pass `avatar` instead for a custom mark. */
  initials?: string;
  /** Custom leading mark, replaces the default 44px ink square. */
  avatar?: React.ReactNode;
  /** Slot next to the name, e.g. an outline StatusPill. */
  status?: React.ReactNode;
  /** Muted description, e.g. "Concierge & Booking". */
  description?: React.ReactNode;
  /** Quiet reference next to the description. */
  slug?: React.ReactNode;
  /** Right-aligned actions, e.g. favorite + menu IconButtons. */
  actions?: React.ReactNode;
}

export function IdentityHeader({
  name,
  initials,
  avatar,
  status,
  description,
  slug,
  actions,
  className,
  ...props
}: IdentityHeaderProps) {
  return (
    <div
      data-slot="identity-header"
      className={cn("flex w-full items-center gap-4", className)}
      {...props}
    >
      {avatar ?? (
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-fill font-sans text-xl/4.5 font-semibold tracking-loose text-white"
        >
          {initials}
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1.25">
        {/* The status wraps under the name when both don't fit (phones),
            instead of squeezing the truncating name to nothing. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h1 className="min-w-0 max-w-full truncate font-sans text-display font-semibold tracking-title text-ink">
            {name}
          </h1>
          {/* Bounded, not shrink-0: a status wider than the row (pills +
              badges on a phone) wraps inside itself instead of overflowing. */}
          {status != null && <span className="min-w-0 max-w-full">{status}</span>}
        </div>
        {(description != null || slug != null) && (
          <div className="flex items-center gap-2">
            {description != null && (
              <span className="truncate font-sans text-lg tracking-snug text-ink-muted">
                {description}
              </span>
            )}
            {description != null && slug != null && (
              <span aria-hidden className="font-sans text-sm text-line-dash">
                ·
              </span>
            )}
            {slug != null && (
              <span className="truncate font-sans text-sm text-ink-muted">
                {slug}
              </span>
            )}
          </div>
        )}
      </div>
      {actions != null && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
