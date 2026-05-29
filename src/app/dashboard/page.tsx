"use client";

import Link from "next/link";
import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { getDashboardStats, getUpcomingReminders, getDueRecurringInvoices } from "@/lib/storage/store";
import { computeInvoiceBalance } from "@/lib/calc";
import { daysBetweenDateOnly, formatDateOnly, formatMonthKey, todayLocalISO } from "@/lib/date";
import { Surface, PageHeader, Grid, Section, Stack } from "@/components/ui/Surface";
import { Stat, Badge, Alert, EmptyState } from "@/components/ui/DataDisplay";
import { Button } from "@/components/ui/Button";

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

export default function DashboardPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";

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

  const recentInvoices = useMemo(() => {
    return (data?.invoices ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
  }, [data?.invoices]);

  const overdueInvoices = useMemo(() => {
    const today = todayLocalISO();
    return (data?.invoices ?? []).filter((inv) => {
      const balance = computeInvoiceBalance(
        inv,
        (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === inv.id),
        today
      );
      return balance.isOverdue;
    });
  }, [data?.creditNotes, data?.invoices]);

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
            description="Overview of your invoicing activity"
            actions={
              <Button variant="primary" onClick={() => window.location.assign("/invoices")}>
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
                    {ri.name || "Unnamed recurring invoice"}
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

          <Grid cols={2} gap="lg">
            {/* Revenue Chart */}
            <Section title={t(language, "dashboard.revenueByMonth")}>
              <Surface variant="solid" padding="lg">
                {stats.revenueByMonth.length > 0 ? (
                  <RevenueChart data={stats.revenueByMonth} locale={locale} currency={currency} />
                ) : (
                  <EmptyState
                    title={t(language, "common.noResults")}
                    description="Revenue data will appear here once you create invoices"
                  />
                )}
              </Surface>
            </Section>

            {/* Recent Invoices */}
            <Section
              title={t(language, "dashboard.recentInvoices")}
              action={
                <Link href="/invoices" className="text-sm text-[var(--color-accent)] hover:underline">
                  View all →
                </Link>
              }
            >
              <Surface variant="solid" padding="md">
                {recentInvoices.length > 0 ? (
                  <div className="space-y-1">
                    {recentInvoices.map((inv) => {
                      const balance = computeInvoiceBalance(
                        inv,
                        (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === inv.id)
                      );
                      return (
                        <Link
                          key={inv.id}
                          href={`/invoices/${inv.id}`}
                          className="flex items-center justify-between rounded-xl p-3 hover:bg-[var(--color-sand-50)] transition-colors"
                        >
                          <div>
                            <div className="text-sm font-medium text-[var(--color-ink)]">
                              {inv.invoiceNumber || "(no number)"}
                            </div>
                            <div className="text-xs text-[var(--color-ink-subtle)]">{inv.recipient.name}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-[var(--color-ink)]">
                              {formatMoney(balance.effectiveTotal, inv.currency ?? currency, locale)}
                            </div>
                            {balance.isPartiallyPaid && (
                              <div className="text-xs text-[var(--color-warning)]">
                                {formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)} remaining
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
                    description="Create your first invoice to get started"
                  />
                )}
              </Surface>
            </Section>
          </Grid>

          {/* Overdue Invoices */}
          {overdueInvoices.length > 0 && (
            <Section title={`${t(language, "filters.overdue")} (${overdueInvoices.length})`}>
              <Surface variant="glass" padding="md" className="border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
                <div className="space-y-2">
                  {overdueInvoices.slice(0, 5).map((inv) => {
                    const balance = computeInvoiceBalance(
                      inv,
                      (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === inv.id)
                    );
                    const daysOverdue = daysBetweenDateOnly(inv.dueDate, todayLocalISO());
                    return (
                      <Link
                        key={inv.id}
                        href={`/invoices/${inv.id}`}
                        className="flex items-center justify-between rounded-xl bg-white/80 p-3 hover:bg-white transition-colors"
                      >
                        <div>
                          <div className="text-sm font-medium text-[var(--color-ink)]">{inv.invoiceNumber}</div>
                          <div className="text-xs text-[var(--color-ink-subtle)]">{inv.recipient.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-[var(--color-danger)]">
                            {formatMoney(balance.remainingAmount, inv.currency ?? currency, locale)}
                          </div>
                          <div className="text-xs text-[var(--color-danger)]/70">{daysOverdue} days overdue</div>
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
                        Next: {formatDateOnly(ri.nextRunDate, locale)}
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
