import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";
import { Spinner } from "./spinner";

/*
 * Source: flow page — "+ Step" button (secondary) and the Publish split button
 * (primary segment). Primary = accent blue #5CABFF with white semibold label.
 * Extensions (auth/settings screens, Jul 2026): quiet (text-only step-up,
 * calmer than ghost — mode toggles, sign-out), danger (destructive solid on
 * the provisional danger red), lg size (36px auth-screen scale-up, the
 * formalized sign-in deviation), and a `loading` prop (spinner + disabled).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-sans outline-none transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent-blue font-semibold text-white tracking-snug hover:bg-accent-blue/90",
        secondary:
          "border border-line-control bg-surface font-medium text-ink-secondary tracking-snug hover:bg-surface-subtle",
        ghost:
          "font-medium text-ink-secondary tracking-snug hover:bg-surface-muted",
        quiet:
          "font-medium text-ink-soft tracking-snug hover:text-ink-secondary",
        danger: "bg-danger font-semibold text-white tracking-snug hover:bg-danger/90",
        dark: "bg-ink font-medium text-white tracking-snug hover:bg-ink/90",
      },
      size: {
        sm: "h-6.5 px-2.75 text-sm",
        md: "h-7 px-3 text-md",
        lg: "h-9 gap-2 px-3.5 text-base",
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
 * Split button — Publish pattern from the top bar: primary action segment +
 * hairline divider + a quiet trailing segment (e.g. release counter "r 19").
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
        "inline-flex h-7 shrink-0 overflow-clip rounded-md border border-line-control transition-transform duration-150 ease-out has-[button:active]:scale-[0.97] motion-reduce:has-[button:active]:scale-100",
        className,
      )}
    >
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 bg-accent-blue pr-2.5 pl-2.25 font-sans text-md font-semibold tracking-snug text-white outline-none transition-colors hover:bg-accent-blue/90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0"
        {...props}
      >
        {children}
      </button>
      <div className="w-px shrink-0 bg-line-control" />
      <button
        type="button"
        onClick={onTrailingClick}
        className="inline-flex cursor-pointer items-center bg-surface-rail px-2.25 font-mono text-xs outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        {...trailingProps}
      >
        {trailing}
      </button>
    </div>
  );
}

export { buttonVariants };
