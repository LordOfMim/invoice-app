import * as React from "react";

import { cn } from "./lib/cn";

/*
 * Source: platform overview — "Welcome back, Tim" display heading (28px/34
 * semibold) with a muted one-line subtitle. Subtitle normalized from Paper's
 * 14px to text-lg (14.5px).
 */
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
      <h1 className="font-sans text-display font-semibold tracking-snug text-ink">
        {children}
      </h1>
      {subtitle != null && (
        <p className="font-sans text-lg/5 tracking-snug text-ink-muted">
          {subtitle}
        </p>
      )}
    </div>
  );
}
