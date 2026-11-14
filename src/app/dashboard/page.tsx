"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { createInvoice, getDashboardStats, getUpcomingReminders, getDueRecurringInvoices } from "@/lib/storage/store";
import { computeInvoiceBalance } from "@/lib/calc";
import { dateToLocalISO, daysBetweenDateOnly, formatDateOnly, formatMonthKey, todayLocalISO } from "@/lib/date";
import { Card, CardZone, EmptyState, KeyFigures, Page, PageHeader, Section, StatusNote } from "@/components/ui/Layout";
import { StatusPill } from "@/components/ui/Status";
import { Button } from "@/components/ui/Button";
import { StatusRing } from "@/components/platform/status-ring";
import { cn } from "@/components/platform/lib/cn";
import type { CreditNote, Language } from "@/lib/domain";

const dashboardLabels: Record<Language, {
  description: string;
  viewAll: string;
  noNumber: string;
  unnamedRecurring: string;
  unnamedCustomer: string;
  remaining: string;
  daysOverdue: (days: number) => string;
  next: string;
  noRevenue: string;
  noRevenueDescription: string;
  noInvoicesDescription: string;
  collectedThisMonth: string;
  issuedThisMonth: string;
  dueNextSevenDays: string;
  collectionRate: string;
  paidOfBilled: string;
  invoicesSuffix: (count: number) => string;
  avgDaysToPay: string;
  noPaidInvoices: string;
  paymentMix: string;
  paid: string;
  partial: string;
  overdue: string;
  unpaid: string;
  receivablesAging: string;
  current: string;
  topCustomers: string;
  billed: string;
  outstanding: string;
  dueSoon: string;
  noDueSoon: string;
  noDueSoonDescription: string;
  cashFlow: string;
}> = {
  de: {
    description: "Zahlungen, offene Forderungen und Kundenaktivität auf einen Blick.",
    viewAll: "Alle anzeigen",
    noNumber: "(ohne Nummer)",
    unnamedRecurring: "Unbenannte wiederkehrende Rechnung",
    unnamedCustomer: "Unbenannter Kunde",
    remaining: "offen",
    daysOverdue: (days) => `${days} Tage überfällig`,
    next: "Nächste",
    noRevenue: "Noch keine Umsätze",
    noRevenueDescription: "Sobald Zahlungen erfasst werden, erscheinen sie hier.",
    noInvoicesDescription: "Erstelle deine erste Rechnung, um loszulegen.",
    collectedThisMonth: "Eingegangen diesen Monat",
    issuedThisMonth: "Gestellt diesen Monat",
    dueNextSevenDays: "Fällig in 7 Tagen",
    collectionRate: "Zahlungsquote",
    paidOfBilled: "bezahlt vom Rechnungswert",
    invoicesSuffix: (count) => `${count} Rechnung${count === 1 ? "" : "en"}`,
    avgDaysToPay: "Durchschn. Zahlungsdauer",
    noPaidInvoices: "Noch keine bezahlten Rechnungen",
    paymentMix: "Zahlungsstatus",
    paid: "Bezahlt",
    partial: "Teilweise",
    overdue: "Überfällig",
    unpaid: "Unbezahlt",
    receivablesAging: "Forderungsalter",
    current: "Nicht überfällig",
    topCustomers: "Top-Kunden",
    billed: "Berechnet",
    outstanding: "Offen",
    dueSoon: "Bald fällig",
    noDueSoon: "Nichts bald fällig",
    noDueSoonDescription: "Keine offenen Rechnungen in den nächsten sieben Tagen.",
    cashFlow: "Cashflow",
  },
  en: {
    description: "Payments, receivables, and customer activity at a glance.",
    viewAll: "View all",
    noNumber: "(no number)",
    unnamedRecurring: "Unnamed recurring invoice",
    unnamedCustomer: "Unnamed customer",
    remaining: "remaining",
    daysOverdue: (days) => `${days} days overdue`,
    next: "Next",
    noRevenue: "No revenue yet",
    noRevenueDescription: "Payments will appear here once they are recorded.",
    noInvoicesDescription: "Create your first invoice to get started.",
    collectedThisMonth: "Collected this month",
    issuedThisMonth: "Issued this month",
    dueNextSevenDays: "Due in 7 days",
    collectionRate: "Collection rate",
    paidOfBilled: "paid from billed value",
    invoicesSuffix: (count) => `${count} invoice${count === 1 ? "" : "s"}`,
    avgDaysToPay: "Avg. days to pay",
    noPaidInvoices: "No paid invoices yet",
    paymentMix: "Payment status",
    paid: "Paid",
    partial: "Partial",
    overdue: "Overdue",
    unpaid: "Unpaid",
    receivablesAging: "Receivables aging",
    current: "Not overdue",
    topCustomers: "Top customers",
    billed: "Billed",
    outstanding: "Outstanding",
    dueSoon: "Due soon",
    noDueSoon: "Nothing due soon",
    noDueSoonDescription: "No open invoices are due in the next seven days.",
    cashFlow: "Cash flow",
  },
};

/** Horizontal bar on the Platform surface: muted track, flat fill, no gradients or animation. */
function Bar({ share, tone = "ink" }: { share: number; tone?: "ink" | "warn" | "danger" | "success" }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-pill bg-surface-muted" aria-hidden>
      <div
        className={cn("h-full rounded-pill", { ink: "bg-ink", warn: "bg-warn", danger: "bg-danger", success: "bg-success" }[tone])}
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, minWidth: share > 0 ? "4px" : "0" }}
      />
    </div>
  );
}

function RevenueChart({ data, locale, currency }: { data: { month: string; revenue: number }[]; locale: string; currency: string }) {
  const maxRevenue = Math.max(...data.map((d) => Math.abs(d.revenue)), 1);
  return (
    <ul className="flex flex-col gap-3">
      {data.map(({ month, revenue }) => (
        <li key={month} className="grid grid-cols-[4.5rem_minmax(0,1fr)_7.5rem] items-center gap-3">
          <span className="font-sans text-base tracking-snug text-ink-muted">{formatMonthKey(month, locale)}</span>
          <Bar share={Math.abs(revenue) / maxRevenue} />
          <span className="text-right font-sans text-base font-medium tracking-snug text-ink tabular-nums">{formatMoney(revenue, currency, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

function AgingBars({ buckets, locale, currency, labels }: { buckets: NonNullable<ReturnType<typeof getDashboardStats>>["agingBuckets"]; locale: string; currency: string; labels: (typeof dashboardLabels)[Language] }) {
  const maxTotal = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const bucketLabels: Record<(typeof buckets)[number]["bucket"], string> = { current: labels.current, "1-30": "1–30", "31-60": "31–60", "61+": "61+" };
  return (
    <ul className="flex flex-col gap-3">
      {buckets.map((bucket) => (
        <li key={bucket.bucket} className="grid grid-cols-[7rem_minmax(0,1fr)_8rem] items-center gap-3">
          <span className="font-sans text-base font-medium tracking-snug text-ink-secondary">{bucketLabels[bucket.bucket]}</span>
          <Bar share={bucket.total / maxTotal} tone={bucket.bucket === "current" ? "ink" : bucket.bucket === "1-30" ? "warn" : "danger"} />
          <span className="text-right font-sans text-base tracking-snug tabular-nums">
            <span className="block font-medium text-ink">{formatMoney(bucket.total, currency, locale)}</span>
            <span className="block text-ink-muted">{labels.invoicesSuffix(bucket.count)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatusMix({ counts, labels }: { counts: NonNullable<ReturnType<typeof getDashboardStats>>["statusCounts"]; labels: (typeof dashboardLabels)[Language] }) {
  const total = Math.max(Object.values(counts).reduce((sum, count) => sum + count, 0), 1);
  const items = [
    { key: "paid" as const, label: labels.paid, value: counts.paid, tone: "success" as const },
    { key: "partial" as const, label: labels.partial, value: counts.partial, tone: "warn" as const },
    { key: "overdue" as const, label: labels.overdue, value: counts.overdue, tone: "danger" as const },
    { key: "unpaid" as const, label: labels.unpaid, value: counts.unpaid, tone: "ink" as const },
  ];
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-3">
          <span className="font-sans text-base font-medium tracking-snug text-ink-secondary">{item.label}</span>
          <Bar share={item.value / total} tone={item.tone} />
          <span className="text-right font-sans text-base font-semibold tracking-snug text-ink tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

function buildCreditNoteMap(creditNotes: CreditNote[]) {
  const creditNotesByInvoiceId = new Map<string, CreditNote[]>();
  for (const creditNote of creditNotes) {
    const linked = creditNotesByInvoiceId.get(creditNote.linkedInvoiceId);
    if (linked) linked.push(creditNote);
    else creditNotesByInvoiceId.set(creditNote.linkedInvoiceId, [creditNote]);
  }
  return creditNotesByInvoiceId;
}

/** Ledger row (Platform list plate): ring + linked title, quiet sub line, value right. */
function LedgerRow({ href, tone, title, sub, value, valueSub }: { href: string; tone?: "success" | "progress" | "danger" | "info" | "muted"; title: ReactNode; sub: ReactNode; value: ReactNode; valueSub?: ReactNode }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <Link href={href} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors duration-100 hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
        {tone && <StatusRing tone={tone} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-sans text-lg font-semibold tracking-snug text-ink">{title}</span>
          <span className="block truncate font-sans text-base tracking-snug text-ink-muted">{sub}</span>
        </span>
        <span className="shrink-0 text-right font-sans tracking-snug tabular-nums">
          <span className="block text-lg font-semibold text-ink">{value}</span>
          {valueSub && <span className="block text-base text-ink-muted">{valueSub}</span>}
        </span>
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";
  const labels = dashboardLabels[language];
  const today = todayLocalISO();

  const stats = useMemo(() => {
    if (!adapter) return null;
    return getDashboardStats(adapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, data]);
  const upcomingReminders = useMemo(() => {
    if (!adapter) return [];
    return getUpcomingReminders(adapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, data]);
  const dueRecurring = useMemo(() => {
    if (!adapter) return [];
    return getDueRecurringInvoices(adapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, data]);
  const creditNotesByInvoiceId = useMemo(() => buildCreditNoteMap(data?.creditNotes ?? []), [data?.creditNotes]);
  const invoiceRows = useMemo(() => (data?.invoices ?? []).map((invoice) => ({
    invoice,
    balance: computeInvoiceBalance(invoice, creditNotesByInvoiceId.get(invoice.id) ?? [], today),
  })), [creditNotesByInvoiceId, data?.invoices, today]);
  const recentInvoices = useMemo(() => invoiceRows.slice().sort((a, b) => b.invoice.createdAt.localeCompare(a.invoice.createdAt)).slice(0, 5), [invoiceRows]);
  const overdueInvoices = useMemo(() => invoiceRows.filter(({ balance }) => balance.isOverdue).sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate)), [invoiceRows]);
  const dueSoonInvoices = useMemo(() => {
    const dueSoonDate = new Date(`${today}T00:00:00`);
    dueSoonDate.setDate(dueSoonDate.getDate() + 7);
    const dueSoonLimit = dateToLocalISO(dueSoonDate);
    return invoiceRows
      .filter(({ invoice, balance }) => !balance.isFullyPaid && invoice.dueDate >= today && invoice.dueDate <= dueSoonLimit)
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate))
      .slice(0, 5);
  }, [invoiceRows, today]);

  if (!stats) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  const attention = overdueInvoices.length + dueRecurring.length + upcomingReminders.length;

  return (
    <Page>
      <PageHeader
        title={de ? "Auswertung" : t(language, "dashboard.title")}
        description={labels.description}
        actions={(
          <Button
            variant="primary"
            onClick={() => {
              if (!adapter) return;
              const created = createInvoice(adapter);
              window.location.assign(`/invoices/${created.id}`);
            }}
          >
            {t(language, "actions.newInvoice")}
          </Button>
        )}
      />

      <Section title={de ? "Braucht Aufmerksamkeit" : "Needs attention"} summary={attention ? undefined : (de ? "Nichts ist überfällig und keine wiederkehrende Rechnung ist fällig." : "Nothing is overdue and no recurring invoice is due.")}>
        {dueRecurring.length > 0 && (
          <StatusNote tone="attention" title={`${dueRecurring.length} ${t(language, "recurring.dueToday")}`}>
            <ul className="flex flex-col gap-0.5">
              {dueRecurring.map((ri) => (
                <li key={ri.id}><Link href={`/recurring/${ri.id}`} className="underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{ri.name || labels.unnamedRecurring}</Link></li>
              ))}
            </ul>
          </StatusNote>
        )}
        {overdueInvoices.length > 0 && (
          <Card>
            <CardZone padding="sm" className="flex items-center justify-between gap-3 bg-surface-rail">
              <span className="font-sans text-lg font-semibold tracking-snug text-ink">{t(language, "filters.overdue")} ({overdueInvoices.length})</span>
              <span className="font-sans text-base tracking-snug text-ink-muted tabular-nums">{formatMoney(stats.overdueTotal, currency, locale)}</span>
            </CardZone>
            <ul>
              {overdueInvoices.slice(0, 5).map(({ invoice: inv, balance }) => (
                <LedgerRow
                  key={inv.id}
                  href={`/invoices/${inv.id}`}
                  tone="danger"
                  title={inv.invoiceNumber || labels.noNumber}
                  sub={inv.recipient.name || labels.unnamedCustomer}
                  value={formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)}
                  valueSub={labels.daysOverdue(daysBetweenDateOnly(inv.dueDate, todayLocalISO()))}
                />
              ))}
            </ul>
          </Card>
        )}
        {upcomingReminders.length > 0 && (
          <Card>
            <CardZone padding="sm" className="bg-surface-rail font-sans text-lg font-semibold tracking-snug text-ink">{t(language, "dashboard.upcomingReminders")}</CardZone>
            <ul>
              {upcomingReminders.map((ri) => (
                <LedgerRow key={ri.id} href={`/recurring/${ri.id}`} tone="info" title={ri.name || labels.unnamedRecurring} sub={ri.recipient.name || labels.unnamedCustomer} value={<StatusPill tone="info">{labels.next}: {formatDateOnly(ri.nextRunDate, locale)}</StatusPill>} />
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title={de ? "Kennzahlen" : "Key figures"}>
        <KeyFigures
          items={[
            { label: t(language, "dashboard.unpaidTotal"), value: formatMoney(stats.unpaidTotal, currency, locale), href: "/invoices" },
            { label: t(language, "dashboard.overdueCount"), value: String(stats.overdueCount), hint: formatMoney(stats.overdueTotal, currency, locale), tone: stats.overdueCount > 0 ? "error" : "neutral" },
            { label: t(language, "dashboard.invoiceCount"), value: String(stats.invoiceCount), href: "/invoices" },
            { label: t(language, "dashboard.customerCount"), value: String(stats.customerCount), href: "/customers" },
          ]}
        />
        <KeyFigures
          items={[
            { label: labels.collectedThisMonth, value: formatMoney(stats.paidThisPeriod, currency, locale), tone: stats.paidThisPeriod > 0 ? "ok" : "neutral" },
            { label: labels.issuedThisMonth, value: formatMoney(stats.issuedThisMonthTotal, currency, locale), hint: labels.invoicesSuffix(stats.issuedThisMonthCount) },
            { label: labels.dueNextSevenDays, value: formatMoney(stats.dueSoonTotal, currency, locale), hint: labels.invoicesSuffix(stats.dueSoonCount), tone: stats.dueSoonCount > 0 ? "attention" : "neutral" },
            { label: labels.collectionRate, value: `${stats.collectionRate} %`, hint: labels.paidOfBilled, tone: stats.collectionRate >= 80 ? "ok" : stats.collectionRate >= 50 ? "attention" : "neutral" },
          ]}
        />
        <KeyFigures
          items={[
            { label: labels.avgDaysToPay, value: stats.averageDaysToPay === null ? "–" : String(stats.averageDaysToPay), hint: stats.averageDaysToPay === null ? labels.noPaidInvoices : undefined },
            { label: t(language, "dashboard.overdueTotal"), value: formatMoney(stats.overdueTotal, currency, locale), hint: labels.invoicesSuffix(stats.overdueCount), tone: stats.overdueCount > 0 ? "error" : "neutral" },
          ]}
        />
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title={labels.cashFlow}>
          {stats.revenueByMonth.length > 0
            ? <Card><CardZone><RevenueChart data={stats.revenueByMonth} locale={locale} currency={currency} /></CardZone></Card>
            : <EmptyState title={labels.noRevenue} description={labels.noRevenueDescription} />}
        </Section>
        <Section title={t(language, "dashboard.recentInvoices")} link={{ href: "/invoices", label: labels.viewAll }}>
          {recentInvoices.length > 0 ? (
            <Card>
              <ul>
                {recentInvoices.map(({ invoice: inv, balance }) => (
                  <LedgerRow
                    key={inv.id}
                    href={`/invoices/${inv.id}`}
                    title={inv.invoiceNumber || labels.noNumber}
                    sub={inv.recipient.name || labels.unnamedCustomer}
                    value={formatMoney(balance.effectiveTotal, inv.currency ?? currency, locale)}
                    valueSub={balance.isPartiallyPaid ? `${formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)} ${labels.remaining}` : undefined}
                  />
                ))}
              </ul>
            </Card>
          ) : <EmptyState title={t(language, "invoices.empty")} description={labels.noInvoicesDescription} />}
        </Section>
        <Section title={labels.receivablesAging}>
          <Card><CardZone><AgingBars buckets={stats.agingBuckets} locale={locale} currency={currency} labels={labels} /></CardZone></Card>
        </Section>
        <Section title={labels.paymentMix} summary={labels.invoicesSuffix(Object.values(stats.statusCounts).reduce((sum, count) => sum + count, 0))}>
          <Card><CardZone><StatusMix counts={stats.statusCounts} labels={labels} /></CardZone></Card>
        </Section>
        <Section title={labels.dueSoon}>
          {dueSoonInvoices.length > 0 ? (
            <Card>
              <ul>
                {dueSoonInvoices.map(({ invoice: inv, balance }) => (
                  <LedgerRow key={inv.id} href={`/invoices/${inv.id}`} tone="progress" title={inv.invoiceNumber || labels.noNumber} sub={inv.recipient.name || labels.unnamedCustomer} value={formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)} valueSub={formatDateOnly(inv.dueDate, locale)} />
                ))}
              </ul>
            </Card>
          ) : <EmptyState title={labels.noDueSoon} description={labels.noDueSoonDescription} />}
        </Section>
        <Section title={labels.topCustomers}>
          {stats.topCustomers.length > 0 ? (
            <Card>
              {stats.topCustomers.map((customer) => (
                <CardZone key={customer.key} padding="sm" className="flex items-center justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-sans text-lg font-semibold tracking-snug text-ink">{customer.name}</span>
                    <span className="block font-sans text-base tracking-snug text-ink-muted">{labels.invoicesSuffix(customer.invoiceCount)}</span>
                  </span>
                  <span className="shrink-0 text-right font-sans tracking-snug tabular-nums">
                    <span className="block text-lg font-semibold text-ink">{formatMoney(customer.totalBilled, currency, locale)}</span>
                    {customer.outstanding > 0 && <span className="block text-base text-warn-ink">{formatMoney(customer.outstanding, currency, locale)} {labels.outstanding}</span>}
                  </span>
                </CardZone>
              ))}
            </Card>
          ) : <EmptyState title={t(language, "customers.empty")} description={labels.noInvoicesDescription} />}
        </Section>
      </div>
    </Page>
  );
}
