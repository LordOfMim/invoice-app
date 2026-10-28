"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/Input";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { EmptyState, Page, PageHeader } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { KindBadge } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { formatDay } from "@/components/invoiceStatus";
import type { CreditNote } from "@/lib/domain";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteCreditNote } from "@/lib/storage/store";

export default function CreditNotesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const creditNotes = useMemo(() => {
    const all = data?.creditNotes ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((cn) =>
      cn.creditNoteNumber.toLowerCase().includes(q) ||
      cn.linkedInvoiceNumber.toLowerCase().includes(q) ||
      cn.recipient.name.toLowerCase().includes(q) ||
      cn.reason.toLowerCase().includes(q));
  }, [data?.creditNotes, search]);

  const columns: DataTableColumn<CreditNote>[] = [
    {
      key: "number",
      header: de ? "Dokument" : "Document",
      render: (cn) => (
        <PrimaryCell
          title={cn.creditNoteNumber || t(language, "common.noNumber")}
          href={`/credit-notes/${cn.id}`}
          sub={cn.reason || undefined}
          aside={<KindBadge>{cn.type === "storno" ? t(language, "creditNotes.storno") : t(language, "creditNotes.gutschrift")}</KindBadge>}
        />
      ),
    },
    { key: "customer", header: de ? "Kunde" : "Customer", render: (cn) => cn.recipient.name || "–" },
    {
      key: "invoice",
      header: de ? "Zur Rechnung" : "Invoice",
      render: (cn) => (
        <Link href={`/invoices/${cn.linkedInvoiceId}`} className="rounded-sm font-medium text-link underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
          {cn.linkedInvoiceNumber || t(language, "common.unknown")}
        </Link>
      ),
    },
    { key: "date", header: de ? "Datum" : "Date", width: "8.5rem", render: (cn) => <span className="tabular-nums">{formatDay(cn.creditNoteDate, locale)}</span> },
    { key: "amount", header: de ? "Betrag" : "Amount", numeric: true, width: "9rem", render: (cn) => <span className="font-semibold text-ink">− {formatMoney(cn.amount, currency, locale)}</span> },
    {
      key: "actions",
      header: de ? "Aktionen" : "Actions",
      hideHeader: true,
      width: "4.5rem",
      className: "text-right",
      render: (cn) => (
        <OverflowMenu
          label={`${de ? "Aktionen für" : "Actions for"} ${cn.creditNoteNumber || t(language, "common.noNumber")}`}
          items={[
            { kind: "link", label: t(language, "actions.edit"), href: `/credit-notes/${cn.id}` },
            { kind: "link", label: t(language, "actions.viewInvoice"), href: `/invoices/${cn.linkedInvoiceId}` },
            { kind: "separator" },
            { label: de ? "Löschen …" : "Delete …", tone: "danger", onSelect: () => setDeleteId(cn.id) },
          ]}
        />
      ),
    },
  ];

  const total = data?.creditNotes.length ?? 0;
  return (
    <Page>
      <PageHeader
        title={de ? "Gutschriften und Stornos" : t(language, "creditNotes.title")}
        description={de ? "Korrekturen zu gestellten Rechnungen. Sie entstehen in der Rechnung über „Weitere Aktionen“ oder im Tab „Zahlungen“." : "Corrections to issued invoices. Create them in an invoice under “More actions” or in the Payments tab."}
      />
      {total === 0 && data ? (
        <EmptyState title={t(language, "creditNotes.empty")} description={t(language, "creditNotes.createdFromInvoiceEditor")} action={<Link href="/invoices" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{de ? "Zu den Rechnungen" : "Go to invoices"}</Link>} />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label={de ? "Verzeichnis" : "Directory"}>
          <FilterBar label={de ? "Gutschriften filtern" : "Filter credit notes"} aside={<span>{creditNotes.length} {de ? "Dokumente" : "documents"}</span>}>
            <FilterControl width="grow">
              <Field label={de ? "Suchen" : "Search"}>
                <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={de ? "Nummer, Rechnung, Kunde oder Grund" : "Number, invoice, customer or reason"} />
              </Field>
            </FilterControl>
            {search && <Button variant="quiet" onClick={() => setSearch("")}>{de ? "Zurücksetzen" : "Reset"}</Button>}
          </FilterBar>
          <DataTable caption={de ? "Gutschriften und Stornos" : "Credit notes"} columns={columns} rows={creditNotes} rowKey={(cn) => cn.id} empty={t(language, "common.noResults")} />
        </section>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (adapter && deleteId) { deleteCreditNote(adapter, deleteId); setDeleteId(null); } }}
        returnFocusSelector="#inhalt"
        title={t(language, "creditNotes.deleteTitle")}
        description={t(language, "creditNotes.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
