"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { DataTable, Pagination, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { EmptyState, Page, PageHeader } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { DashedBadge, StatusPill } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { formatDay, invoiceStatus } from "@/components/invoiceStatus";
import { t } from "@/lib/i18n";
import { computeInvoiceBalance } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { createInvoice, deleteInvoice, duplicateInvoiceById, togglePaid } from "@/lib/storage/store";

type SortKey = "date" | "number" | "total";
type FilterKey = "all" | "paid" | "unpaid" | "overdue";
const PAGE_SIZE = 50;

export default function InvoicesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
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
      const dateLabel = formatDay(invoice.invoiceDate, locale);
      const balance = computeInvoiceBalance(invoice, creditNotesByInvoiceId.get(invoice.id) ?? []);
      return {
        invoice,
        dateLabel,
        dueLabel: formatDay(invoice.dueDate, locale),
        balance,
        status: invoiceStatus(invoice, balance, language),
        searchText: `${invoice.invoiceNumber} ${invoice.recipient.name} ${invoice.invoiceDate} ${dateLabel}`.toLocaleLowerCase(locale),
      };
    });
  }, [data?.invoices, data?.creditNotes, locale, language]);

  type Row = (typeof rows)[number];

  const invoices = useMemo(() => {
    const filtered = rows.filter(({ balance, status }) => {
      if (filterKey === "paid") return status.key === "paid";
      if (filterKey === "unpaid") return !balance.isFullyPaid;
      if (filterKey === "overdue") return balance.isOverdue;
      return true;
    });
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase(locale);
    const searched = filtered.filter(({ searchText }) => !normalizedQuery || searchText.includes(normalizedQuery));
    return searched.sort((a, b) => {
      if (sortKey === "number") return (a.invoice.invoiceNumber || "").localeCompare(b.invoice.invoiceNumber || "");
      if (sortKey === "total") return b.balance.effectiveTotal - a.balance.effectiveTotal;
      return (b.invoice.invoiceDate || "").localeCompare(a.invoice.invoiceDate || "");
    });
  }, [rows, filterKey, sortKey, deferredQuery, locale]);

  const pageCount = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleInvoices = invoices.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersActive = query !== "" || filterKey !== "all";

  const createNew = () => {
    if (!adapter) return;
    const created = createInvoice(adapter);
    window.location.assign(`/invoices/${created.id}`);
  };

  const titleOf = (row: Row) => row.invoice.invoiceNumber || (de ? "Ohne Rechnungsnummer" : "No invoice number");

  const columns: DataTableColumn<Row>[] = [
    {
      key: "number",
      header: de ? "Rechnung" : "Invoice",
      render: (row) => (
        <PrimaryCell
          title={titleOf(row)}
          href={`/invoices/${row.invoice.id}`}
          aside={(data?.settings.defaultInvoiceId ?? null) === row.invoice.id ? <DashedBadge title={de ? "Vorlage für neue Rechnungen" : "Default for new invoices"}>{de ? "Standard" : "Default"}</DashedBadge> : undefined}
        />
      ),
    },
    {
      key: "customer",
      header: de ? "Kunde" : "Customer",
      render: (row) => row.invoice.recipient.name
        ? <span className="text-ink">{row.invoice.recipient.name}</span>
        : <span className="text-ink-muted">{de ? "Noch kein Empfänger" : "No recipient yet"}</span>,
    },
    { key: "date", header: de ? "Datum" : "Date", width: "8.5rem", render: (row) => <span className="tabular-nums">{row.dateLabel}</span> },
    {
      key: "status",
      header: "Status",
      width: "13rem",
      render: (row) => (
        <span className="flex flex-col items-start gap-1 max-md:items-end">
          <StatusPill tone={row.status.tone}>{row.status.label}</StatusPill>
          {(row.status.key === "open" || row.status.key === "overdue" || row.status.key === "partial") && (
            <span className="font-sans text-base tracking-snug text-ink-muted tabular-nums">{de ? "fällig" : "due"} {row.dueLabel}</span>
          )}
        </span>
      ),
    },
    {
      key: "total",
      header: de ? "Betrag" : "Amount",
      numeric: true,
      width: "9rem",
      render: (row) => (
        <span className="flex flex-col items-end">
          <span className="font-semibold text-ink">{formatMoney(row.balance.effectiveTotal, row.invoice.currency ?? currency, locale)}</span>
          {row.balance.isPartiallyPaid && <span className="font-sans text-base text-ink-muted">{formatMoney(row.balance.remainingAmount, row.invoice.currency ?? currency, locale)} {de ? "offen" : "open"}</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: de ? "Aktionen" : "Actions",
      hideHeader: true,
      width: "15rem",
      className: "text-right",
      render: (row) => {
        const title = titleOf(row);
        const isDraft = row.status.key === "draft";
        return (
          <span className="flex items-center justify-end gap-2">
            {isDraft ? (
              <LinkButton size="sm" href={`/invoices/${row.invoice.id}`} aria-label={`${de ? "Weiter bearbeiten" : "Continue editing"}: ${title}`}>{de ? "Weiter bearbeiten" : "Continue editing"}</LinkButton>
            ) : !row.balance.isFullyPaid ? (
              <Button size="sm" aria-label={`${t(language, "actions.markPaid")}: ${title}`} onClick={() => adapter && togglePaid(adapter, row.invoice.id)}>
                {t(language, "actions.markPaid")}
              </Button>
            ) : null}
            <OverflowMenu
              label={`${de ? "Weitere Aktionen für" : "More actions for"} ${title}`}
              items={[
                { kind: "link", label: de ? "Öffnen" : "Open", href: `/invoices/${row.invoice.id}` },
                {
                  label: t(language, "actions.duplicate"),
                  onSelect: () => {
                    if (!adapter) return;
                    const dup = duplicateInvoiceById(adapter, row.invoice.id);
                    if (dup) window.location.assign(`/invoices/${dup.id}`);
                  },
                },
                !isDraft && row.balance.isFullyPaid && { label: t(language, "actions.markUnpaid"), onSelect: () => adapter && togglePaid(adapter, row.invoice.id) },
                { kind: "separator" },
                { label: de ? "Rechnung löschen …" : "Delete invoice …", tone: "danger", onSelect: () => setDeleteConfirm(row.invoice.id) },
              ]}
            />
          </span>
        );
      },
    },
  ];

  const total = data?.invoices.length ?? 0;
  return (
    <Page>
      <PageHeader
        title={t(language, "invoices.title")}
        description={de ? "Hier finden Sie alle Rechnungen. Öffnen Sie eine Rechnung, um sie zu bearbeiten und als PDF zu speichern. Alles bleibt auf diesem Gerät." : "All your invoices. Open one to edit it and save it as PDF. Everything stays on this device."}
        actions={<Button variant="primary" onClick={createNew}>{t(language, "actions.newInvoice")}</Button>}
      />

      {total === 0 && data ? (
        <EmptyState
          title={t(language, "invoices.empty")}
          description={de ? "Legen Sie Ihre erste Rechnung an. Absender und Standardwerte kommen aus den Einstellungen." : "Create your first invoice. Sender and defaults come from the settings."}
          action={<Button onClick={createNew}>{t(language, "actions.newInvoice")}</Button>}
        />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label={de ? "Verzeichnis" : "Directory"}>
          <FilterBar
            label={de ? "Rechnungen filtern" : "Filter invoices"}
            aside={<span>{invoices.length} {de ? (invoices.length === 1 ? "Rechnung" : "Rechnungen") : (invoices.length === 1 ? "invoice" : "invoices")}</span>}
          >
            <FilterControl width="grow">
              <Field label={de ? "Suchen" : "Search"}>
                <SearchInput value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={de ? "Nummer, Kunde oder Datum" : "Number, customer or date"} />
              </Field>
            </FilterControl>
            <FilterControl width="sm">
              <Field label={de ? "Zahlungsstatus" : "Payment status"}>
                <Select value={filterKey} onChange={(e) => { setFilterKey(e.target.value as FilterKey); setPage(1); }}>
                  <option value="all">{t(language, "filters.all")}</option>
                  <option value="unpaid">{de ? "Offen" : "Open"}</option>
                  <option value="overdue">{de ? "Überfällig" : "Overdue"}</option>
                  <option value="paid">{t(language, "filters.paid")}</option>
                </Select>
              </Field>
            </FilterControl>
            <FilterControl width="sm">
              <Field label={de ? "Sortieren nach" : "Sort by"}>
                <Select value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(1); }}>
                  <option value="date">{t(language, "sort.date")}</option>
                  <option value="number">{t(language, "sort.number")}</option>
                  <option value="total">{t(language, "sort.total")}</option>
                </Select>
              </Field>
            </FilterControl>
            {filtersActive && <Button variant="quiet" onClick={() => { setQuery(""); setFilterKey("all"); setPage(1); }}>{de ? "Zurücksetzen" : "Reset"}</Button>}
          </FilterBar>

          <DataTable
            caption={de ? "Rechnungen" : "Invoices"}
            columns={columns}
            rows={visibleInvoices}
            rowKey={(row) => row.invoice.id}
            empty={de ? "Keine passende Rechnung. Ändern Sie die Suche oder den Zahlungsstatus." : "No matching invoice. Change the search or payment status."}
          />

          <Pagination
            total={invoices.length}
            page={currentPage}
            pageSize={PAGE_SIZE}
            unit={invoices.length === 1 ? (de ? "Rechnung" : "invoice") : (de ? "Rechnungen" : "invoices")}
            onPageChange={setPage}
            labels={{ nav: de ? "Rechnungsseiten" : "Invoice pages", page: (p, pages) => (de ? `Seite ${p} von ${pages}` : `Page ${p} of ${pages}`), previous: de ? "Zurück" : "Previous", next: de ? "Weiter" : "Next" }}
          />
        </section>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (adapter && deleteConfirm) deleteInvoice(adapter, deleteConfirm); }}
        title={t(language, "invoice.deleteTitle")}
        description={t(language, "invoice.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
