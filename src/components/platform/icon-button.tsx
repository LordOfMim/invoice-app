import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Source: flow page — dialer button (outline, 28px, radius 8), breadcrumb
 * settings button (ghost, 26px, radius 7), icon-rail items (40px, radius 9,
 * active = solid ink).
 */
const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center outline-none transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        outline:
          "border border-line bg-surface text-ink-muted hover:bg-surface-subtle",
        ghost: "text-ink-muted hover:bg-surface-muted",
        solid: "bg-ink text-white hover:bg-ink/90",
      },
      size: {
        sm: "size-6.5 rounded-sm",
        md: "size-7 rounded-md",
        lg: "size-9.5 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
  "aria-label": string;
}

export function IconButton({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { iconButtonVariants };
