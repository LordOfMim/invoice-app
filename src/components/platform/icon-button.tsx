import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Icon buttons: outline (white with the low shadow as its edge), ghost and solid (near-black fill);
 * sizes 26px (radius 6), 28px and 38px (radius 8).
 */
const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center outline-none transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        outline:
          "bg-surface text-ink-secondary shadow-low hover:bg-surface-muted",
        ghost: "text-ink-muted hover:bg-surface-muted",
        solid: "bg-fill text-white hover:bg-fill-hover",
      },
      size: {
        sm: "size-6.5 rounded-sm",
        md: "size-7 rounded-md",
        lg: "size-9.5 rounded-md",
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
