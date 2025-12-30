"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { createProduct, deleteProduct } from "@/lib/storage/store";
import { Surface, PageHeader, Stack } from "@/components/ui/Surface";
import { Badge, EmptyState } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";

export default function ProductsPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const currency = data?.settings.currency ?? "EUR";
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const products = useMemo(() => {
    const all = data?.products ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q)
    );
  }, [data?.products, search]);

  const handleCreate = () => {
    if (!adapter) return;
    const product = createProduct(adapter, data?.settings.defaultTaxRate);
    window.location.assign(`/products/${product.id}`);
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "products.title")}
            description="Reusable line items to speed up invoice entry."
            actions={
              <Button variant="primary" onClick={handleCreate}>
                {t(language, "products.new")}
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
            {products.length === 0 ? (
              <Surface variant="solid" padding="lg">
                <EmptyState
                  title={search ? t(language, "common.noResults") : t(language, "products.empty")}
                  description={search ? "Try a different search term" : "Add your first product to get started"}
                  icon={
                    <svg className="h-6 w-6 text-[var(--color-ink-subtle)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                  }
                  action={
                    !search && (
                      <Button variant="primary" onClick={handleCreate}>
                        {t(language, "products.new")}
                      </Button>
                    )
                  }
                />
              </Surface>
            ) : null}

            {products.map((product) => (
              <Surface
                key={product.id}
                variant="solid"
                padding="md"
                className="flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-50 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--color-ink)]">{product.name || "(Unnamed)"}</span>
                    {product.category && (
                      <Badge>{product.category}</Badge>
                    )}
                  </div>
                  {product.description && (
                    <div className="mt-1.5 text-sm text-[var(--color-ink-subtle)] line-clamp-1">
                      {product.description}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-medium text-[var(--color-ink)]">
                      {formatMoney(product.unitPrice, currency, locale)}
                    </div>
                    <div className="text-xs text-[var(--color-ink-subtle)]">
                      {product.unit && `per ${product.unit} · `}
                      {product.taxRate !== undefined ? `${(product.taxRate * 100).toFixed(0)}% tax` : "no tax"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href={`/products/${product.id}`}>
                      <Button size="sm" variant="secondary">{t(language, "actions.edit")}</Button>
                    </Link>
                    <Button size="sm" variant="danger" onClick={() => setDeleteConfirm(product.id)}>
                      {t(language, "actions.delete")}
                    </Button>
                  </div>
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
            deleteProduct(adapter, deleteConfirm);
          }
        }}
        title="Delete Product"
        description="Are you sure you want to delete this product?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </main>
  );
}
