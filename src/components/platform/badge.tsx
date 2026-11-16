import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/* Pill badges: 24px high, 12px medium sans label, hairline (dashed for provisional states) or solid fill. */
const badgeVariants = cva(
  "inline-flex shrink-0 select-none items-center rounded-pill font-sans font-medium",
  {
    variants: {
      variant: {
        /** Stage indicator, e.g. DRAFT (top bar). */
        stage:
          "h-6 border border-dashed border-line-dash px-2 text-sm text-ink-secondary",
        /** Role badge, e.g. ADMIN / BUILDER (members tables). */
        role: "h-6 border border-line px-2 text-sm text-ink-secondary",
        /** Highest role — inverted, e.g. OWNER. */
        roleSolid: "h-6 bg-fill px-2 text-sm text-white",
        /** Dormant/pending marker, dashed + faint. */
        pending:
          "h-6 border border-dashed border-line-dash px-2 text-sm text-ink-muted",
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
        "inline-flex shrink-0 items-center rounded-sm border border-line-control bg-surface px-1.5 py-0.5 font-sans text-2xs font-medium tabular-nums",
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
 * until Jul 15"). Segmented plate with a control hairline.
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
