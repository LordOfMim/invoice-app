"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/Input";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { EmptyState, Page, PageHeader } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { StatusPill } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { dateToLocalISO, formatDateOnly, todayLocalISO } from "@/lib/date";
import type { RecurringInvoice } from "@/lib/domain";
import { usePersistedData } from "@/lib/storage/useStore";
import { createRecurringInvoice, deleteRecurringInvoice, generateInvoiceFromRecurring } from "@/lib/storage/store";

export default function RecurringPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const recurringInvoices = useMemo(() => {
    const all = data?.recurringInvoices ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((ri) => ri.name.toLowerCase().includes(q) || ri.recipient.name.toLowerCase().includes(q));
  }, [data?.recurringInvoices, search]);

  const today = todayLocalISO();
  const handleCreate = () => {
    if (!adapter) return;
    const recurring = createRecurringInvoice(adapter);
    window.location.assign(`/recurring/${recurring.id}`);
  };
  const handleGenerate = (id: string, expectedNextRunDate: string) => {
    if (!adapter) return;
    const invoice = generateInvoiceFromRecurring(adapter, id, expectedNextRunDate);
    if (invoice) window.location.assign(`/invoices/${invoice.id}`);
  };
  const frequencyLabel = (freq: string) => {
    switch (freq) {
      case "monthly": return t(language, "recurring.monthly");
      case "quarterly": return t(language, "recurring.quarterly");
      case "yearly": return t(language, "recurring.yearly");
      default: return freq;
    }
  };
  const stateOf = (ri: RecurringInvoice) => {
    const isDue = ri.nextRunDate <= today;
    const upcomingDate = new Date();
    upcomingDate.setDate(upcomingDate.getDate() + ri.reminderDays);
    const isUpcoming = !isDue && ri.nextRunDate <= dateToLocalISO(upcomingDate);
    return { isDue, isUpcoming };
  };

  const columns: DataTableColumn<RecurringInvoice>[] = [
    {
      key: "name",
      header: de ? "Wiederkehrende Rechnung" : "Recurring invoice",
      render: (ri) => <PrimaryCell title={ri.name || t(language, "common.unnamed")} href={`/recurring/${ri.id}`} sub={ri.recipient.name || t(language, "recurring.noRecipient")} />,
    },
    { key: "frequency", header: de ? "Rhythmus" : "Frequency", width: "10rem", render: (ri) => `${frequencyLabel(ri.frequency)} · ${ri.lineItems.length} ${t(language, "recurring.items")}` },
    {
      key: "next",
      header: t(language, "recurring.nextRun"),
      width: "14rem",
      render: (ri) => {
        const { isDue, isUpcoming } = stateOf(ri);
        return (
          <span className="flex flex-col items-start gap-1 max-md:items-end">
            <span className="tabular-nums">{formatDateOnly(ri.nextRunDate, locale)}</span>
            {!ri.active ? <StatusPill tone="muted">{t(language, "recurring.paused")}</StatusPill>
              : isDue ? <StatusPill tone="attention">{t(language, "recurring.due")}</StatusPill>
                : isUpcoming ? <StatusPill tone="info">{t(language, "recurring.upcoming")}</StatusPill> : null}
            {ri.lastRunDate && <span className="font-sans text-base text-ink-muted">{t(language, "recurring.lastRun")}: {formatDateOnly(ri.lastRunDate, locale)}</span>}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: de ? "Aktionen" : "Actions",
      hideHeader: true,
      width: "14rem",
      className: "text-right",
      render: (ri) => (
        <span className="flex items-center justify-end gap-2">
          {stateOf(ri).isDue && <Button size="sm" onClick={() => handleGenerate(ri.id, ri.nextRunDate)}>{de ? "Rechnung erstellen" : "Create invoice"}</Button>}
          <OverflowMenu
            label={`${de ? "Aktionen für" : "Actions for"} ${ri.name || t(language, "common.unnamed")}`}
            items={[
              { kind: "link", label: t(language, "actions.edit"), href: `/recurring/${ri.id}` },
              { kind: "separator" },
              { label: de ? "Löschen …" : "Delete …", tone: "danger", onSelect: () => setDeleteId(ri.id) },
            ]}
          />
        </span>
      ),
    },
  ];

  const total = data?.recurringInvoices.length ?? 0;
  return (
    <Page>
      <PageHeader
        title={de ? "Wiederkehrende Rechnungen" : t(language, "recurring.title")}
        description={t(language, "recurring.description")}
        actions={<Button variant="primary" onClick={handleCreate}>{t(language, "recurring.new")}</Button>}
      />
      {total === 0 && data ? (
        <EmptyState title={t(language, "recurring.empty")} description={t(language, "recurring.description")} action={<Button onClick={handleCreate}>{t(language, "recurring.new")}</Button>} />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label={de ? "Verzeichnis" : "Directory"}>
          <FilterBar label={de ? "Wiederkehrende Rechnungen filtern" : "Filter recurring invoices"} aside={<span>{recurringInvoices.length} {de ? "Einträge" : "entries"}</span>}>
            <FilterControl width="grow">
              <Field label={de ? "Suchen" : "Search"}>
                <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={de ? "Name oder Kunde" : "Name or customer"} />
              </Field>
            </FilterControl>
            {search && <Button variant="quiet" onClick={() => setSearch("")}>{de ? "Zurücksetzen" : "Reset"}</Button>}
          </FilterBar>
          <DataTable caption={de ? "Wiederkehrende Rechnungen" : "Recurring invoices"} columns={columns} rows={recurringInvoices} rowKey={(ri) => ri.id} empty={t(language, "common.noResults")} />
        </section>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (adapter && deleteId) { deleteRecurringInvoice(adapter, deleteId); setDeleteId(null); } }}
        returnFocusSelector="#inhalt"
        title={t(language, "recurring.deleteTitle")}
        description={t(language, "recurring.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
