"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { Field } from "@/components/ui/Field";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { SearchInput } from "@/components/ui/Input";
import { EmptyState, Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { formatDay } from "@/components/invoiceStatus";
import { loadDeclarationDefaults } from "@/lib/declarationDefaults";
import { createDeclaration, senderLine } from "@/lib/documents";
import type { ContractorDeclaration } from "@/lib/domain";
import { addDeclaration, deleteDeclaration } from "@/lib/storage/store";
import { usePersistedData } from "@/lib/storage/useStore";

/** All saved contractor declarations, newest first; each belongs to one construction project. */
export default function DeclarationsPage() {
  const { adapter, data } = usePersistedData();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const all = data?.contractorDeclarations;
  const rows = useMemo(() => {
    const wanted = deferredQuery.trim().toLocaleLowerCase("de-DE");
    return [...(all ?? [])]
      .filter((entry) => !wanted || `${entry.kommission} ${entry.recipientName} ${entry.date} ${formatDay(entry.date, "de-DE")}`.toLocaleLowerCase("de-DE").includes(wanted))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [all, deferredQuery]);

  if (!adapter || !data) return <Page><PageHeader title="Fachunternehmererklärungen" /><p role="status">Erklärungen werden geladen …</p></Page>;

  const invoiceNumbers = new Map(data.invoices.map((invoice) => [invoice.id, invoice.invoiceNumber]));

  const open = (declaration: ContractorDeclaration) => window.location.assign(`/fachunternehmer/${declaration.id}`);
  const createNew = () => {
    const defaults = loadDeclarationDefaults(adapter);
    // Without stored standard values the sender comes from the settings, so the first declaration is not blank.
    const senderAddress = defaults.senderAddress || senderLine({ name: data.settings.defaultSender.name, address: data.settings.defaultSender.address });
    open(addDeclaration(adapter, createDeclaration({ ...defaults, senderAddress, signatureName: defaults.signatureName || data.settings.defaultSender.name })));
  };
  const duplicate = (source: ContractorDeclaration) => {
    const copy = createDeclaration(source);
    open(addDeclaration(adapter, { ...copy, bodyText: source.bodyText, customerId: source.customerId }));
  };

  const columns: DataTableColumn<ContractorDeclaration>[] = [
    {
      key: "project",
      header: "Bauvorhaben",
      render: (row) => <PrimaryCell title={row.kommission || "Ohne Bauvorhaben"} href={`/fachunternehmer/${row.id}`} sub={row.invoiceId && invoiceNumbers.has(row.invoiceId) ? `zu Rechnung ${invoiceNumbers.get(row.invoiceId) || "ohne Nummer"}` : undefined} />,
    },
    { key: "recipient", header: "Empfänger", render: (row) => row.recipientName.trim() ? <span className="text-ink">{row.recipientName.split("\n")[0]}</span> : <span className="text-ink-muted">Noch kein Empfänger</span> },
    { key: "date", header: "Datum", width: "8.5rem", render: (row) => <span className="tabular-nums">{formatDay(row.date, "de-DE")}</span> },
    {
      key: "actions",
      header: "Aktionen",
      hideHeader: true,
      width: "5rem",
      className: "text-right",
      render: (row) => (
        <OverflowMenu
          label={`Weitere Aktionen für ${row.kommission || "Erklärung ohne Bauvorhaben"}`}
          items={[
            { kind: "link", label: "Öffnen", href: `/fachunternehmer/${row.id}` },
            { label: "Für weiteres Bauvorhaben kopieren", onSelect: () => duplicate(row) },
            { kind: "separator" },
            { label: "Erklärung löschen …", tone: "danger", onSelect: () => setDeleteConfirm(row.id) },
          ]}
        />
      ),
    },
  ];

  const total = data.contractorDeclarations?.length ?? 0;
  return (
    <Page>
      <PageHeader
        title="Fachunternehmererklärungen"
        description="Übereinstimmungs- und Fachunternehmererklärungen je Bauvorhaben. Aus einer Rechnung heraus erstellt, sind Empfänger und Bauvorhaben schon ausgefüllt."
        actions={<Button variant="primary" onClick={createNew}>Neue Erklärung</Button>}
      />

      {total === 0 ? (
        <>
          <EmptyState
            title="Noch keine gespeicherten Erklärungen"
            description="Legen Sie eine Erklärung an. Absender, Unterschrift und Text übernehmen spätere Erklärungen als Standard."
            action={<Button onClick={createNew}>Neue Erklärung</Button>}
          />
          <StatusNote tone="info">Tipp: In einer Rechnung finden Sie unter „Weitere Aktionen“ den Punkt „Fachunternehmererklärung erstellen“.</StatusNote>
        </>
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label="Verzeichnis">
          <FilterBar label="Erklärungen filtern" aside={<span>{rows.length} {rows.length === 1 ? "Erklärung" : "Erklärungen"}</span>}>
            <FilterControl width="grow">
              <Field label="Suchen">
                <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Bauvorhaben, Empfänger oder Datum" />
              </Field>
            </FilterControl>
            {query !== "" && <Button variant="quiet" onClick={() => setQuery("")}>Zurücksetzen</Button>}
          </FilterBar>
          <DataTable caption="Fachunternehmererklärungen" columns={columns} rows={rows} rowKey={(row) => row.id} empty="Keine passende Erklärung. Ändern Sie die Suche." />
        </section>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (deleteConfirm) deleteDeclaration(adapter, deleteConfirm); }}
        title="Erklärung löschen?"
        description="Die gespeicherte Erklärung wird endgültig entfernt."
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        warningLabel="Das lässt sich nicht rückgängig machen."
        variant="danger"
      />
    </Page>
  );
}
