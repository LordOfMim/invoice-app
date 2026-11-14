import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { ArrowLeft02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons";

import { cn } from "./lib/cn";
import { HugeiconsIcon } from "./icon";

/*
 * Source: platform + workspace overview — the recurring "Show all →" /
 * "All lines →" / "Open line →" link: 13px medium label + arrow that nudges
 * right on hover. Paper's #407FF2 normalized to color-link; the line-card
 * footer variant renders in ink. `direction="back"` mirrors it into the
 * "← Show less" form (leading arrow, hover nudges left). `tone="accent"`
 * is the lines-directory card footer ("Line öffnen →", #5CABFF).
 */
export interface ArrowLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  tone?: "link" | "ink" | "accent";
  /** Arrow placement: trailing → (forward, default) or leading ← (back). */
  direction?: "forward" | "back";
  asChild?: boolean;
}

export function ArrowLink({
  tone = "link",
  direction = "forward",
  asChild = false,
  className,
  children,
  ...props
}: ArrowLinkProps) {
  const Comp = asChild ? Slot : "a";
  const back = direction === "back";
  return (
    <Comp
      data-slot="arrow-link"
      className={cn(
        "group inline-flex shrink-0 items-center gap-1.5 rounded-sm font-sans text-base/4 font-medium tracking-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        tone === "link" && "text-link",
        tone === "ink" && "text-ink",
        tone === "accent" && "text-accent-blue",
        className,
      )}
      {...props}
    >
      {back && (
        <HugeiconsIcon
          icon={ArrowLeft02Icon}
          size={12}
          className="shrink-0 transition-transform duration-150 ease-out group-hover:-translate-x-0.5 motion-reduce:group-hover:translate-x-0"
        />
      )}
      {/* Slottable keeps `asChild` working next to the arrow siblings —
          Slot alone would see multiple children and throw. */}
      <Slottable>{children}</Slottable>
      {!back && (
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          size={12}
          className="shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
        />
      )}
    </Comp>
  );
}
