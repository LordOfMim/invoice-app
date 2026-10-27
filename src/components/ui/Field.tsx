"use client";

import { Children, cloneElement, isValidElement, useId, type ReactNode, type ReactElement } from "react";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
};

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const child = Children.count(children) === 1 && isValidElement(children) ? children : null;
  const isControl = child && (
    child.type === "input" || child.type === "select" || child.type === "textarea" ||
    child.type === Input || child.type === Select || child.type === Textarea
  );
  const control = isControl ? child as ReactElement<ControlProps> : null;
  const controlId = control?.props.id ?? id;
  const descriptionId = `${id}-description`;
  const description = (error || hint) && (
    <p
      id={descriptionId}
      role={error ? "alert" : undefined}
      className={`text-sm ${error ? "text-(--color-danger)" : "text-(--color-ink-subtle)"}`}
    >
      {error || hint}
    </p>
  );

  // Complex children keep their own labels; a legend names the group without
  // pointing an outer label at another label or non-interactive wrapper.
  if (!control) {
    return (
      <fieldset
        className={`min-w-0 space-y-2 ${className ?? ""}`}
        aria-describedby={hint || error ? descriptionId : undefined}
      >
        <legend className="text-sm font-medium text-(--color-ink-muted)">{label}</legend>
        {children}
        {description}
      </fieldset>
    );
  }

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <label htmlFor={controlId} className="block text-sm font-medium text-(--color-ink-muted)">
        {label}
      </label>
      {cloneElement(control, {
        id: controlId,
        "aria-describedby": [control.props["aria-describedby"], hint || error ? descriptionId : undefined]
          .filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : control.props["aria-invalid"],
      })}
      {description}
    </div>
  );
}
