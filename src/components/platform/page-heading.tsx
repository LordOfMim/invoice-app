import * as React from "react";

import { cn } from "./lib/cn";

/* Page title: 24px/32 semibold display heading with a muted 14px subtitle. */
export interface PageHeadingProps
  extends React.HTMLAttributes<HTMLDivElement> {
  subtitle?: React.ReactNode;
}

export function PageHeading({
  subtitle,
  className,
  children,
  ...props
}: PageHeadingProps) {
  return (
    <div
      data-slot="page-heading"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    >
      <h1 className="font-sans text-display font-semibold tracking-title text-ink">
        {children}
      </h1>
      {subtitle != null && (
        <p className="font-sans text-lg tracking-snug text-ink-muted">
          {subtitle}
        </p>
      )}
    </div>
  );
}
