import Link from "next/link";
import { Children, type HTMLAttributes, type ReactNode } from "react";
import { InboxIcon } from "@hugeicons/core-free-icons";
import { Alert } from "@/components/platform/alert";
import { ArrowLink } from "@/components/platform/arrow-link";
import { EmptyState as PlatformEmptyState } from "@/components/platform/empty-state";
import { IdentityHeader } from "@/components/platform/identity-header";
import { PageHeading } from "@/components/platform/page-heading";
import { StatCell } from "@/components/platform/stat-cell";
import { cn } from "@/components/platform/lib/cn";

/*
 * Page compositions after humaify-overwatch `src/components/ui/layout.tsx` (Platform `PageHeading`,
 * `IdentityHeader`, `PageSection`, `Plate`, `StatRow`, `Alert`, `EmptyState`), at the Helferlein readability
 * profile (docs/design-reference.md, deviation 2).
 */

/** Vertical rhythm for a page: header, then sections 40px apart (Platform StaffPageFrame). */
export function Page({ width = "default", className, ...props }: HTMLAttributes<HTMLDivElement> & { width?: "default" | "narrow" }) {
  return <div className={cn("flex min-w-0 flex-col gap-10", width === "narrow" && "w-full max-w-[880px]", className)} {...props} />;
}

/** Hairline plate (Platform `Plate`): groups related rows, fields or an aggregate. Never nested. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-clip rounded-card-sm border border-line bg-surface", className)} {...props} />;
}

/** Zone inside a plate; zones are separated by full-bleed hairlines, never nested boxes. */
export function CardZone({ padding = "md", className, ...props }: HTMLAttributes<HTMLDivElement> & { padding?: "sm" | "md" }) {
  return <div className={cn("border-t border-line first:border-t-0", padding === "sm" ? "px-4 py-3" : "p-4 sm:p-5", className)} {...props} />;
}

export function initialsOf(name: string) {
  return name.trim().split(/[\s-]+/).filter((part) => /\p{L}/u.test(part[0] ?? "")).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("de-DE");
}

function MetaRow({ items }: { items: readonly ReactNode[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {Children.toArray(items).map((item, index) => (
        <span key={index} className="contents">
          {index > 0 && <span aria-hidden="true" className="text-line-dash">·</span>}
          <span className="min-w-0">{item}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Page-head action row. On phones it takes the full width below the title and its buttons share the row; order and
 * variants stay as given, so the one primary action remains the blue one.
 */
function HeaderActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("no-print flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>[data-slot=button]]:grow", className)}>{children}</div>;
}

export type PageHeaderProps = {
  title: ReactNode;
  /** `tool` for lists and work pages (PageHeading), `entity` for one object (IdentityHeader). */
  variant?: "tool" | "entity";
  initials?: string;
  status?: ReactNode;
  description?: ReactNode;
  meta?: readonly ReactNode[];
  actions?: ReactNode;
  className?: string;
};

/**
 * Every page answers: where am I (title), what is this for (one or two sentences), what can I do (actions right).
 * Tool pages use Platform `PageHeading`; object pages use `IdentityHeader` (44px ink mark, name, status pill).
 */
export function PageHeader({ title, variant = "tool", initials, status, description, meta, actions, className }: PageHeaderProps) {
  const metaRow = meta && meta.length > 0 ? <MetaRow items={meta} /> : null;
  if (variant === "entity") {
    return (
      <header className={cn("min-w-0", className)}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <IdentityHeader
            name={title}
            initials={initials}
            status={status}
            description={description}
            className="min-w-0 md:flex-1 max-sm:items-start [&_.truncate]:whitespace-normal [&_.truncate]:wrap-anywhere"
          />
          {actions && <HeaderActions className="md:ml-auto md:shrink-0 md:flex-nowrap">{actions}</HeaderActions>}
        </div>
        {metaRow && <div className="mt-3 font-sans text-base tracking-snug text-ink-muted sm:pl-15">{metaRow}</div>}
      </header>
    );
  }
  return (
    <header className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 max-w-[80ch] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <PageHeading className="w-auto min-w-0 wrap-break-word">{title}</PageHeading>
            {status}
          </div>
          {description && <p className="font-sans text-lg/5 tracking-snug text-ink-muted">{description}</p>}
          {metaRow && <div className="font-sans text-base tracking-snug text-ink-muted">{metaRow}</div>}
        </div>
        {actions && <HeaderActions>{actions}</HeaderActions>}
      </div>
    </header>
  );
}

export type SectionHeaderProps = {
  title: ReactNode;
  summary?: ReactNode;
  link?: { href: string; label: ReactNode };
  actions?: ReactNode;
  as?: "h2" | "h3";
  id?: string;
  className?: string;
};

/** Platform `PageSection` head: 15px semibold title, muted description, trailing link or actions. */
export function SectionHeader({ title, summary, link, actions, as: Heading = "h2", id, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={id} tabIndex={id ? -1 : undefined} className="font-sans text-xl/5.5 font-semibold tracking-snug text-ink outline-none">{title}</Heading>
        {summary !== undefined && summary !== null && <div className="max-w-[72ch] font-sans text-base tracking-snug text-ink-muted">{summary}</div>}
      </div>
      {(actions || link) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {link && <ArrowLink asChild className="text-lg/5"><Link href={link.href}>{link.label}</Link></ArrowLink>}
        </div>
      )}
    </div>
  );
}

export type SectionProps = Omit<HTMLAttributes<HTMLElement>, "title"> & Omit<SectionHeaderProps, "className" | "title" | "id"> & { title?: ReactNode; headingId?: string };

/** A titled block living directly on the page surface (Platform `PageSection`). */
export function Section({ title, summary, link, actions, as, headingId, className, children, ...props }: SectionProps) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} aria-labelledby={title ? headingId : undefined} {...props}>
      {title && <SectionHeader title={title} summary={summary} link={link} actions={actions} as={as} id={headingId} />}
      {children}
    </section>
  );
}

/** Navigation only: Platform `ArrowLink` ("Alle Rechnungen →") or a quiet ink link for entity names. */
export function TextLink({ href, arrow = false, className, children }: { href: string; arrow?: boolean; className?: string; children: ReactNode }) {
  if (arrow) return <ArrowLink asChild className={cn("text-lg/5", className)}><Link href={href}>{children}</Link></ArrowLink>;
  return <Link href={href} className={cn("rounded-sm font-medium tracking-snug text-link outline-none underline-offset-3 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50", className)}>{children}</Link>;
}

export type KeyValueItem = { label: ReactNode; value: ReactNode; hint?: ReactNode; emphasis?: boolean };

/**
 * `leader`: master data as detail rows inside a hairline plate (label lane left, value right).
 * `pulse`: compact label/value rows, e.g. totals.
 */
export function KeyValueList({ items, variant = "pulse", className }: { items: readonly KeyValueItem[]; variant?: "pulse" | "leader"; className?: string }) {
  if (variant === "leader") {
    return (
      <dl className={cn("flex min-w-0 flex-col overflow-clip rounded-card-sm border border-line bg-surface", className)}>
        {items.map((item, index) => (
          <div key={index} className="flex flex-col gap-1 border-line px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6 [&:not(:last-child)]:border-b">
            <dt className="shrink-0 font-sans text-base font-medium tracking-snug text-ink-secondary sm:w-48">{item.label}</dt>
            <dd className="min-w-0 break-words font-sans text-lg/5 tracking-snug text-ink">
              {item.value}
              {item.hint && <div className="mt-0.5 font-sans text-base font-normal tracking-snug text-ink-muted">{item.hint}</div>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn("min-w-0", className)}>
      {items.map((item, index) => (
        <div key={index} className={cn("flex min-h-8 items-baseline justify-between gap-4", item.emphasis && "mt-1 border-t border-line pt-2")}>
          <dt className="min-w-0 font-sans text-base tracking-snug text-ink-muted">{item.label}</dt>
          <dd className={cn("shrink-0 whitespace-nowrap text-right font-sans tracking-snug text-ink tabular-nums", item.emphasis ? "text-2xl font-semibold" : "text-lg font-medium")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type KeyFigure = { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "neutral" | "ok" | "attention" | "error"; href?: string };
const figureTone = { neutral: "ink", ok: "success", attention: "warn", error: "danger" } as const;

/** Platform `StatRow`: one hairline plate with two to four StatCells (tone tick + semibold value, quiet hint). */
export function KeyFigures({ items, className }: { items: readonly KeyFigure[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 rounded-card-sm border border-line p-5 sm:p-6", items.length > 1 && "min-[25rem]:grid-cols-2", items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "", className)}>
      {items.map((item, index) => {
        const cell = (
          <StatCell
            label={<span className="text-base text-ink-muted">{item.label}</span>}
            value={<span className="text-2xl tabular-nums">{item.value}</span>}
            tone={figureTone[item.tone ?? "neutral"]}
            footer={item.hint ? <span className="font-sans text-base tracking-snug text-ink-muted">{item.hint}</span> : undefined}
            className="min-w-0"
          />
        );
        return item.href
          ? <Link key={index} href={item.href} className="-m-2 min-w-0 rounded-lg p-2 outline-none transition-colors duration-150 hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-ring/50">{cell}</Link>
          : <div key={index} className="min-w-0">{cell}</div>;
      })}
    </div>
  );
}

export type StatusNoteTone = "ok" | "attention" | "error" | "info";

/**
 * Platform `Alert` for messages in a flow: danger/success tint, info on the subtle surface, plus Overwatch's warn
 * family for "needs attention". An optional title leads in medium weight; prose follows. No icons.
 */
export function StatusNote({ tone = "info", title, action, className, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { tone?: StatusNoteTone; title?: ReactNode; action?: ReactNode }) {
  const variant = tone === "error" ? "danger" : tone === "ok" ? "success" : "info";
  return (
    <Alert variant={variant} className={cn("min-w-0 flex-col gap-1 px-4 py-3 text-base/5", tone === "attention" && "border-warn-line/60 bg-warn/8 text-warn-ink", className)} {...props}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className="[&_li]:mt-0.5 [&_ul]:list-disc [&_ul]:pl-4">{children}</div>}
      {action && <div className="mt-1.5 flex flex-wrap gap-2">{action}</div>}
    </Alert>
  );
}

/** Platform `EmptyState` on a hairline plate; Overwatch keeps at most one next action below. */
export function EmptyState({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-card-sm border border-line px-4 pb-10", className)}>
      <PlatformEmptyState icon={InboxIcon} title={<span className="text-lg">{title}</span>} caption={description ? <span className="text-base">{description}</span> : undefined} className="max-w-md pb-0" />
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Quiet timestamp row under an object form. */
export function RecordStamp({ children }: { children: ReactNode }) {
  return <p className="font-sans text-base tracking-snug text-ink-muted">{children}</p>;
}
