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
import { StatusPill } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { formatDay, quoteStatus } from "@/components/invoiceStatus";
import { computeInvoiceTotals } from "@/lib/calc";
import { todayLocalISO } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { convertQuoteToInvoice, createQuote, deleteQuote, duplicateQuoteById } from "@/lib/storage/store";

type FilterKey = "all" | "open" | "accepted" | "declined";
const PAGE_SIZE = 50;

/** Quotes and cost estimates: the same documents as invoices, kept apart until the customer accepts. */
export default function QuotesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const today = todayLocalISO();

  const rows = useMemo(() => (data?.quotes ?? []).map((quote) => ({
    quote,
    status: quoteStatus(quote, today, language),
    total: computeInvoiceTotals(quote).total,
    searchText: `${quote.invoiceNumber} ${quote.recipient.name} ${quote.projectReference ?? ""} ${quote.invoiceDate} ${formatDay(quote.invoiceDate, locale)}`.toLocaleLowerCase(locale),
  })), [data?.quotes, today, language, locale]);
  type Row = (typeof rows)[number];

  const quotes = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase(locale);
    return rows
      .filter(({ status }) => {
        if (filterKey === "open") return status.key === "open" || status.key === "expired";
        if (filterKey === "accepted") return status.key === "accepted" || status.key === "converted";
        if (filterKey === "declined") return status.key === "declined";
        return true;
      })
      .filter(({ searchText }) => !normalizedQuery || searchText.includes(normalizedQuery))
      .sort((a, b) => (b.quote.invoiceDate || "").localeCompare(a.quote.invoiceDate || "") || b.quote.createdAt.localeCompare(a.quote.createdAt));
  }, [rows, filterKey, deferredQuery, locale]);

  const pageCount = Math.max(1, Math.ceil(quotes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = quotes.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersActive = query !== "" || filterKey !== "all";

  const createNew = () => {
    if (!adapter) return;
    window.location.assign(`/quotes/${createQuote(adapter).id}`);
  };
  const convert = (id: string) => {
    if (!adapter) return;
    const invoice = convertQuoteToInvoice(adapter, id);
    if (invoice) window.location.assign(`/invoices/${invoice.id}`);
  };
  const titleOf = (row: Row) => row.quote.invoiceNumber || "Ohne Angebotsnummer";

  const columns: DataTableColumn<Row>[] = [
    { key: "number", header: "Angebot", render: (row) => <PrimaryCell title={titleOf(row)} href={`/quotes/${row.quote.id}`} /> },
    {
      key: "customer",
      header: "Kunde",
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          {row.quote.recipient.name ? <span className="text-ink">{row.quote.recipient.name}</span> : <span className="text-ink-muted">Noch kein Empfänger</span>}
          {row.quote.projectReference?.trim() && <span className="font-sans text-base tracking-snug text-ink-muted">{row.quote.projectReference}</span>}
        </span>
      ),
    },
    { key: "date", header: "Datum", width: "8.5rem", render: (row) => <span className="tabular-nums">{formatDay(row.quote.invoiceDate, locale)}</span> },
    {
      key: "status",
      header: "Status",
      width: "13rem",
      render: (row) => (
        <span className="flex flex-col items-start gap-1 max-md:items-end">
          <StatusPill tone={row.status.tone}>{row.status.label}</StatusPill>
          {(row.status.key === "open" || row.status.key === "expired") && row.quote.dueDate && (
            <span className="font-sans text-base tracking-snug text-ink-muted tabular-nums">gültig bis {formatDay(row.quote.dueDate, locale)}</span>
          )}
        </span>
      ),
    },
    { key: "total", header: "Betrag", numeric: true, width: "9rem", render: (row) => <span className="font-semibold text-ink">{formatMoney(row.total, row.quote.currency ?? currency, locale)}</span> },
    {
      key: "actions",
      header: "Aktionen",
      hideHeader: true,
      width: "16rem",
      className: "text-right",
      render: (row) => {
        const title = titleOf(row);
        const converted = row.status.key === "converted";
        return (
          <span className="flex items-center justify-end gap-2">
            {converted
              ? <LinkButton size="sm" href={`/invoices/${row.quote.convertedInvoiceId}`} aria-label={`Rechnung öffnen: ${title}`}>Rechnung öffnen</LinkButton>
              : row.status.key !== "declined" && <Button size="sm" aria-label={`In Rechnung umwandeln: ${title}`} onClick={() => convert(row.quote.id)}>In Rechnung umwandeln</Button>}
            <OverflowMenu
              label={`Weitere Aktionen für ${title}`}
              items={[
                { kind: "link", label: "Öffnen", href: `/quotes/${row.quote.id}` },
                {
                  label: "Duplizieren",
                  onSelect: () => {
                    if (!adapter) return;
                    const copy = duplicateQuoteById(adapter, row.quote.id);
                    if (copy) window.location.assign(`/quotes/${copy.id}`);
                  },
                },
                !converted && row.status.key === "declined" && { label: "In Rechnung umwandeln", onSelect: () => convert(row.quote.id) },
                { kind: "separator" },
                { label: "Angebot löschen …", tone: "danger", onSelect: () => setDeleteConfirm(row.quote.id) },
              ]}
            />
          </span>
        );
      },
    },
  ];

  const total = data?.quotes?.length ?? 0;
  return (
    <Page>
      <PageHeader
        title="Angebote"
        description="Angebote und Kostenvoranschläge. Nimmt der Kunde an, wird aus dem Angebot mit einem Klick eine Rechnung mit denselben Positionen."
        actions={<Button variant="primary" onClick={createNew}>Neues Angebot</Button>}
      />

      {total === 0 && data ? (
        <EmptyState
          title="Noch keine Angebote"
          description="Legen Sie Ihr erstes Angebot an. Absender und Standardwerte kommen aus den Einstellungen."
          action={<Button onClick={createNew}>Neues Angebot</Button>}
        />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label="Verzeichnis">
          <FilterBar label="Angebote filtern" aside={<span>{quotes.length} {quotes.length === 1 ? "Angebot" : "Angebote"}</span>}>
            <FilterControl width="grow">
              <Field label="Suchen">
                <SearchInput value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Nummer, Kunde, Bauvorhaben oder Datum" />
              </Field>
            </FilterControl>
            <FilterControl width="sm">
              <Field label="Status">
                <Select value={filterKey} onChange={(e) => { setFilterKey(e.target.value as FilterKey); setPage(1); }}>
                  <option value="all">Alle</option>
                  <option value="open">Offen</option>
                  <option value="accepted">Angenommen</option>
                  <option value="declined">Abgelehnt</option>
                </Select>
              </Field>
            </FilterControl>
            {filtersActive && <Button variant="quiet" onClick={() => { setQuery(""); setFilterKey("all"); setPage(1); }}>Zurücksetzen</Button>}
          </FilterBar>

          <DataTable caption="Angebote" columns={columns} rows={visible} rowKey={(row) => row.quote.id} empty="Kein passendes Angebot. Ändern Sie die Suche oder den Status." />

          <Pagination
            total={quotes.length}
            page={currentPage}
            pageSize={PAGE_SIZE}
            unit={quotes.length === 1 ? "Angebot" : "Angebote"}
            onPageChange={setPage}
            labels={{ nav: "Angebotsseiten", page: (p, pages) => `Seite ${p} von ${pages}`, previous: "Zurück", next: "Weiter" }}
          />
        </section>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (adapter && deleteConfirm) deleteQuote(adapter, deleteConfirm); }}
        title="Angebot löschen?"
        description="Das Angebot wird endgültig entfernt. Eine daraus erstellte Rechnung bleibt erhalten."
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        warningLabel="Das lässt sich nicht rückgängig machen."
        variant="danger"
      />
    </Page>
  );
}
