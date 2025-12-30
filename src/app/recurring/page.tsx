"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface, PageHeader, Stack } from "@/components/ui/Surface";
import { Badge, EmptyState, ListItem } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { 
  createRecurringInvoice, 
  deleteRecurringInvoice,
  generateInvoiceFromRecurring,
} from "@/lib/storage/store";

export default function RecurringPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const recurringInvoices = useMemo(() => {
    const all = data?.recurringInvoices ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (ri) =>
        ri.name.toLowerCase().includes(q) ||
        ri.recipient.name.toLowerCase().includes(q)
    );
  }, [data?.recurringInvoices, search]);

  const today = new Date().toISOString().split("T")[0];

  const handleCreate = () => {
    if (!adapter) return;
    const recurring = createRecurringInvoice(adapter);
    window.location.assign(`/recurring/${recurring.id}`);
  };

  const handleDelete = () => {
    if (!adapter || !deleteId) return;
    deleteRecurringInvoice(adapter, deleteId);
    setDeleteId(null);
  };

  const handleGenerate = (id: string) => {
    if (!adapter) return;
    const invoice = generateInvoiceFromRecurring(adapter, id);
    if (invoice) {
      window.location.assign(`/invoices/${invoice.id}`);
    }
  };

  const frequencyLabel = (freq: string) => {
    switch (freq) {
      case "monthly": return t(language, "recurring.monthly");
      case "quarterly": return t(language, "recurring.quarterly");
      case "yearly": return t(language, "recurring.yearly");
      default: return freq;
    }
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={t(language, "recurring.title")}
          subtitle="Monthly/quarterly generation with next-run reminders"
          actions={
            <Button variant="primary" onClick={handleCreate}>
              {t(language, "recurring.new")}
            </Button>
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
            {recurringInvoices.length === 0 ? (
              <EmptyState
                title={search ? t(language, "common.noResults") : t(language, "recurring.empty")}
                description="Create recurring invoices to automate your billing"
                action={
                  !search && (
                    <Button variant="primary" onClick={handleCreate}>
                      {t(language, "recurring.new")}
                    </Button>
                  )
                }
              />
            ) : (
              recurringInvoices.map((ri) => {
                const isDue = ri.nextRunDate <= today;
                const upcomingDate = new Date();
                upcomingDate.setDate(upcomingDate.getDate() + ri.reminderDays);
                const isUpcoming = !isDue && ri.nextRunDate <= upcomingDate.toISOString().split("T")[0];
                
                return (
                  <ListItem
                    key={ri.id}
                    className={isDue ? "bg-(--color-warning)/5" : isUpcoming ? "bg-(--color-accent)/5" : ""}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4 w-full">
                      <div className="min-w-48 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/recurring/${ri.id}`}
                            className="font-medium text-(--color-ink) hover:text-(--color-accent) transition-colors"
                          >
                            {ri.name || "(Unnamed)"}
                          </Link>
                          {!ri.active && <Badge variant="default">Paused</Badge>}
                          {isDue && <Badge variant="warning">Due</Badge>}
                          {isUpcoming && !isDue && <Badge variant="info">Upcoming</Badge>}
                        </div>
                        <div className="mt-1 text-sm text-(--color-ink-muted)">
                          {ri.recipient.name || "No recipient"}
                        </div>
                        <div className="mt-1 text-xs text-(--color-ink-subtle)">
                          {frequencyLabel(ri.frequency)} · {ri.lineItems.length} item(s)
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 text-right">
                        <div className="text-sm">
                          <span className="text-(--color-ink-subtle)">{t(language, "recurring.nextRun")}:</span>{" "}
                          <span className={isDue ? "font-medium text-(--color-warning)" : "text-(--color-ink-muted)"}>
                            {new Date(ri.nextRunDate).toLocaleDateString(locale)}
                          </span>
                        </div>
                        {ri.lastRunDate && (
                          <div className="text-xs text-(--color-ink-subtle)">
                            {t(language, "recurring.lastRun")}: {new Date(ri.lastRunDate).toLocaleDateString(locale)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isDue && (
                          <Button variant="primary" onClick={() => handleGenerate(ri.id)}>
                            {t(language, "actions.generate")}
                          </Button>
                        )}
                        <Link href={`/recurring/${ri.id}`}>
                          <Button variant="secondary">{t(language, "actions.edit")}</Button>
                        </Link>
                        <Button variant="danger" onClick={() => setDeleteId(ri.id)}>
                          {t(language, "actions.delete")}
                        </Button>
                      </div>
                    </div>
                  </ListItem>
                );
              })
            )}
          </Stack>
        </Surface>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Recurring Invoice"
        description="Are you sure you want to delete this recurring invoice? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
