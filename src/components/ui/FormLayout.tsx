import type { ReactNode } from "react";
import { cn } from "@/components/platform/lib/cn";

/*
 * Form compositions after humaify-overwatch `src/components/ui/form-layout.tsx`: `FormPage` (880px column of
 * stacked groups), `FormSection` (Platform workspace-settings recipe: 15px semibold title, muted description, field
 * grid) and the filter row of the Platform audit page. Helferlein saves every input immediately, so there is no
 * submit row unless a form really submits something.
 */

/** Form group: section head over a field grid. Groups stack 40px apart inside `FormPage`. */
export function FormSection({ title, description, columns = 2, id, actions, className, children }: { title: ReactNode; description?: ReactNode; columns?: 1 | 2 | 3; id?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 scroll-mt-24 flex-col gap-4", className)} aria-labelledby={id ? `${id}-title` : undefined} id={id}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id ? `${id}-title` : undefined} tabIndex={id ? -1 : undefined} className="font-sans text-xl/5.5 font-semibold tracking-snug text-ink outline-none">{title}</h2>
          {description && <p className="max-w-[72ch] font-sans text-base tracking-snug text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("grid min-w-0 content-start gap-4", { "sm:grid-cols-2": columns === 2, "sm:grid-cols-2 xl:grid-cols-3": columns === 3 })}>{children}</div>
    </section>
  );
}

/** Full-page form frame (narrow 880px column): stacked groups, then an optional action row. */
export function FormPage({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full min-w-0 max-w-[880px] flex-col gap-10", className)}>
      {children}
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/**
 * Filter row (Platform audit page, Overwatch `FilterBar`) for live client-side filters: no box around the row,
 * controls with fixed widths, "Zurücksetzen" only while a filter is active, result count on the right.
 */
export function FilterBar({ label, aside, className, children }: { label: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div role="search" aria-label={label} className={cn("no-print flex flex-wrap items-end gap-3", className)}>
      {children}
      {aside && <div className="ml-auto flex items-center gap-3 self-center font-sans text-base tracking-snug text-ink-muted" role="status">{aside}</div>}
    </div>
  );
}

/** Sensible width for a filter control; on phones regular controls take the row, small ones share it in pairs. */
export function FilterControl({ width = "md", className, children }: { width?: "sm" | "md" | "lg" | "grow"; className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0", { "w-44 max-sm:min-w-32 max-sm:flex-1": width === "sm", "w-52 max-sm:w-full": width === "md", "w-72 max-sm:w-full": width === "lg", "min-w-60 flex-1 max-sm:basis-full": width === "grow" }, className)}>{children}</div>;
}
