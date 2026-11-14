import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Source: flow page — inspector "In Progress" (7px dot + 13px medium label)
 * and activity-feed dots (filled vs. 1.5px outlined). Tones map to the fixed
 * step palette; no new hues. The outline variant is the workspace-overview
 * v3 "Aktiv" header pill: 22px hairline pill, 5px tone dot, 11px medium
 * label always in ink-secondary (Paper #505967).
 */
const dotVariants = cva("size-1.75 shrink-0 rounded-pill", {
  variants: {
    tone: {
      success: "bg-step-say",
      progress: "bg-warn",
      info: "bg-accent-blue",
      muted: "border-[1.5px] border-line-dot bg-transparent",
      danger: "bg-danger",
    },
  },
  defaultVariants: {
    tone: "muted",
  },
});

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof dotVariants> {
  variant?: "plain" | "outline";
}

export function StatusPill({
  className,
  tone,
  variant = "plain",
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      className={cn(
        "inline-flex items-center font-sans font-medium",
        variant === "outline"
          ? "h-5.5 gap-1.5 rounded-pill border border-line bg-surface px-2.25 text-xs/3.5 tracking-snug text-ink-secondary"
          : cn(
              "gap-1.75 text-base text-ink",
              tone === "muted" && "text-ink-muted",
            ),
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          dotVariants({ tone }),
          variant === "outline" && "size-1.25",
        )}
      />
      {children}
    </span>
  );
}

/** Standalone status dot, e.g. for activity feeds. */
export function StatusDot({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof dotVariants>) {
  return (
    <span
      aria-hidden
      data-slot="status-dot"
      className={cn(dotVariants({ tone }), className)}
      {...props}
    />
  );
}
