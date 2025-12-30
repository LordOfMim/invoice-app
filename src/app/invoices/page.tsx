"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { t } from "@/lib/i18n";
import { computeInvoiceTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import {
  createInvoice,
  deleteInvoice,
  duplicateInvoiceById,
  togglePaid,
} from "@/lib/storage/store";
import { Surface, PageHeader, Stack } from "@/components/ui/Surface";
import { Badge, EmptyState } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";

type SortKey = "date" | "number" | "total";
type FilterKey = "all" | "paid" | "unpaid";

export default function InvoicesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const invoices = useMemo(() => {
    const all = data?.invoices ?? [];

    const filtered =
      filterKey === "all"
        ? all
        : all.filter((inv) => (filterKey === "paid" ? inv.paid : !inv.paid));

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "number") return (a.invoiceNumber || "").localeCompare(b.invoiceNumber || "");
      if (sortKey === "total") return computeInvoiceTotals(b).total - computeInvoiceTotals(a).total;
      return (b.invoiceDate || "").localeCompare(a.invoiceDate || "");
    });

    return sorted;
  }, [data?.invoices, filterKey, sortKey]);

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "invoices.title")}
            subtitle="Local-first. Offline-ready."
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

          <div className="no-print flex flex-wrap gap-3">
            <div className="w-48">
              <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="date">{t(language, "sort.date")}</option>
                <option value="number">{t(language, "sort.number")}</option>
                <option value="total">{t(language, "sort.total")}</option>
              </Select>
            </div>

            <div className="w-48">
              <Select value={filterKey} onChange={(e) => setFilterKey(e.target.value as FilterKey)}>
                <option value="all">All</option>
                <option value="paid">{t(language, "filters.paid")}</option>
                <option value="unpaid">{t(language, "filters.unpaid")}</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            {invoices.length === 0 ? (
              <Surface variant="solid" padding="lg">
                <EmptyState
                  title={t(language, "invoices.empty")}
                  description="Create your first invoice to get started"
                  icon={
                    <svg className="h-6 w-6 text-[var(--color-ink-subtle)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  }
                  action={
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
              </Surface>
            ) : null}

            {invoices.map((inv) => {
              const totals = computeInvoiceTotals(inv);
              const isDefault = (data?.settings.defaultInvoiceId ?? null) === inv.id;
              const paidAmount = inv.payments.reduce((sum, p) => sum + p.amount, 0);
              const isPartiallyPaid = paidAmount > 0 && paidAmount < totals.total;
              
              return (
                <Surface
                  key={inv.id}
                  variant="solid"
                  padding="md"
                  className="flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="min-w-60">
                    <div className="flex items-center gap-2">
                      <Link 
                        href={`/invoices/${inv.id}`} 
                        className="text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        {inv.invoiceNumber || "(ohne Nummer)"}
                      </Link>
                      {isDefault && <Badge>Default</Badge>}
                      {inv.paid ? (
                        <Badge variant="success">{t(language, "invoice.paid")}</Badge>
                      ) : isPartiallyPaid ? (
                        <Badge variant="warning">Partial</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-ink-subtle)]">
                      <span>{inv.invoiceDate}</span>
                      <span>·</span>
                      <span className="font-medium text-[var(--color-ink-muted)]">
                        {formatMoney(totals.total, currency, locale)}
                      </span>
                      {inv.recipient.name && (
                        <>
                          <span>·</span>
                          <span>{inv.recipient.name}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="no-print flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!adapter) return;
                        togglePaid(adapter, inv.id);
                      }}
                    >
                      {inv.paid ? t(language, "actions.markUnpaid") : t(language, "actions.markPaid")}
                    </Button>

                    <Button
                      size="sm"
                      onClick={() => {
                        if (!adapter) return;
                        const dup = duplicateInvoiceById(adapter, inv.id);
                        if (dup) window.location.assign(`/invoices/${dup.id}`);
                      }}
                    >
                      {t(language, "actions.duplicate")}
                    </Button>

                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setDeleteConfirm(inv.id)}
                    >
                      {t(language, "actions.delete")}
                    </Button>
                  </div>
                </Surface>
              );
            })}
          </div>
        </Stack>
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (adapter && deleteConfirm) {
            deleteInvoice(adapter, deleteConfirm);
          }
        }}
        title="Delete Invoice"
        description="Are you sure you want to delete this invoice?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </main>
  );
}
