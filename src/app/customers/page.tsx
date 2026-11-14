"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/Input";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { EmptyState, Page, PageHeader } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import type { Customer } from "@/lib/domain";
import { usePersistedData } from "@/lib/storage/useStore";
import { createCustomer, deleteCustomer } from "@/lib/storage/store";

export default function CustomersPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const invoiceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const invoice of data?.invoices ?? []) if (invoice.customerId) counts.set(invoice.customerId, (counts.get(invoice.customerId) ?? 0) + 1);
    return counts;
  }, [data?.invoices]);

  const customers = useMemo(() => {
    const all = data?.customers ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q) ||
      c.contact.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q));
  }, [data?.customers, search]);

  const handleCreate = () => {
    if (!adapter) return;
    const customer = createCustomer(adapter);
    window.location.assign(`/customers/${customer.id}`);
  };

  const columns: DataTableColumn<Customer>[] = [
    {
      key: "name",
      header: de ? "Kunde" : "Customer",
      render: (customer) => <PrimaryCell title={customer.name || t(language, "common.unnamed")} href={`/customers/${customer.id}`} sub={customer.contact || undefined} />,
    },
    { key: "address", header: de ? "Adresse" : "Address", render: (customer) => <span className="whitespace-pre-line">{customer.address || "–"}</span> },
    {
      key: "reach",
      header: de ? "Erreichbar" : "Contact",
      render: (customer) => (
        <span className="flex flex-col">
          {customer.email && <span className="break-all">{customer.email}</span>}
          {customer.phone && <span className="tabular-nums">{customer.phone}</span>}
          {!customer.email && !customer.phone && <span className="text-ink-muted">–</span>}
        </span>
      ),
    },
    { key: "invoices", header: de ? "Rechnungen" : "Invoices", numeric: true, width: "8rem", render: (customer) => invoiceCounts.get(customer.id) ?? 0 },
    {
      key: "actions",
      header: de ? "Aktionen" : "Actions",
      hideHeader: true,
      width: "4.5rem",
      className: "text-right",
      render: (customer) => (
        <OverflowMenu
          label={`${de ? "Aktionen für" : "Actions for"} ${customer.name || t(language, "common.unnamed")}`}
          items={[
            { kind: "link", label: t(language, "actions.edit"), href: `/customers/${customer.id}` },
            { kind: "separator" },
            { label: de ? "Kunde löschen …" : "Delete customer …", tone: "danger", onSelect: () => setDeleteConfirm(customer.id) },
          ]}
        />
      ),
    },
  ];

  const total = data?.customers.length ?? 0;
  return (
    <Page>
      <PageHeader
        title={t(language, "customers.title")}
        description={de ? "Empfänger, die Sie mit einem Klick in eine Rechnung übernehmen. Änderungen hier ändern bestehende Rechnungen nicht." : "Recipients you can fill into an invoice with one click. Changes here do not alter existing invoices."}
        actions={<Button variant="primary" onClick={handleCreate}>{t(language, "customers.new")}</Button>}
      />
      {total === 0 && data ? (
        <EmptyState title={t(language, "customers.empty")} description={t(language, "common.addFirstCustomer")} action={<Button onClick={handleCreate}>{t(language, "customers.new")}</Button>} />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label={de ? "Verzeichnis" : "Directory"}>
          <FilterBar label={de ? "Kunden filtern" : "Filter customers"} aside={<span>{customers.length} {de ? "Kunden" : "customers"}</span>}>
            <FilterControl width="grow">
              <Field label={de ? "Suchen" : "Search"}>
                <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={de ? "Name, Adresse, E-Mail oder Telefon" : "Name, address, email or phone"} />
              </Field>
            </FilterControl>
            {search && <Button variant="quiet" onClick={() => setSearch("")}>{de ? "Zurücksetzen" : "Reset"}</Button>}
          </FilterBar>
          <DataTable caption={t(language, "customers.title")} columns={columns} rows={customers} rowKey={(customer) => customer.id} empty={t(language, "common.tryDifferentSearch")} />
        </section>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (adapter && deleteConfirm) deleteCustomer(adapter, deleteConfirm); }}
        returnFocusSelector="#inhalt"
        title={t(language, "customers.deleteTitle")}
        description={t(language, "customers.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
