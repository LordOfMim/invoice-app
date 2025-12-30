"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface, PageHeader, Stack } from "@/components/ui/Surface";
import { Badge, EmptyState, ListItem } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteCreditNote } from "@/lib/storage/store";

export default function CreditNotesPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const creditNotes = useMemo(() => {
    const all = data?.creditNotes ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (cn) =>
        cn.creditNoteNumber.toLowerCase().includes(q) ||
        cn.linkedInvoiceNumber.toLowerCase().includes(q) ||
        cn.recipient.name.toLowerCase().includes(q) ||
        cn.reason.toLowerCase().includes(q)
    );
  }, [data?.creditNotes, search]);

  const handleDelete = () => {
    if (!adapter || !deleteId) return;
    deleteCreditNote(adapter, deleteId);
    setDeleteId(null);
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={t(language, "creditNotes.title")}
          subtitle="Stornos and credit notes linked to invoices"
          actions={
            <span className="text-sm text-(--color-ink-subtle)">
              Create from invoice editor →
            </span>
          }
        />

        <Surface className="mt-6">
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
            {creditNotes.length === 0 ? (
              <EmptyState
                title={search ? t(language, "common.noResults") : t(language, "creditNotes.empty")}
                description="Credit notes are created from the invoice editor"
              />
            ) : (
              creditNotes.map((cn) => (
                <ListItem key={cn.id}>
                  <div className="flex flex-wrap items-center justify-between gap-4 w-full">
                    <div className="min-w-48 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/credit-notes/${cn.id}`}
                          className="font-medium text-(--color-ink) hover:text-(--color-accent) transition-colors"
                        >
                          {cn.creditNoteNumber || "(No number)"}
                        </Link>
                        <Badge variant={cn.type === "storno" ? "danger" : "info"}>
                          {cn.type === "storno" ? t(language, "creditNotes.storno") : t(language, "creditNotes.gutschrift")}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-(--color-ink-muted)">
                        {cn.recipient.name}
                      </div>
                      <div className="mt-1 text-xs text-(--color-ink-subtle)">
                        {t(language, "creditNotes.linkedInvoice")}: {cn.linkedInvoiceNumber || "(unknown)"}
                      </div>
                      {cn.reason && (
                        <div className="mt-1 text-xs text-(--color-ink-muted) line-clamp-1">
                          {cn.reason}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1 text-right">
                      <div className="text-lg font-semibold text-(--color-danger)">
                        -{formatMoney(cn.amount, currency, locale)}
                      </div>
                      <div className="text-xs text-(--color-ink-subtle)">
                        {new Date(cn.creditNoteDate).toLocaleDateString(locale)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link href={`/credit-notes/${cn.id}`}>
                        <Button variant="secondary">{t(language, "actions.edit")}</Button>
                      </Link>
                      <Link href={`/invoices/${cn.linkedInvoiceId}`}>
                        <Button variant="secondary">View Invoice</Button>
                      </Link>
                      <Button variant="danger" onClick={() => setDeleteId(cn.id)}>
                        {t(language, "actions.delete")}
                      </Button>
                    </div>
                  </div>
                </ListItem>
              ))
            )}
          </Stack>
        </Surface>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Credit Note"
        description="Are you sure you want to delete this credit note? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
