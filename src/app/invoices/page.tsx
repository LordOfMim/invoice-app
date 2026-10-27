"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
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

const statusStyles = {
  draft: "border-zinc-300 bg-zinc-50 text-zinc-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-200 bg-amber-50 text-amber-900",
  overdue: "border-red-200 bg-red-50 text-red-800",
  open: "border-zinc-200 bg-white text-zinc-700",
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatDate(iso: string, locale: string) {
  const date = new Date(`${iso}T00:00:00`);
  if (!iso || Number.isNaN(date.getTime())) return iso;
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

export default function InvoicesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data?.invoices ?? [];
    const creditNotes = data?.creditNotes ?? [];
    const creditNotesByInvoiceId = new Map<string, typeof creditNotes>();

    for (const creditNote of creditNotes) {
      const linked = creditNotesByInvoiceId.get(creditNote.linkedInvoiceId);
      if (linked) linked.push(creditNote);
      else creditNotesByInvoiceId.set(creditNote.linkedInvoiceId, [creditNote]);
    }

    return all.map((invoice) => {
      const dateLabel = formatDate(invoice.invoiceDate, locale);
      return {
        invoice,
        dateLabel,
        searchText: `${invoice.invoiceNumber} ${invoice.recipient.name} ${invoice.invoiceDate} ${dateLabel}`.toLocaleLowerCase(locale),
        balance: computeInvoiceBalance(invoice, creditNotesByInvoiceId.get(invoice.id) ?? []),
      };
    });
  }, [data?.invoices, data?.creditNotes, locale]);

  const invoices = useMemo(() => {
    const filtered =
      filterKey === "all"
        ? rows
        : rows.filter(({ balance }) => (filterKey === "paid" ? balance.isFullyPaid : !balance.isFullyPaid));

    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase(locale);
    const searched = filtered.filter(({ searchText }) => !normalizedQuery || searchText.includes(normalizedQuery));

    const sorted = searched.sort((a, b) => {
      if (sortKey === "number") {
        return (a.invoice.invoiceNumber || "").localeCompare(b.invoice.invoiceNumber || "");
      }
      if (sortKey === "total") return b.balance.effectiveTotal - a.balance.effectiveTotal;
      return (b.invoice.invoiceDate || "").localeCompare(a.invoice.invoiceDate || "");
    });

    return sorted;
  }, [rows, filterKey, sortKey, deferredQuery, locale]);

  const pageCount = Math.max(1, Math.ceil(invoices.length / 50));
  const currentPage = Math.min(page, pageCount);
  const visibleInvoices = invoices.slice((currentPage - 1) * 50, currentPage * 50);

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
            <div className="min-w-56 flex-1"><Field label={language === "de" ? "Rechnung suchen" : "Search invoices"}><Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={language === "de" ? "Nummer, Kunde oder Datum" : "Number, customer or date"} /></Field></div>
            <div className="w-48"><Field label={language === "de" ? "Sortieren nach" : "Sort by"}>
              <Select value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(1); }}>
                <option value="date">{t(language, "sort.date")}</option>
                <option value="number">{t(language, "sort.number")}</option>
                <option value="total">{t(language, "sort.total")}</option>
              </Select></Field>
            </div>

            <div className="w-48">
              <Field label={language === "de" ? "Zahlungsstatus" : "Payment status"}><Select value={filterKey} onChange={(e) => { setFilterKey(e.target.value as FilterKey); setPage(1); }}>
                <option value="all">{t(language, "filters.all")}</option>
                <option value="paid">{t(language, "filters.paid")}</option>
                <option value="unpaid">{t(language, "filters.unpaid")}</option>
              </Select></Field>
            </div>
            {(query || filterKey !== "all") && <Button onClick={() => { setQuery(""); setFilterKey("all"); setPage(1); }}>{language === "de" ? "Filter zurücksetzen" : "Reset filters"}</Button>}
          </div>

          <p className="text-sm text-(--color-ink-subtle)" role="status">
            {invoices.length} {language === "de" ? (invoices.length === 1 ? "Rechnung angezeigt" : "Rechnungen angezeigt") : (invoices.length === 1 ? "invoice shown" : "invoices shown")}
          </p>
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

            {visibleInvoices.map(({ invoice: inv, balance, dateLabel }) => {
              const isDefault = (data?.settings.defaultInvoiceId ?? null) === inv.id;
              // A blank, unnumbered invoice has nothing to pay yet; show it as a draft
              // instead of the technically "fully paid" zero balance.
              const isDraft = !inv.invoiceNumber && balance.invoiceTotal === 0;
              const status: keyof typeof statusStyles = isDraft ? "draft"
                : balance.isFullyPaid ? "paid"
                : balance.isPartiallyPaid ? "partial"
                : balance.isOverdue ? "overdue"
                : "open";
              const statusLabel = {
                draft: language === "de" ? "Entwurf" : "Draft",
                paid: t(language, "invoice.paid"),
                partial: t(language, "invoice.partiallyPaid"),
                overdue: t(language, "invoice.overdue"),
                open: t(language, "invoices.unpaid"),
              }[status];
              const title = inv.invoiceNumber || (language === "de" ? "Ohne Rechnungsnummer" : "No invoice number");

              return (
                <Surface
                  key={inv.id}
                  variant="solid"
                  padding="md"
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"
                >
                  <div className="min-w-60 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="text-lg font-semibold text-(--color-ink) underline-offset-4 hover:text-(--color-accent) hover:underline"
                      >
                        {title}
                      </Link>
                      <span className={`rounded-full border px-2.5 py-0.5 text-sm font-medium ${statusStyles[status]}`}>{statusLabel}</span>
                      {isDefault && <Badge>{t(language, "invoice.default")}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-(--color-ink-muted)">
                      <span>{inv.recipient.name || (language === "de" ? "Kein Empfänger eingetragen" : "No recipient yet")}</span>
                      {inv.invoiceDate && <><span aria-hidden="true">·</span><span>{dateLabel}</span></>}
                    </div>
                  </div>

                  <div className="text-right text-lg font-semibold tabular-nums text-(--color-ink)">
                    {formatMoney(balance.effectiveTotal, inv.currency ?? currency, locale)}
                  </div>

                  <div className="no-print flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    {!isDraft && (
                      <Button
                        size="sm"
                        aria-label={`${balance.isFullyPaid ? t(language, "actions.markUnpaid") : t(language, "actions.markPaid")}: ${title}`}
                        onClick={() => {
                          if (!adapter) return;
                          togglePaid(adapter, inv.id);
                        }}
                      >
                        {balance.isFullyPaid ? t(language, "actions.markUnpaid") : t(language, "actions.markPaid")}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      aria-label={`${t(language, "actions.duplicate")}: ${title}`}
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
                      aria-label={`${t(language, "actions.delete")}: ${title}`}
                      onClick={() => setDeleteConfirm(inv.id)}
                    >
                      {t(language, "actions.delete")}
                    </Button>
                  </div>
                </Surface>
              );
            })}
          </div>
          {pageCount > 1 && <nav aria-label={language === "de" ? "Rechnungsseiten" : "Invoice pages"} className="flex flex-wrap items-center justify-between gap-3">
            <Button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{language === "de" ? "Vorherige Seite" : "Previous page"}</Button>
            <span className="text-base">{language === "de" ? `Seite ${currentPage} von ${pageCount}` : `Page ${currentPage} of ${pageCount}`}</span>
            <Button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{language === "de" ? "Nächste Seite" : "Next page"}</Button>
          </nav>}
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
