import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Inline alert/callout for form flows (auth screens: passkey error,
 * magic-link sent, 2FA required). Flagged deviation (approved, sign-in
 * states Jul 2026): first surface-level use of the tint families outside
 * badges — danger/success get a tinted plate + matching ink, info stays a
 * neutral tonal surface. No icons, no titles: one quiet sentence.
 *
 * Semantics follow the variant: danger interrupts (role=alert), success and
 * info announce politely (role=status).
 */
const alertVariants = cva(
  "flex w-full items-start rounded-lg border px-3 py-2.5 font-sans text-sm tracking-snug",
  {
    variants: {
      variant: {
        danger: "border-danger/20 bg-danger/6 text-danger",
        success: "border-success/25 bg-success-tint text-success-ink",
        info: "border-line bg-surface-subtle text-ink-body",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, role, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={role ?? (variant === "danger" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { alertVariants };
