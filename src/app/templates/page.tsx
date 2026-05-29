"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface, PageHeader, Stack, Section, Grid } from "@/components/ui/Surface";
import { Badge, EmptyState, ListItem } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { createTemplateVariant, deleteTemplateVariant } from "@/lib/storage/store";

export default function TemplatesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const templates = useMemo(() => {
    const all = data?.templateVariants ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((t) => t.name.toLowerCase().includes(q));
  }, [data?.templateVariants, search]);

  const handleCreate = (baseTemplateId?: string) => {
    if (!adapter) return;
    const variant = createTemplateVariant(adapter, baseTemplateId);
    window.location.assign(`/templates/${variant.id}`);
  };

  const handleDelete = () => {
    if (!adapter || !deleteId) return;
    deleteTemplateVariant(adapter, deleteId);
    setDeleteId(null);
  };

  const baseTemplates = [
    {
      id: "classic",
      name: "Classic",
      description: language === "de" ? "Klassisches Rechnungslayout" : "Traditional invoice layout",
    },
    {
      id: "modern",
      name: "Modern",
      description: language === "de" ? "Sauberes, zeitgemäßes Design" : "Clean, contemporary design",
    },
    {
      id: "minimal",
      name: "Minimal",
      description: language === "de" ? "Schlicht und minimal" : "Simple and minimal",
    },
  ];

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <PageHeader
          title={t(language, "templates.title")}
          subtitle={t(language, "templates.description")}
          actions={
            <Button variant="primary" onClick={() => handleCreate()}>
              {t(language, "templates.new")}
            </Button>
          }
        />

        {/* Base Templates */}
        <Section title={t(language, "templates.baseTemplates")} className="mt-6">
          <Grid cols={3} gap="md">
            {baseTemplates.map((tmpl) => (
              <Surface key={tmpl.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-(--color-ink)">{tmpl.name}</div>
                    <div className="mt-1 text-sm text-(--color-ink-muted)">{tmpl.description}</div>
                  </div>
                  <Badge variant="default">{tmpl.id}</Badge>
                </div>
                <Button
                  variant="secondary"
                  className="mt-4 w-full"
                  onClick={() => handleCreate(tmpl.id)}
                >
                  {t(language, "actions.createVariant")}
                </Button>
              </Surface>
            ))}
          </Grid>
        </Section>

        {/* Custom Variants */}
        <Section title={t(language, "templates.customVariants")} className="mt-8">
          <Surface>
            <div className="p-4 border-b border-(--glass-border)">
              <Input
                type="search"
                placeholder={t(language, "actions.search") + "..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>

            <Stack gap="none" className="divide-y divide-(--glass-border)">
              {templates.length === 0 ? (
                <EmptyState
                  title={search ? t(language, "common.noResults") : t(language, "templates.empty")}
                  description={t(language, "templates.createDescription")}
                  action={
                    !search && (
                      <Button variant="primary" onClick={() => handleCreate()}>
                        {t(language, "templates.new")}
                      </Button>
                    )
                  }
                />
              ) : (
                templates.map((variant) => (
                  <ListItem key={variant.id}>
                    <div className="flex flex-wrap items-center justify-between gap-4 w-full">
                      <div className="min-w-48 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/templates/${variant.id}`}
                            className="font-medium text-(--color-ink) hover:text-(--color-accent) transition-colors"
                          >
                            {variant.name || t(language, "common.unnamed")}
                          </Link>
                          <Badge variant="default">{variant.baseTemplateId}</Badge>
                        </div>
                        <div className="mt-1.5 text-xs text-(--color-ink-subtle)">
                          {t(language, "templates.fontSizeScale")}: {(variant.customization.fontSizeScale * 100).toFixed(0)}% ·{" "}
                          {t(language, "templates.lineSpacing")}: {variant.customization.lineSpacing} ·{" "}
                          {t(language, "templates.tablePadding")}: {variant.customization.tablePadding}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link href={`/templates/${variant.id}`}>
                          <Button variant="secondary">{t(language, "actions.edit")}</Button>
                        </Link>
                        <Button variant="danger" onClick={() => setDeleteId(variant.id)}>
                          {t(language, "actions.delete")}
                        </Button>
                      </div>
                    </div>
                  </ListItem>
                ))
              )}
            </Stack>
          </Surface>
        </Section>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t(language, "templates.deleteTitle")}
        description={t(language, "templates.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </main>
  );
}
