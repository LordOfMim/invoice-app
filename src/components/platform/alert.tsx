import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";

/*
 * Inline alert/callout for messages in a flow: danger/success get a tinted
 * plate with its matching line and ink step, info stays a neutral tonal
 * surface. No icons.
 *
 * Semantics follow the variant: danger interrupts (role=alert), success and
 * info announce politely (role=status).
 */
const alertVariants = cva(
  "flex w-full items-start rounded-md border p-3 font-sans text-base",
  {
    variants: {
      variant: {
        danger: "border-danger-line bg-danger-tint text-danger-ink",
        success: "border-success-line bg-success-tint text-success-ink",
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
