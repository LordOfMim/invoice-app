"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, SearchInput } from "@/components/ui/Input";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { Card, CardZone, EmptyState, Page, PageHeader } from "@/components/ui/Layout";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { cn } from "@/components/platform/lib/cn";
import { t } from "@/lib/i18n";
import type { Tag } from "@/lib/domain";
import { usePersistedData } from "@/lib/storage/useStore";
import { createTag, deleteTag, upsertTag } from "@/lib/storage/store";

/* Stored tag colours (user data); not UI tokens. Kept exactly as before. */
const PRESET_COLORS: Array<[string, string]> = [
  ["#ef4444", "Rot"], ["#f97316", "Orange"], ["#f59e0b", "Bernstein"], ["#84cc16", "Limette"], ["#22c55e", "Grün"],
  ["#14b8a6", "Petrol"], ["#06b6d4", "Cyan"], ["#3b82f6", "Blau"], ["#6366f1", "Indigo"], ["#8b5cf6", "Violett"],
  ["#a855f7", "Lila"], ["#d946ef", "Fuchsia"], ["#ec4899", "Pink"], ["#f43f5e", "Rosé"],
];

export default function TagsPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; count: number } | null>(null);

  const tags = useMemo(() => {
    const all = data?.tags ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((tag) => tag.name.toLowerCase().includes(q));
  }, [data?.tags, search]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const inv of data?.invoices ?? []) for (const tagId of inv.tagIds) counts.set(tagId, (counts.get(tagId) || 0) + 1);
    return counts;
  }, [data?.invoices]);

  const save = (tag: Tag) => adapter && upsertTag(adapter, tag);
  const total = data?.tags.length ?? 0;

  return (
    <Page>
      <PageHeader
        title={de ? "Schlagwörter" : t(language, "tags.title")}
        description={de ? "Ordnen Sie Rechnungen mit farbigen Schlagwörtern. Zuweisen können Sie sie in der Rechnung unter „Gestaltung und mehr“." : "Organise invoices with coloured tags. Assign them in an invoice under “Layout and more”."}
        actions={<Button variant="primary" onClick={() => adapter && createTag(adapter)}>{t(language, "tags.new")}</Button>}
      />

      {total === 0 && data ? (
        <EmptyState title={t(language, "tags.empty")} description={t(language, "common.createTags")} action={<Button onClick={() => adapter && createTag(adapter)}>{t(language, "tags.new")}</Button>} />
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-label={de ? "Verzeichnis" : "Directory"}>
          <FilterBar label={de ? "Schlagwörter filtern" : "Filter tags"} aside={<span>{tags.length} {de ? "Schlagwörter" : "tags"}</span>}>
            <FilterControl width="grow">
              <Field label={de ? "Suchen" : "Search"}>
                <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={de ? "Name" : "Name"} />
              </Field>
            </FilterControl>
            {search && <Button variant="quiet" onClick={() => setSearch("")}>{de ? "Zurücksetzen" : "Reset"}</Button>}
          </FilterBar>
          <Card>
            {tags.length === 0 && <CardZone><p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.noResults")}</p></CardZone>}
            {tags.map((tag) => {
              const count = tagCounts.get(tag.id) || 0;
              return (
                <CardZone key={tag.id} className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <Field label={de ? "Name" : "Name"} className="min-w-0 lg:w-72">
                    <Input value={tag.name} onChange={(e) => save({ ...tag, name: e.target.value })} placeholder={t(language, "tags.namePlaceholder")} />
                  </Field>
                  <Field label={de ? "Farbe" : "Colour"} className="min-w-0 flex-1">
                    <div role="radiogroup" className="flex flex-wrap gap-1.5">
                      {PRESET_COLORS.map(([color, name]) => (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={tag.color === color}
                          aria-label={name}
                          title={name}
                          onClick={() => save({ ...tag, color })}
                          className={cn("size-8 rounded-pill border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50", tag.color === color ? "border-ink" : "border-surface")}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </Field>
                  <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
                    <span className="font-sans text-base tracking-snug text-ink-muted tabular-nums">{count} {de ? (count === 1 ? "Rechnung" : "Rechnungen") : (count === 1 ? "invoice" : "invoices")}</span>
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/5" aria-label={`${t(language, "actions.delete")}: ${tag.name || t(language, "common.unnamed")}`} onClick={() => setDeleteConfirm({ id: tag.id, count })}>
                      {t(language, "actions.delete")}
                    </Button>
                  </div>
                </CardZone>
              );
            })}
          </Card>
        </section>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (adapter && deleteConfirm) deleteTag(adapter, deleteConfirm.id); }}
        returnFocusSelector="#inhalt"
        title={t(language, "tags.deleteTitle")}
        description={deleteConfirm?.count
          ? de ? `Dieses Schlagwort wird von ${deleteConfirm.count} Rechnung(en) verwendet. Möchten Sie es wirklich löschen?` : `This tag is used by ${deleteConfirm.count} invoice(s). Are you sure you want to delete it?`
          : t(language, "tags.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
