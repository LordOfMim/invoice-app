"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { createCustomer, deleteCustomer } from "@/lib/storage/store";
import { Surface, PageHeader, Stack } from "@/components/ui/Surface";
import { EmptyState } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";

export default function CustomersPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const customers = useMemo(() => {
    const all = data?.customers ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.contact.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q)
    );
  }, [data?.customers, search]);

  const handleCreate = () => {
    if (!adapter) return;
    const customer = createCustomer(adapter);
    window.location.assign(`/customers/${customer.id}`);
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-[var(--content-max-width)]">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "customers.title")}
            description="Save recipients and pick them when creating invoices."
            action={
              <Button variant="primary" onClick={handleCreate}>
                {t(language, "customers.new")}
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
            {customers.length === 0 ? (
              <Surface variant="solid" padding="lg">
                <EmptyState
                  title={search ? t(language, "common.noResults") : t(language, "customers.empty")}
                  description={search ? "Try a different search term" : "Add your first customer to get started"}
                  icon={
                    <svg className="h-6 w-6 text-[var(--color-ink-subtle)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                    </svg>
                  }
                  action={
                    !search && (
                      <Button variant="primary" onClick={handleCreate}>
                        {t(language, "customers.new")}
                      </Button>
                    )
                  }
                />
              </Surface>
            ) : null}

            {customers.map((customer) => (
              <Surface
                key={customer.id}
                variant="solid"
                padding="md"
                className="flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-50">
                  <div className="font-medium text-[var(--color-ink)]">{customer.name || "(Unnamed)"}</div>
                  <div className="mt-1.5 text-sm text-[var(--color-ink-subtle)] whitespace-pre-line line-clamp-2">
                    {customer.address}
                  </div>
                  {customer.email && (
                    <div className="mt-1 text-xs text-[var(--color-ink-subtle)]">{customer.email}</div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Link href={`/customers/${customer.id}`}>
                    <Button size="sm" variant="secondary">{t(language, "actions.edit")}</Button>
                  </Link>
                  <Button size="sm" variant="danger" onClick={() => setDeleteConfirm(customer.id)}>
                    {t(language, "actions.delete")}
                  </Button>
                </div>
              </Surface>
            ))}
          </div>
        </Stack>
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (adapter && deleteConfirm) {
            deleteCustomer(adapter, deleteConfirm);
          }
        }}
        title="Delete Customer"
        description="Are you sure you want to delete this customer?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </main>
  );
}
