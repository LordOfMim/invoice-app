import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-(--color-ink-muted)">{label}</span>
        {hint && <span className="text-[11px] text-(--color-ink-subtle)">{hint}</span>}
      </div>
      {children}
      {error && (
        <p className="text-xs text-(--color-danger)">{error}</p>
      )}
    </label>
  );
}
