"use client";

import Link from "next/link";
import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { createInvoice, getDashboardStats, getUpcomingReminders, getDueRecurringInvoices } from "@/lib/storage/store";
import { computeInvoiceBalance } from "@/lib/calc";
import { dateToLocalISO, daysBetweenDateOnly, formatDateOnly, formatMonthKey, todayLocalISO } from "@/lib/date";
import { Surface, PageHeader, Grid, Section, Stack } from "@/components/ui/Surface";
import { Stat, Badge, Alert, EmptyState } from "@/components/ui/DataDisplay";
import { Button } from "@/components/ui/Button";
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

function RevenueChart({ data, locale, currency }: { 
  data: { month: string; revenue: number }[]; 
  locale: string;
  currency: string;
}) {
  const maxRevenue = Math.max(...data.map(d => Math.abs(d.revenue)), 1);
  
  return (
    <div className="space-y-3">
      {data.map(({ month, revenue }) => (
        <div key={month} className="flex items-center gap-3">
          <div className="w-16 text-xs text-[var(--color-ink-subtle)]">
            {formatMonthKey(month, locale)}
          </div>
          <div className="flex-1 h-7 bg-[var(--color-sand-100)] rounded-lg overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent)]/70 rounded-lg transition-all duration-500"
              style={{ width: `${(Math.abs(revenue) / maxRevenue) * 100}%`, minWidth: revenue !== 0 ? "4px" : "0" }}
            />
          </div>
          <div className="w-24 text-right text-xs font-medium text-[var(--color-ink-muted)]">
            {formatMoney(revenue, currency, locale)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgingBars({
  buckets,
  locale,
  currency,
  labels,
}: {
  buckets: NonNullable<ReturnType<typeof getDashboardStats>>["agingBuckets"];
  locale: string;
  currency: string;
  labels: (typeof dashboardLabels)[Language];
}) {
  const maxTotal = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const bucketLabels: Record<(typeof buckets)[number]["bucket"], string> = {
    current: labels.current,
    "1-30": "1-30",
    "31-60": "31-60",
    "61+": "61+",
  };

  return (
    <div className="space-y-3">
      {buckets.map((bucket) => (
        <div key={bucket.bucket} className="grid grid-cols-[5.5rem_1fr_6rem] items-center gap-3">
          <div className="text-xs font-medium text-[var(--color-ink-muted)]">{bucketLabels[bucket.bucket]}</div>
          <div className="h-7 overflow-hidden rounded-lg bg-[var(--color-sand-100)]">
            <div
              className={`h-full rounded-lg ${
                bucket.bucket === "current"
                  ? "bg-[var(--color-accent)]/70"
                  : bucket.bucket === "1-30"
                    ? "bg-[var(--color-warning)]/70"
                    : "bg-[var(--color-danger)]/75"
              }`}
              style={{ width: `${(bucket.total / maxTotal) * 100}%`, minWidth: bucket.total > 0 ? "4px" : "0" }}
            />
          </div>
          <div className="text-right text-xs">
            <div className="font-medium text-[var(--color-ink)]">{formatMoney(bucket.total, currency, locale)}</div>
            <div className="text-[var(--color-ink-subtle)]">{labels.invoicesSuffix(bucket.count)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusMix({
  counts,
  labels,
}: {
  counts: NonNullable<ReturnType<typeof getDashboardStats>>["statusCounts"];
  labels: (typeof dashboardLabels)[Language];
}) {
  const total = Math.max(Object.values(counts).reduce((sum, count) => sum + count, 0), 1);
  const items = [
    { key: "paid" as const, label: labels.paid, value: counts.paid, className: "bg-[var(--color-success)]" },
    { key: "partial" as const, label: labels.partial, value: counts.partial, className: "bg-[var(--color-warning)]" },
    { key: "overdue" as const, label: labels.overdue, value: counts.overdue, className: "bg-[var(--color-danger)]" },
    { key: "unpaid" as const, label: labels.unpaid, value: counts.unpaid, className: "bg-[var(--color-accent)]" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--color-sand-100)]">
        {items.map((item) => (
          <div
            key={item.key}
            className={item.className}
            style={{ width: `${(item.value / total) * 100}%` }}
            title={`${item.label}: ${item.value}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-sand-50)] px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <span className={`h-2 w-2 rounded-full ${item.className}`} />
              {item.label}
            </span>
            <span className="text-xs font-semibold text-[var(--color-ink)]">{item.value}</span>
          </div>
        ))}
      </div>
      <div className="text-xs text-[var(--color-ink-subtle)]">{labels.invoicesSuffix(total)}</div>
    </div>
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

export default function DashboardPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
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

  const creditNotesByInvoiceId = useMemo(() => {
    return buildCreditNoteMap(data?.creditNotes ?? []);
  }, [data?.creditNotes]);

  const invoiceRows = useMemo(() => {
    return (data?.invoices ?? []).map((invoice) => ({
      invoice,
      balance: computeInvoiceBalance(invoice, creditNotesByInvoiceId.get(invoice.id) ?? [], today),
    }));
  }, [creditNotesByInvoiceId, data?.invoices, today]);

  const recentInvoices = useMemo(() => {
    return invoiceRows
      .slice()
      .sort((a, b) => b.invoice.createdAt.localeCompare(a.invoice.createdAt))
      .slice(0, 5);
  }, [invoiceRows]);

  const overdueInvoices = useMemo(() => {
    return invoiceRows
      .filter(({ balance }) => balance.isOverdue)
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
  }, [invoiceRows]);

  const dueSoonInvoices = useMemo(() => {
    const dueSoonDate = new Date(`${today}T00:00:00`);
    dueSoonDate.setDate(dueSoonDate.getDate() + 7);
    const dueSoonLimit = dateToLocalISO(dueSoonDate);

    return invoiceRows
      .filter(({ invoice, balance }) => !balance.isFullyPaid && invoice.dueDate >= today && invoice.dueDate <= dueSoonLimit)
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate))
      .slice(0, 5);
  }, [invoiceRows, today]);

  if (!stats) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <div className="text-sm text-[var(--color-ink-subtle)]">{t(language, "common.loading")}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "dashboard.title")}
            description={labels.description}
            actions={
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
            }
          />

          {/* Alert for due recurring invoices */}
          {dueRecurring.length > 0 && (
            <Alert variant="warning" title={`${dueRecurring.length} ${t(language, "recurring.dueToday")}`}>
              <div className="mt-2 space-y-1">
                {dueRecurring.map((ri) => (
                  <Link 
                    key={ri.id} 
                    href={`/recurring/${ri.id}`}
                    className="block text-sm hover:underline"
                  >
                    {ri.name || labels.unnamedRecurring}
                  </Link>
                ))}
              </div>
            </Alert>
          )}

          {/* Stats Grid */}
          <Grid cols={4} gap="md">
            <Stat
              label={t(language, "dashboard.unpaidTotal")}
              value={formatMoney(stats.unpaidTotal, currency, locale)}
            />
            <Stat
              label={t(language, "dashboard.overdueCount")}
              value={String(stats.overdueCount)}
              subtitle={formatMoney(stats.overdueTotal, currency, locale)}
              variant={stats.overdueCount > 0 ? "warning" : "default"}
            />
            <Stat
              label={t(language, "dashboard.invoiceCount")}
              value={String(stats.invoiceCount)}
            />
            <Stat
              label={t(language, "dashboard.customerCount")}
              value={String(stats.customerCount)}
            />
          </Grid>

          <Grid cols={4} gap="md">
            <Stat
              label={labels.collectedThisMonth}
              value={formatMoney(stats.paidThisPeriod, currency, locale)}
              variant={stats.paidThisPeriod > 0 ? "success" : "default"}
            />
            <Stat
              label={labels.issuedThisMonth}
              value={formatMoney(stats.issuedThisMonthTotal, currency, locale)}
              subtitle={labels.invoicesSuffix(stats.issuedThisMonthCount)}
            />
            <Stat
              label={labels.dueNextSevenDays}
              value={formatMoney(stats.dueSoonTotal, currency, locale)}
              subtitle={labels.invoicesSuffix(stats.dueSoonCount)}
              variant={stats.dueSoonCount > 0 ? "warning" : "default"}
            />
            <Stat
              label={labels.collectionRate}
              value={`${stats.collectionRate}%`}
              subtitle={labels.paidOfBilled}
              variant={stats.collectionRate >= 80 ? "success" : stats.collectionRate >= 50 ? "warning" : "default"}
            />
          </Grid>

          <Grid cols={2} gap="lg">
            {/* Revenue Chart */}
            <Section title={labels.cashFlow}>
              <Surface variant="solid" padding="lg">
                {stats.revenueByMonth.length > 0 ? (
                  <RevenueChart data={stats.revenueByMonth} locale={locale} currency={currency} />
                ) : (
                  <EmptyState
                    title={labels.noRevenue}
                    description={labels.noRevenueDescription}
                  />
                )}
              </Surface>
            </Section>

            {/* Recent Invoices */}
            <Section
              title={t(language, "dashboard.recentInvoices")}
              action={
                <Link href="/invoices" className="text-sm text-[var(--color-accent)] hover:underline">
                  {labels.viewAll}
                </Link>
              }
            >
              <Surface variant="solid" padding="md">
                {recentInvoices.length > 0 ? (
                  <div className="space-y-1">
                    {recentInvoices.map(({ invoice: inv, balance }) => {
                      return (
                        <Link
                          key={inv.id}
                          href={`/invoices/${inv.id}`}
                          className="flex items-center justify-between gap-4 rounded-xl p-3 transition-colors hover:bg-[var(--color-sand-50)]"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-ink)]">
                              {inv.invoiceNumber || labels.noNumber}
                            </div>
                            <div className="truncate text-xs text-[var(--color-ink-subtle)]">{inv.recipient.name || labels.unnamedCustomer}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-[var(--color-ink)]">
                              {formatMoney(balance.effectiveTotal, inv.currency ?? currency, locale)}
                            </div>
                            {balance.isPartiallyPaid && (
                              <div className="text-xs text-[var(--color-warning)]">
                                {formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)} {labels.remaining}
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    title={t(language, "invoices.empty")}
                    description={labels.noInvoicesDescription}
                  />
                )}
              </Surface>
            </Section>
          </Grid>

          <Grid cols={3} gap="lg">
            <Section title={labels.receivablesAging} className="lg:col-span-2">
              <Surface variant="solid" padding="lg">
                <AgingBars buckets={stats.agingBuckets} locale={locale} currency={currency} labels={labels} />
              </Surface>
            </Section>

            <Section title={labels.paymentMix}>
              <Surface variant="solid" padding="lg">
                <StatusMix counts={stats.statusCounts} labels={labels} />
              </Surface>
            </Section>
          </Grid>

          <Grid cols={2} gap="lg">
            <Section title={labels.dueSoon}>
              <Surface variant="solid" padding="md">
                {dueSoonInvoices.length > 0 ? (
                  <div className="space-y-2">
                    {dueSoonInvoices.map(({ invoice: inv, balance }) => (
                      <Link
                        key={inv.id}
                        href={`/invoices/${inv.id}`}
                        className="flex items-center justify-between gap-4 rounded-xl p-3 transition-colors hover:bg-[var(--color-sand-50)]"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--color-ink)]">{inv.invoiceNumber || labels.noNumber}</div>
                          <div className="truncate text-xs text-[var(--color-ink-subtle)]">{inv.recipient.name || labels.unnamedCustomer}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-[var(--color-warning)]">
                            {formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)}
                          </div>
                          <div className="text-xs text-[var(--color-ink-subtle)]">{formatDateOnly(inv.dueDate, locale)}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={labels.noDueSoon} description={labels.noDueSoonDescription} />
                )}
              </Surface>
            </Section>

            <Section title={labels.topCustomers}>
              <Surface variant="solid" padding="md">
                {stats.topCustomers.length > 0 ? (
                  <div className="space-y-2">
                    {stats.topCustomers.map((customer) => (
                      <div key={customer.key} className="rounded-xl p-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-[var(--color-ink)]">{customer.name}</div>
                            <div className="text-xs text-[var(--color-ink-subtle)]">{labels.invoicesSuffix(customer.invoiceCount)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-[var(--color-ink)]">
                              {formatMoney(customer.totalBilled, currency, locale)}
                            </div>
                            {customer.outstanding > 0 && (
                              <div className="text-xs text-[var(--color-warning)]">
                                {formatMoney(customer.outstanding, currency, locale)} {labels.outstanding}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={t(language, "customers.empty")} description={labels.noInvoicesDescription} />
                )}
              </Surface>
            </Section>
          </Grid>

          <Grid cols={2} gap="lg">
            <Stat
              label={labels.avgDaysToPay}
              value={stats.averageDaysToPay === null ? "-" : String(stats.averageDaysToPay)}
              subtitle={stats.averageDaysToPay === null ? labels.noPaidInvoices : undefined}
            />
            <Stat
              label={t(language, "dashboard.overdueTotal")}
              value={formatMoney(stats.overdueTotal, currency, locale)}
              subtitle={labels.invoicesSuffix(stats.overdueCount)}
              variant={stats.overdueCount > 0 ? "danger" : "default"}
            />
          </Grid>

          {/* Overdue Invoices */}
          {overdueInvoices.length > 0 && (
            <Section title={`${t(language, "filters.overdue")} (${overdueInvoices.length})`}>
              <Surface variant="glass" padding="md" className="border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
                <div className="space-y-2">
                  {overdueInvoices.slice(0, 5).map(({ invoice: inv, balance }) => {
                    const daysOverdue = daysBetweenDateOnly(inv.dueDate, todayLocalISO());
                    return (
                      <Link
                        key={inv.id}
                        href={`/invoices/${inv.id}`}
                        className="flex items-center justify-between gap-4 rounded-xl bg-white/80 p-3 transition-colors hover:bg-white"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--color-ink)]">{inv.invoiceNumber || labels.noNumber}</div>
                          <div className="truncate text-xs text-[var(--color-ink-subtle)]">{inv.recipient.name || labels.unnamedCustomer}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-[var(--color-danger)]">
                            {formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)}
                          </div>
                          <div className="text-xs text-[var(--color-danger)]/70">{labels.daysOverdue(daysOverdue)}</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </Surface>
            </Section>
          )}

          {/* Upcoming Reminders */}
          {upcomingReminders.length > 0 && (
            <Section title={t(language, "dashboard.upcomingReminders")}>
              <Surface variant="glass" padding="md" className="border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5">
                <div className="space-y-2">
                  {upcomingReminders.map((ri) => (
                    <Link
                      key={ri.id}
                      href={`/recurring/${ri.id}`}
                      className="flex items-center justify-between rounded-xl bg-white/80 p-3 hover:bg-white transition-colors"
                    >
                      <div className="text-sm font-medium text-[var(--color-ink)]">{ri.name}</div>
                      <Badge variant="info">
                        {labels.next}: {formatDateOnly(ri.nextRunDate, locale)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </Surface>
            </Section>
          )}
        </Stack>
      </div>
    </main>
  );
}
