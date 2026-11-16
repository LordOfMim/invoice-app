import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";
import { Spinner } from "./spinner";

/*
 * Palermo button: 8px radius, 13px medium label, 150ms. Primary is the near-black fill with white text, secondary a
 * white control whose edge comes from the low shadow (no border), ghost a transparent control, quiet Palermo's
 * "subtle", danger the destructive fill. Heights: sm 24, md 28 (Palermo regular), lg 38 (Palermo large).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-sans outline-none transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-fill font-medium text-white hover:bg-fill-hover",
        secondary:
          "bg-surface font-medium text-ink shadow-low hover:bg-surface-muted",
        ghost:
          "font-medium text-ink hover:bg-surface-muted",
        quiet:
          "font-medium text-ink-secondary hover:text-ink",
        danger: "bg-danger-solid font-medium text-white hover:bg-danger-ink",
        dark: "bg-fill font-medium text-white hover:bg-fill-hover",
      },
      size: {
        sm: "h-6 px-2 text-sm",
        md: "h-7 px-2.5 text-md",
        lg: "h-9.5 gap-1.5 px-3.5 text-base",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "sm",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Work in flight: disables the button and leads with a spinner. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={loading ? true : disabled}
      {...props}
    >
      {/* Slot requires a single child — asChild callers own their content. */}
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner size={size === "lg" ? 14 : 12} />}
          {children}
        </>
      )}
    </Comp>
  );
}

/*
 * Split button: primary action segment + hairline divider + a quiet trailing segment.
 */
export interface SplitButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Trailing segment content (rendered as its own button). */
  trailing: React.ReactNode;
  onTrailingClick?: React.MouseEventHandler<HTMLButtonElement>;
  trailingProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}

export function SplitButton({
  className,
  children,
  trailing,
  onTrailingClick,
  trailingProps,
  ...props
}: SplitButtonProps) {
  return (
    <div
      data-slot="split-button"
      className={cn(
        "inline-flex h-7 shrink-0 overflow-clip rounded-md shadow-low transition-transform duration-150 ease-out has-[button:active]:scale-[0.97] motion-reduce:has-[button:active]:scale-100",
        className,
      )}
    >
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 bg-fill pr-2.5 pl-2.25 font-sans text-md font-medium text-white outline-none transition-colors hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0"
        {...props}
      >
        {children}
      </button>
      <div className="w-px shrink-0 bg-line-control" />
      <button
        type="button"
        onClick={onTrailingClick}
        className="inline-flex cursor-pointer items-center bg-surface-rail px-2.25 font-sans text-xs font-medium text-ink-secondary outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        {...trailingProps}
      >
        {trailing}
      </button>
    </div>
  );
}

export { buttonVariants };
