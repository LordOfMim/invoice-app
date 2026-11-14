import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Mono uppercase badge family. Styling source: flow-page DRAFT chip
 * (h-7, radius 8, dashed hairline, Roboto Mono 9px/12 +0.08em, ink-muted).
 * The Badge-Library artboard is inventory only — all variants here are
 * normalized to these flow-page values.
 */
const badgeVariants = cva(
  "inline-flex shrink-0 select-none items-center font-mono font-medium uppercase tracking-caps",
  {
    variants: {
      variant: {
        /** Stage indicator, e.g. DRAFT (top bar). */
        stage:
          "h-7 rounded-md border border-dashed border-line-dash bg-surface px-2.25 text-3xs text-ink-muted",
        /** Role badge, e.g. ADMIN / BUILDER (members tables). */
        role: "h-6 rounded-md border border-line-control bg-surface px-2 text-3xs text-ink-secondary",
        /** Highest role — inverted, e.g. OWNER. */
        roleSolid: "h-6 rounded-md bg-ink px-2 text-3xs text-white",
        /** Dormant/pending marker, dashed + faint. */
        pending:
          "h-6 rounded-md border border-dashed border-line-dash bg-surface px-2 text-3xs text-ink-faint",
      },
    },
    defaultVariants: {
      variant: "stage",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

/*
 * Override delta — "+1" / "−2" permission override count (members & access).
 * Normalized: shares the CodeChip plate (radius sm, control hairline).
 */
export function OverrideDelta({
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { value: number }) {
  return (
    <span
      data-slot="override-delta"
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border border-line-control bg-surface px-1.5 py-0.5 font-mono text-2xs font-medium tracking-loose",
        value < 0 ? "text-warn-ink" : "text-ink-secondary",
        className,
      )}
      {...props}
    >
      {value > 0 ? `+${value}` : `−${Math.abs(value)}`}
    </span>
  );
}

/*
 * Plan plate — subscription plan + status segment ("Operate Plus · Hypercare
 * until Jul 15"). Segmented control-hairline plate like the flow-page
 * reference chips.
 */
export interface PlanPlateProps extends React.HTMLAttributes<HTMLSpanElement> {
  plan: string;
  status?: React.ReactNode;
}

export function PlanPlate({
  plan,
  status,
  className,
  ...props
}: PlanPlateProps) {
  return (
    <span
      data-slot="plan-plate"
      className={cn(
        "inline-flex h-6.5 shrink-0 overflow-clip rounded-md border border-line-control bg-surface",
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center px-2.5 font-sans text-md font-medium tracking-snug text-ink">
        {plan}
      </span>
      {status != null && (
        <>
          <span className="w-px shrink-0 bg-line-control" />
          <span className="inline-flex items-center gap-1.5 bg-surface-subtle px-2 font-sans text-xs font-medium text-ink-body">
            {status}
          </span>
        </>
      )}
    </span>
  );
}

export { badgeVariants };
