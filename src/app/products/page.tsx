"use client";

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
import { formatTaxPercent } from "@/lib/calc";
import type { Product } from "@/lib/domain";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { createProduct, deleteProduct } from "@/lib/storage/store";

export default function ProductsPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const products = useMemo(() => {
    const all = data?.products ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q));
  }, [data?.products, search]);

  const handleCreate = () => {
    if (!adapter) return;
    const product = createProduct(adapter, data?.settings.defaultTaxRate);
    window.location.assign(`/products/${product.id}`);
  };

  const columns: DataTableColumn<Product>[] = [
    {
      key: "name",
      header: de ? "Produkt oder Leistung" : "Product or service",
      render: (product) => (
        <PrimaryCell
          title={product.name || t(language, "common.unnamed")}
          href={`/products/${product.id}`}
          sub={product.description || undefined}
          aside={product.category ? <KindBadge>{product.category}</KindBadge> : undefined}
        />
      ),
    },
    { key: "unit", header: de ? "Einheit" : "Unit", width: "9rem", render: (product) => product.unit || "–" },
    {
      key: "tax",
      header: de ? "MwSt." : "Tax",
      width: "7rem",
      numeric: true,
      render: (product) => (product.taxRate !== undefined ? `${formatTaxPercent(product.taxRate).replace(".", de ? "," : ".")} %` : t(language, "products.noTax")),
    },
    { key: "price", header: de ? "Preis" : "Price", numeric: true, width: "9rem", render: (product) => <span className="font-semibold text-ink">{formatMoney(product.unitPrice, currency, locale)}</span> },
    {
      key: "actions",
      header: de ? "Aktionen" : "Actions",
      hideHeader: true,
      width: "4.5rem",
      className: "text-right",
      render: (product) => (
        <OverflowMenu
          label={`${de ? "Aktionen für" : "Actions for"} ${product.name || t(language, "common.unnamed")}`}
          items={[
            { kind: "link", label: t(language, "actions.edit"), href: `/products/${product.id}` },
            { kind: "separator" },
            { label: de ? "Produkt löschen …" : "Delete product …", tone: "danger", onSelect: () => setDeleteConfirm(product.id) },
          ]}
        />
      ),
    },
  ];

  const total = data?.products.length ?? 0;
  return (
    <Page>
      <PageHeader
        title={de ? "Produkte und Leistungen" : "Products and services"}
        description={de ? "Wiederkehrende Positionen mit Preis und Steuersatz. In der Rechnung übernehmen Sie sie unter „Positionen“." : "Reusable line items with price and tax rate. Add them to an invoice under “Line items”."}
        actions={<Button variant="primary" onClick={handleCreate}>{t(language, "products.new")}</Button>}
      />
      {total === 0 && data ? (
        <EmptyState title={t(language, "products.empty")} description={t(language, "common.addFirstProduct")} action={<Button onClick={handleCreate}>{t(language, "products.new")}</Button>} />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label={de ? "Verzeichnis" : "Directory"}>
          <FilterBar label={de ? "Produkte filtern" : "Filter products"} aside={<span>{products.length} {de ? "Einträge" : "entries"}</span>}>
            <FilterControl width="grow">
              <Field label={de ? "Suchen" : "Search"}>
                <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={de ? "Name, Beschreibung oder Kategorie" : "Name, description or category"} />
              </Field>
            </FilterControl>
            {search && <Button variant="quiet" onClick={() => setSearch("")}>{de ? "Zurücksetzen" : "Reset"}</Button>}
          </FilterBar>
          <DataTable caption={de ? "Produkte und Leistungen" : "Products and services"} columns={columns} rows={products} rowKey={(product) => product.id} empty={t(language, "common.tryDifferentSearch")} />
        </section>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (adapter && deleteConfirm) deleteProduct(adapter, deleteConfirm); }}
        returnFocusSelector="#inhalt"
        title={t(language, "products.deleteTitle")}
        description={t(language, "products.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
