"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { t } from "@/lib/i18n";
import { computeInvoiceBalance } from "@/lib/calc";
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

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const invoices = useMemo(() => {
    const all = data?.invoices ?? [];
    const creditNotes = data?.creditNotes ?? [];
    const creditNotesByInvoiceId = new Map<string, typeof creditNotes>();

    for (const creditNote of creditNotes) {
      const linked = creditNotesByInvoiceId.get(creditNote.linkedInvoiceId);
      if (linked) linked.push(creditNote);
      else creditNotesByInvoiceId.set(creditNote.linkedInvoiceId, [creditNote]);
    }

    const rows = all.map((invoice) => ({
      invoice,
      balance: computeInvoiceBalance(invoice, creditNotesByInvoiceId.get(invoice.id) ?? []),
    }));

    const filtered =
      filterKey === "all"
        ? rows
        : rows.filter(({ balance }) => (filterKey === "paid" ? balance.isFullyPaid : !balance.isFullyPaid));

    const searched = filtered.filter(({ invoice }) => `${invoice.invoiceNumber} ${invoice.recipient.name} ${invoice.invoiceDate}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));

    const sorted = searched.sort((a, b) => {
      if (sortKey === "number") {
        return (a.invoice.invoiceNumber || "").localeCompare(b.invoice.invoiceNumber || "");
      }
      if (sortKey === "total") return b.balance.effectiveTotal - a.balance.effectiveTotal;
      return (b.invoice.invoiceDate || "").localeCompare(a.invoice.invoiceDate || "");
    });

    return sorted;
  }, [data?.creditNotes, data?.invoices, filterKey, sortKey, query, locale]);

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "invoices.title")}
            subtitle={t(language, "common.localFirst")}
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

          <div className="no-print flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1"><Field label={language === "de" ? "Rechnung suchen" : "Search invoices"}><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language === "de" ? "Nummer, Kunde oder Datum" : "Number, customer or date"} /></Field></div>
            <div className="w-48"><Field label={language === "de" ? "Sortieren nach" : "Sort by"}>
              <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="date">{t(language, "sort.date")}</option>
                <option value="number">{t(language, "sort.number")}</option>
                <option value="total">{t(language, "sort.total")}</option>
              </Select></Field>
            </div>

            <div className="w-48">
              <Field label={language === "de" ? "Zahlungsstatus" : "Payment status"}><Select value={filterKey} onChange={(e) => setFilterKey(e.target.value as FilterKey)}>
                <option value="all">{t(language, "filters.all")}</option>
                <option value="paid">{t(language, "filters.paid")}</option>
                <option value="unpaid">{t(language, "filters.unpaid")}</option>
              </Select></Field>
            </div>
            {(query || filterKey !== "all") && <Button onClick={() => { setQuery(""); setFilterKey("all"); }}>{language === "de" ? "Filter zurücksetzen" : "Reset filters"}</Button>}
          </div>

          <p className="text-sm text-(--color-ink-subtle)" role="status">{invoices.length} {language === "de" ? "Rechnungen angezeigt" : "invoices shown"}</p>
          <div className="space-y-2">
            {invoices.length === 0 ? (
              <Surface variant="solid" padding="lg">
                <EmptyState
                  title={data?.invoices.length ? (language === "de" ? "Keine passenden Rechnungen" : "No matching invoices") : t(language, "invoices.empty")}
                  description={data?.invoices.length ? (language === "de" ? "Ändern Sie die Suche oder den Zahlungsstatus." : "Change your search or payment status.") : t(language, "common.createFirstInvoice")}
                  icon={
                    <svg className="h-6 w-6 text-[var(--color-ink-subtle)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  }
                  action={
                    <Button
                      variant="secondary"
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

            {invoices.map(({ invoice: inv, balance }) => {
              const isDefault = (data?.settings.defaultInvoiceId ?? null) === inv.id;
              
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
                        className="text-base font-semibold text-[var(--color-ink)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        {inv.invoiceNumber || "(ohne Nummer)"}
                      </Link>
                      {isDefault && <Badge>{t(language, "invoice.default")}</Badge>}
                      {balance.isFullyPaid ? (
                        <Badge variant="success">{t(language, "invoice.paid")}</Badge>
                      ) : balance.isPartiallyPaid ? (
                        <Badge variant="warning">{t(language, "invoice.partiallyPaid")}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-[var(--color-ink-subtle)]">
                      <span>{inv.invoiceDate}</span>
                      <span>·</span>
                      <span className="font-medium text-[var(--color-ink-muted)]">
                        {formatMoney(balance.effectiveTotal, inv.currency ?? currency, locale)}
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
                      {balance.isFullyPaid ? t(language, "actions.markUnpaid") : t(language, "actions.markPaid")}
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
        title={t(language, "invoice.deleteTitle")}
        description={t(language, "invoice.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </main>
  );
}
