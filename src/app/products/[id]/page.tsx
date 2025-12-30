"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Surface, PageHeader, Stack, Grid, Section } from "@/components/ui/Surface";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteProduct, upsertProduct } from "@/lib/storage/store";
import type { Product } from "@/lib/domain";

function parseNumber(input: string): number {
  const normalized = input.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export default function ProductEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [showDelete, setShowDelete] = useState(false);

  const product = useMemo(() => {
    return data?.products.find((p) => p.id === id) ?? null;
  }, [data?.products, id]);

  if (!adapter) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <Surface className="p-6 text-sm text-(--color-ink-muted)">
            {t(language, "common.loading")}
          </Surface>
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <Stack gap="sm">
            <p className="text-sm text-(--color-ink-muted)">Product not found.</p>
            <Link href="/products" className="text-sm text-(--color-accent) hover:underline">
              ← Back to products
            </Link>
          </Stack>
        </div>
      </main>
    );
  }

  const save = (next: Product) => {
    upsertProduct(adapter, next);
  };

  const handleDelete = () => {
    deleteProduct(adapter, id);
    window.location.assign("/products");
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <PageHeader
          title={product.name || t(language, "products.new")}
          breadcrumb={
            <Link href="/products" className="text-(--color-ink-subtle) hover:text-(--color-accent) transition-colors">
              ← {t(language, "nav.products")}
            </Link>
          }
          actions={
            <Button variant="danger" onClick={() => setShowDelete(true)}>
              {t(language, "actions.delete")}
            </Button>
          }
        />

        <Surface className="mt-6">
          <Stack gap="lg" className="p-6">
            <Section title="Basic Information">
              <Grid cols={2} gap="md">
                <Field label={t(language, "products.name")}>
                  <Input
                    value={product.name}
                    onChange={(e) => save({ ...product, name: e.target.value })}
                    placeholder="Product or Service Name"
                  />
                </Field>

                <Field label={t(language, "products.category")}>
                  <Input
                    value={product.category || ""}
                    onChange={(e) => save({ ...product, category: e.target.value })}
                    placeholder="e.g., Consulting, Development"
                  />
                </Field>
              </Grid>

              <Field label={t(language, "products.description")} className="mt-4">
                <Textarea
                  rows={3}
                  value={product.description}
                  onChange={(e) => save({ ...product, description: e.target.value })}
                  placeholder="Description that will appear on the invoice..."
                />
              </Field>
            </Section>

            <Section title="Pricing">
              <Grid cols={3} gap="md">
                <Field label={t(language, "products.unit")}>
                  <Input
                    value={product.unit || ""}
                    onChange={(e) => save({ ...product, unit: e.target.value })}
                    placeholder="e.g., Stunde, Stück, Pauschal"
                  />
                </Field>

                <Field label={t(language, "products.unitPrice")}>
                  <Input
                    inputMode="decimal"
                    value={String(product.unitPrice)}
                    onChange={(e) => save({ ...product, unitPrice: parseNumber(e.target.value) })}
                    placeholder="0.00"
                  />
                </Field>

                <Field label={t(language, "products.taxRate")} hint="e.g., 0.19 for 19%">
                  <Input
                    inputMode="decimal"
                    value={product.taxRate === undefined ? "" : String(product.taxRate)}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      const nextRate = value === "" ? undefined : parseNumber(value);
                      save({ ...product, taxRate: nextRate });
                    }}
                    placeholder="0.19"
                  />
                </Field>
              </Grid>
            </Section>

            <div className="text-xs text-(--color-ink-subtle) pt-2 border-t border-(--glass-border)">
              Created: {new Date(product.createdAt).toLocaleString()}
              {" · "}
              Updated: {new Date(product.updatedAt).toLocaleString()}
            </div>
          </Stack>
        </Surface>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Product"
        description="Are you sure you want to delete this product? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
