import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/platform/lib/cn";
import { Button } from "./Button";

/*
 * Directory table after humaify-overwatch `src/components/ui/data.tsx` (Platform `DataTable`, `Pager`): hairline
 * plate, mono-caps column heads on the rail surface, rows on hairlines, no zebra stripes. The first column names the
 * object, amounts are right-aligned with tabular figures, row actions sit last. Below md every row becomes a hairline
 * card with visible column labels. Readability profile: 14.5px cells and 11px heads in ink-muted
 * (docs/design-reference.md, deviation 2).
 */
export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  /** Right-aligned tabular figures (amounts, counts). */
  numeric?: boolean;
  width?: string;
  /** Hide the header text visually (row action columns). */
  hideHeader?: boolean;
  render: (row: T) => ReactNode;
  className?: string;
};

export type DataTableProps<T> = {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
};

export function DataTable<T>({ columns, rows, rowKey, caption, empty, rowClassName, className }: DataTableProps<T>) {
  return (
    <div className={cn("relative w-full min-w-0 md:overflow-x-auto md:rounded-card-sm md:border md:border-line", className)} role="region" aria-label={caption} tabIndex={0}>
      <table role="table" className="w-full border-collapse text-left max-md:block">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="max-md:sr-only">
          <tr role="row">
            {columns.map((column) => (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn("h-10 border-b border-line bg-surface-rail px-4 font-mono text-xs font-medium tracking-caps whitespace-nowrap text-ink-muted uppercase", column.numeric && "text-right", column.className)}
              >
                {column.hideHeader ? <span className="sr-only">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:flex max-md:flex-col max-md:gap-3">
          {rows.length ? rows.map((row) => (
            <tr key={rowKey(row)} role="row" className={cn("max-md:flex max-md:flex-col max-md:gap-2 max-md:rounded-card-sm max-md:border max-md:border-line max-md:bg-surface max-md:p-4 md:[&:last-child>td]:border-b-0", rowClassName?.(row))}>
              {columns.map((column, index) => {
                const label = index > 0 && !column.hideHeader && typeof column.header === "string" && column.header ? column.header : undefined;
                return (
                  <td
                    key={column.key}
                    role="cell"
                    className={cn(
                      "border-b border-line px-4 py-3 align-middle font-sans text-lg/5 tracking-snug text-ink-body",
                      column.numeric && "md:text-right tabular-nums",
                      "max-md:min-w-0 max-md:border-0 max-md:p-0 max-md:whitespace-normal",
                      label && "max-md:flex max-md:flex-wrap max-md:items-baseline max-md:justify-between max-md:gap-x-4 max-md:gap-y-1",
                      !label && index > 0 && "max-md:flex max-md:flex-wrap max-md:justify-end max-md:gap-2",
                      column.className,
                    )}
                  >
                    {label ? (
                      <>
                        <span aria-hidden className="shrink-0 font-sans text-base text-ink-muted md:hidden">{label}</span>
                        <span className="min-w-0 max-md:ml-auto max-md:max-w-full max-md:text-right max-md:break-words">{column.render(row)}</span>
                      </>
                    ) : column.render(row)}
                  </td>
                );
              })}
            </tr>
          )) : (
            <tr role="row" className="max-md:block max-md:rounded-card-sm max-md:border max-md:border-line">
              <td role="cell" colSpan={Math.max(columns.length, 1)} className="px-4 py-6 font-sans text-lg tracking-snug text-ink-muted max-md:block">{empty ?? "Keine Einträge."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Primary table cell: object name (optionally linked) with a quiet sublabel. */
export function PrimaryCell({ title, href, sub, aside }: { title: ReactNode; href?: string; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {href
          ? <Link href={href} className="rounded-sm font-semibold text-ink outline-none underline-offset-3 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{title}</Link>
          : <span className="font-semibold text-ink">{title}</span>}
        {aside}
      </div>
      {sub && <div className="mt-0.5 font-sans text-base font-normal tracking-snug text-ink-muted max-md:break-words md:truncate">{sub}</div>}
    </div>
  );
}

/** Platform `Pager`: count left, previous/next as secondary buttons right. */
export function Pagination({ total, page, pageSize, unit, onPageChange, labels }: { total: number; page: number; pageSize: number; unit: string; onPageChange: (page: number) => void; labels: { nav: string; page: (page: number, pages: number) => string; previous: string; next: string } }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label={labels.nav} className="no-print flex flex-wrap items-center justify-between gap-3">
      <span className="font-sans text-base tracking-snug text-ink-muted tabular-nums">{total} {unit} · {labels.page(page, pages)}</span>
      {pages > 1 && (
        <span className="flex gap-2">
          <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>{labels.previous}</Button>
          <Button disabled={page >= pages} onClick={() => onPageChange(page + 1)}>{labels.next}</Button>
        </span>
      )}
    </nav>
  );
}
