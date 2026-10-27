import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Source: workspace overview — 14px ring indicator on line cards and the
 * activity timeline: white core with a hairline ring around a 7px tone dot.
 * The opaque core lets the ring sit on the timeline's dotted spine.
 * Tones mirror StatusDot; Paper's muted #C4CAD2 normalized to line-strong.
 */
const ringDotVariants = cva("size-1.75 rounded-pill", {
  variants: {
    tone: {
      success: "bg-success",
      progress: "bg-warn",
      info: "bg-accent-blue",
      muted: "bg-line-strong",
      danger: "bg-danger",
    },
  },
  defaultVariants: {
    tone: "muted",
  },
});

export interface StatusRingProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof ringDotVariants> {}

export function StatusRing({ className, tone, ...props }: StatusRingProps) {
  return (
    <span
      aria-hidden
      data-slot="status-ring"
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-line bg-surface",
        className,
      )}
      {...props}
    >
      <span className={ringDotVariants({ tone })} />
    </span>
  );
}
