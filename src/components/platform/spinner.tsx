import * as React from "react";

import { cn } from "./lib/cn";

/*
 * Progress spinner — quarter-arc ring on a faint track, currentColor so it
 * inherits button/text ink. Fast rotation (Tailwind's 1s linear spin) reads
 * as responsiveness. Deliberately NOT gated behind reduced motion: the
 * rotation IS the information (work in progress); a frozen ring would read
 * as done-or-stuck. Decorative by itself — pair it with visible text, or
 * pass an aria-label and unset aria-hidden where it stands alone.
 */
export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  /** Rendered square size in px. */
  size?: number;
}

export function Spinner({ size = 14, className, ...props }: SpinnerProps) {
  return (
    <svg
      data-slot="spinner"
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cn("shrink-0 animate-spin", className)}
      {...props}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.8"
      />
      <path
        d="M8 1.5 A 6.5 6.5 0 0 1 14.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
