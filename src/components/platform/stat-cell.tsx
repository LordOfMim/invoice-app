import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Source: workspace overview — the stat pattern shared by line-card stats
 * and the Pulse hero: muted label over a tone tick bar + semibold value +
 * optional DeltaBadge. Paper's weight 650 normalized to 600; the lg hero
 * value (30px) to text-display. The tick's tiny radius comes from
 * rounded-micro clamping on the narrow bar.
 */
const tickVariants = cva("shrink-0 rounded-micro", {
  variants: {
    tone: {
      success: "bg-success",
      ink: "bg-ink",
      muted: "bg-line-strong",
      warn: "bg-warn",
      danger: "bg-danger",
    },
    size: {
      sm: "h-4 w-0.75",
      lg: "h-6.5 w-1",
    },
  },
  defaultVariants: {
    tone: "ink",
    size: "sm",
  },
});

export interface StatCellProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tickVariants> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Trailing slot next to the value, e.g. a DeltaBadge. */
  delta?: React.ReactNode;
  /** Optional row under the value, e.g. "↗ +12% — vs last Tuesday". */
  footer?: React.ReactNode;
}

export function StatCell({
  label,
  value,
  delta,
  footer,
  tone,
  size = "sm",
  className,
  ...props
}: StatCellProps) {
  return (
    <div
      data-slot="stat-cell"
      className={cn(
        "flex flex-col",
        size === "lg" ? "gap-1.75" : "gap-1.25",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "font-sans tracking-snug text-ink-soft",
          size === "lg" ? "text-sm" : "text-xs/3.5",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "flex items-center",
          size === "lg" ? "gap-2.25" : "gap-1.75",
        )}
      >
        <span aria-hidden className={tickVariants({ tone, size })} />
        <span
          className={cn(
            "font-sans font-semibold tracking-snug text-ink",
            size === "lg" ? "text-display/9" : "text-2xl/5",
          )}
        >
          {value}
        </span>
        {delta}
      </span>
      {footer}
    </div>
  );
}
