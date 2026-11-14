"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/Input";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { Card, CardZone, EmptyState, Page, PageHeader, Section } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { KindBadge } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import type { TemplateVariant } from "@/lib/domain";
import { usePersistedData } from "@/lib/storage/useStore";
import { createTemplateVariant, deleteTemplateVariant } from "@/lib/storage/store";

export default function TemplatesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const templates = useMemo(() => {
    const all = data?.templateVariants ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((variant) => variant.name.toLowerCase().includes(q));
  }, [data?.templateVariants, search]);

  const handleCreate = (baseTemplateId?: string) => {
    if (!adapter) return;
    const variant = createTemplateVariant(adapter, baseTemplateId);
    window.location.assign(`/templates/${variant.id}`);
  };

  const baseTemplates = [
    { id: "classic", name: "Classic", description: de ? "Klassisches Rechnungslayout" : "Traditional invoice layout" },
    { id: "modern", name: "Modern", description: de ? "Sauberes, zeitgemäßes Design" : "Clean, contemporary design" },
    { id: "minimal", name: "Minimal", description: de ? "Schlicht und minimal" : "Simple and minimal" },
  ];

  const columns: DataTableColumn<TemplateVariant>[] = [
    {
      key: "name",
      header: de ? "Variante" : "Variant",
      render: (variant) => (
        <PrimaryCell
          title={variant.name || t(language, "common.unnamed")}
          href={`/templates/${variant.id}`}
          aside={<KindBadge>{variant.baseTemplateId}</KindBadge>}
          sub={`${t(language, "templates.fontSizeScale")}: ${(variant.customization.fontSizeScale * 100).toFixed(0)} % · ${t(language, "templates.lineSpacing")}: ${variant.customization.lineSpacing} · ${t(language, "templates.tablePadding")}: ${variant.customization.tablePadding}`}
        />
      ),
    },
    {
      key: "actions",
      header: de ? "Aktionen" : "Actions",
      hideHeader: true,
      width: "4.5rem",
      className: "text-right",
      render: (variant) => (
        <OverflowMenu
          label={`${de ? "Aktionen für" : "Actions for"} ${variant.name || t(language, "common.unnamed")}`}
          items={[
            { kind: "link", label: t(language, "actions.edit"), href: `/templates/${variant.id}` },
            { kind: "separator" },
            { label: de ? "Löschen …" : "Delete …", tone: "danger", onSelect: () => setDeleteId(variant.id) },
          ]}
        />
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t(language, "templates.title")}
        description={t(language, "templates.description")}
        actions={<Button variant="primary" onClick={() => handleCreate()}>{t(language, "templates.new")}</Button>}
      />

      <Section title={t(language, "templates.baseTemplates")} summary={de ? "Jede Variante baut auf einer dieser drei Grundvorlagen auf." : "Every variant builds on one of these three base templates."}>
        <Card>
          {baseTemplates.map((template) => (
            <CardZone key={template.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-sans text-lg font-semibold tracking-snug text-ink">{template.name}</div>
                <div className="font-sans text-base tracking-snug text-ink-muted">{template.description}</div>
              </div>
              <Button size="sm" aria-label={`${t(language, "actions.createVariant")}: ${template.name}`} onClick={() => handleCreate(template.id)}>{t(language, "actions.createVariant")}</Button>
            </CardZone>
          ))}
        </Card>
      </Section>

      <Section title={t(language, "templates.customVariants")}>
        {(data?.templateVariants.length ?? 0) === 0 && data ? (
          <EmptyState title={t(language, "templates.empty")} description={t(language, "templates.createDescription")} />
        ) : (
          <>
            <FilterBar label={de ? "Varianten filtern" : "Filter variants"} aside={<span>{templates.length} {de ? "Varianten" : "variants"}</span>}>
              <FilterControl width="grow">
                <Field label={de ? "Suchen" : "Search"}>
                  <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={de ? "Name der Variante" : "Variant name"} />
                </Field>
              </FilterControl>
              {search && <Button variant="quiet" onClick={() => setSearch("")}>{de ? "Zurücksetzen" : "Reset"}</Button>}
            </FilterBar>
            <DataTable caption={t(language, "templates.customVariants")} columns={columns} rows={templates} rowKey={(variant) => variant.id} empty={t(language, "common.noResults")} />
          </>
        )}
      </Section>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (adapter && deleteId) { deleteTemplateVariant(adapter, deleteId); setDeleteId(null); } }}
        returnFocusSelector="#inhalt"
        title={t(language, "templates.deleteTitle")}
        description={t(language, "templates.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
