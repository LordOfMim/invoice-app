"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { createTag, deleteTag, upsertTag } from "@/lib/storage/store";
import type { Tag } from "@/lib/domain";
import { Surface, PageHeader, Stack, Section } from "@/components/ui/Surface";
import { EmptyState } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
];

function TagEditor({ tag, onSave, onDelete }: { 
  tag: Tag; 
  onSave: (tag: Tag) => void;
  onDelete: () => void;
}) {
  return (
    <Surface variant="solid" padding="md" className="flex flex-wrap items-center gap-3">
      <div
        className="h-8 w-8 rounded-full shadow-sm"
        style={{ backgroundColor: tag.color }}
      />
      
      <Input
        value={tag.name}
        onChange={(e) => onSave({ ...tag, name: e.target.value })}
        placeholder="Tag name"
        className="flex-1 min-w-[150px]"
      />
      
      <div className="flex flex-wrap gap-1.5">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onSave({ ...tag, color })}
            className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
              tag.color === color ? "ring-2 ring-[var(--color-ink)] ring-offset-2" : ""
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      
      <Button size="sm" variant="danger" onClick={onDelete}>
        ×
      </Button>
    </Surface>
  );
}

export default function TagsPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; count: number } | null>(null);

  const tags = useMemo(() => {
    const all = data?.tags ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((t) => t.name.toLowerCase().includes(q));
  }, [data?.tags, search]);

  // Count invoices per tag
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const inv of data?.invoices ?? []) {
      for (const tagId of inv.tagIds) {
        counts.set(tagId, (counts.get(tagId) || 0) + 1);
      }
    }
    return counts;
  }, [data?.invoices]);

  const handleCreate = () => {
    if (!adapter) return;
    createTag(adapter);
  };

  const handleSave = (tag: Tag) => {
    if (!adapter) return;
    upsertTag(adapter, tag);
  };

  const handleDelete = (id: string) => {
    if (!adapter) return;
    const count = tagCounts.get(id) || 0;
    setDeleteConfirm({ id, count });
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "tags.title")}
            description="Label invoices by client, project, or time period."
            actions={
              <Button variant="primary" onClick={handleCreate}>
                {t(language, "tags.new")}
              </Button>
            }
          />

          <div>
            <Input
              type="search"
              placeholder={t(language, "actions.search") + "..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="space-y-2">
            {tags.length === 0 ? (
              <Surface variant="solid" padding="lg">
                <EmptyState
                  title={search ? t(language, "common.noResults") : t(language, "tags.empty")}
                  description={search ? "Try a different search term" : "Create tags to organize your invoices"}
                  icon={
                    <svg className="h-6 w-6 text-[var(--color-ink-subtle)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                    </svg>
                  }
                  action={
                    !search && (
                      <Button variant="primary" onClick={handleCreate}>
                        {t(language, "tags.new")}
                      </Button>
                    )
                  }
                />
              </Surface>
            ) : null}

            {tags.map((tag) => (
              <div key={tag.id} className="relative">
                <TagEditor
                  tag={tag}
                  onSave={handleSave}
                  onDelete={() => handleDelete(tag.id)}
                />
                {tagCounts.get(tag.id) ? (
                  <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-ink)] px-1.5 text-xs text-white">
                    {tagCounts.get(tag.id)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {/* Tag Usage Summary */}
          {tags.length > 0 && (
            <Section title="Quick overview">
              <Surface variant="soft" padding="md">
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white shadow-sm"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name || "Unnamed"}
                      <span className="rounded-full bg-white/20 px-1.5 text-xs">
                        {tagCounts.get(tag.id) || 0}
                      </span>
                    </div>
                  ))}
                </div>
              </Surface>
            </Section>
          )}
        </Stack>
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (adapter && deleteConfirm) {
            deleteTag(adapter, deleteConfirm.id);
          }
        }}
        title="Delete Tag"
        description={
          deleteConfirm?.count && deleteConfirm.count > 0
            ? `This tag is used by ${deleteConfirm.count} invoice(s). Are you sure you want to delete it?`
            : "Are you sure you want to delete this tag?"
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </main>
  );
}
