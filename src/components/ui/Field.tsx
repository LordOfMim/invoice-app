"use client";

import { Children, cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactNode, type ReactElement } from "react";
import { Label } from "@/components/platform/field";
import { cn } from "@/components/platform/lib/cn";
import { Input, SearchInput } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { DecimalInput } from "./DecimalInput";

type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Id for the control; generated when omitted. Lets other views focus this field. */
  id?: string;
  /** Visually hide the label (filter rows); it stays available to assistive technology. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
};

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

const hintClasses = "font-sans text-base tracking-snug";

/**
 * Platform `Field` rhythm: label above the control, quiet hint OR danger error below (never both), error announced
 * via role=alert. Readability profile: 13px label, hint in `ink-muted` (docs/design-reference.md, deviation 2).
 * A single control child is wired to the label; complex children are named by a fieldset legend instead.
 */
export function Field({ label, hint, error, id, hideLabel = false, className, children }: FieldProps) {
  const generated = useId();
  const child = Children.count(children) === 1 && isValidElement(children) ? children : null;
  const isControl = child && (
    child.type === "input" || child.type === "select" || child.type === "textarea" ||
    child.type === Input || child.type === Select || child.type === Textarea || child.type === DecimalInput || child.type === SearchInput
  );
  const control = isControl ? child as ReactElement<ControlProps> : null;
  const controlId = control?.props.id ?? id ?? generated;
  const descriptionId = `${controlId}-description`;
  const description = error ? (
    <p id={descriptionId} role="alert" className={cn(hintClasses, "text-danger")}>{error}</p>
  ) : hint ? (
    <p id={descriptionId} className={cn(hintClasses, "text-ink-muted")}>{hint}</p>
  ) : null;

  if (!control) {
    return (
      <fieldset className={cn("flex min-w-0 flex-col gap-1.5", className)} aria-describedby={description ? descriptionId : undefined}>
        <legend className={cn("mb-1.5 font-sans text-base font-medium tracking-snug text-ink-secondary", hideLabel && "sr-only")}>{label}</legend>
        {children}
        {description}
      </fieldset>
    );
  }

  return (
    <div data-slot="field" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={controlId} className={cn("text-base", hideLabel && "sr-only")}>{label}</Label>
      {cloneElement(control, {
        id: controlId,
        "aria-describedby": [control.props["aria-describedby"], description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : control.props["aria-invalid"],
      })}
      {description}
    </div>
  );
}

/** Checkbox or radio with its label on one line (Overwatch `Choice`). */
export function Choice({ label, hint, className, type = "checkbox", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; hint?: ReactNode; type?: "checkbox" | "radio" }) {
  return (
    <label className={cn("flex min-h-10 cursor-pointer items-start gap-2.5 py-2 font-sans text-lg/5 tracking-snug text-ink", className)}>
      <input type={type} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent-blue disabled:cursor-not-allowed disabled:opacity-50 touch:size-5" {...props} />
      <span className="flex min-w-0 flex-col gap-0.5">
        {label}
        {hint && <span className="font-sans text-base tracking-snug text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}
