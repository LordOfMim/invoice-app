import * as React from "react";

import { cn } from "./lib/cn";

/*
 * Source: sign-in page (Jul 2026). Form-field pattern: label above the
 * control, quiet hint OR danger error below — one vertical rhythm for every
 * auth/settings form. Label styling comes from the sign-in email field.
 * The error slot replaces the hint (never both) and carries role="alert"
 * so screen readers announce it when it appears.
 */

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={cn(
        "font-sans text-sm font-medium tracking-snug text-ink-secondary",
        className,
      )}
      {...props}
    />
  );
}

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  /** id of the control inside; wires the label's htmlFor. */
  htmlFor?: string;
  /** Quiet guidance below the control (suppressed while error is set). */
  hint?: React.ReactNode;
  /** Error below the control; replaces the hint, announced via role=alert. */
  error?: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div
      data-slot="field"
      className={cn("flex w-full flex-col gap-1.5", className)}
      {...props}
    >
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error != null ? (
        <p role="alert" className="font-sans text-sm tracking-snug text-danger">
          {error}
        </p>
      ) : hint != null ? (
        <p className="font-sans text-sm tracking-snug text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}
