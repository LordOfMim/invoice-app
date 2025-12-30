"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Surface, PageHeader, Stack, Section, Grid } from "@/components/ui/Surface";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteTemplateVariant, upsertTemplateVariant } from "@/lib/storage/store";
import type { TemplateVariant, TemplateCustomization, InvoiceTemplateId } from "@/lib/domain";

export default function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [showDelete, setShowDelete] = useState(false);

  const variant = useMemo(() => {
    return data?.templateVariants.find((tv) => tv.id === id) ?? null;
  }, [data?.templateVariants, id]);

  if (!adapter) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          <Surface className="p-6 text-sm text-(--color-ink-muted)">
            {t(language, "common.loading")}
          </Surface>
        </div>
      </main>
    );
  }

  if (!variant) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          <Stack gap="sm">
            <p className="text-sm text-(--color-ink-muted)">Template variant not found.</p>
            <Link href="/templates" className="text-sm text-(--color-accent) hover:underline">
              ← Back to templates
            </Link>
          </Stack>
        </div>
      </main>
    );
  }

  const save = (next: TemplateVariant) => {
    upsertTemplateVariant(adapter, next);
  };

  const updateCustomization = (updates: Partial<TemplateCustomization>) => {
    save({
      ...variant,
      customization: { ...variant.customization, ...updates },
    });
  };

  const handleDelete = () => {
    deleteTemplateVariant(adapter, id);
    window.location.assign("/templates");
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={variant.name || t(language, "templates.new")}
          breadcrumb={
            <Link href="/templates" className="text-(--color-ink-subtle) hover:text-(--color-accent) transition-colors">
              ← {t(language, "nav.templates")}
            </Link>
          }
          actions={
            <Button variant="danger" onClick={() => setShowDelete(true)}>
              {t(language, "actions.delete")}
            </Button>
          }
        />

        <Grid cols={2} gap="lg" className="mt-6">
          {/* Settings */}
          <Stack gap="md">
            <Surface>
              <Stack gap="md" className="p-5">
                <Section title="Basic Settings">
                  <Grid cols={1} gap="md">
                    <Field label="Variant Name">
                      <Input
                        value={variant.name}
                        onChange={(e) => save({ ...variant, name: e.target.value })}
                        placeholder="e.g., Modern with Logo Left"
                      />
                    </Field>

                    <Field label={t(language, "templates.baseTemplate")}>
                      <Select
                        value={variant.baseTemplateId}
                        onChange={(e) => save({ ...variant, baseTemplateId: e.target.value as InvoiceTemplateId })}
                      >
                        <option value="classic">Classic</option>
                        <option value="modern">Modern</option>
                        <option value="minimal">Minimal</option>
                      </Select>
                    </Field>
                  </Grid>
                </Section>
              </Stack>
            </Surface>

            <Surface>
              <Stack gap="md" className="p-5">
                <Section title="Typography">
                  <Grid cols={1} gap="md">
                    <Field label={t(language, "templates.fontSizeScale")}>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0.8"
                          max="1.2"
                          step="0.05"
                          value={variant.customization.fontSizeScale}
                          onChange={(e) => updateCustomization({ fontSizeScale: parseFloat(e.target.value) })}
                          className="flex-1 accent-(--color-accent)"
                        />
                        <span className="text-sm text-(--color-ink-muted) w-12">
                          {(variant.customization.fontSizeScale * 100).toFixed(0)}%
                        </span>
                      </div>
                    </Field>

                    <Field label={t(language, "templates.lineSpacing")}>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="2"
                          step="0.1"
                          value={variant.customization.lineSpacing}
                          onChange={(e) => updateCustomization({ lineSpacing: parseFloat(e.target.value) })}
                          className="flex-1 accent-(--color-accent)"
                        />
                        <span className="text-sm text-(--color-ink-muted) w-12">
                          {variant.customization.lineSpacing.toFixed(1)}
                        </span>
                      </div>
                    </Field>
                  </Grid>
                </Section>
              </Stack>
            </Surface>

            <Surface>
              <Stack gap="md" className="p-5">
                <Section title="Table Settings">
                  <Grid cols={1} gap="md">
                    <Field label={t(language, "templates.tablePadding")}>
                      <Select
                        value={variant.customization.tablePadding}
                        onChange={(e) => updateCustomization({ tablePadding: e.target.value as "compact" | "normal" | "spacious" })}
                      >
                        <option value="compact">Compact</option>
                        <option value="normal">Normal</option>
                        <option value="spacious">Spacious</option>
                      </Select>
                    </Field>

                    <div className="space-y-2.5">
                      <label className="flex items-center gap-2.5 text-sm text-(--color-ink-muted) cursor-pointer">
                        <input
                          type="checkbox"
                          checked={variant.customization.showQuantityColumn}
                          onChange={(e) => updateCustomization({ showQuantityColumn: e.target.checked })}
                          className="h-4 w-4 rounded border-(--glass-border) text-(--color-accent) focus:ring-(--color-accent)"
                        />
                        Show Quantity Column
                      </label>
                      <label className="flex items-center gap-2.5 text-sm text-(--color-ink-muted) cursor-pointer">
                        <input
                          type="checkbox"
                          checked={variant.customization.showUnitPriceColumn}
                          onChange={(e) => updateCustomization({ showUnitPriceColumn: e.target.checked })}
                          className="h-4 w-4 rounded border-(--glass-border) text-(--color-accent) focus:ring-(--color-accent)"
                        />
                        Show Unit Price Column
                      </label>
                      <label className="flex items-center gap-2.5 text-sm text-(--color-ink-muted) cursor-pointer">
                        <input
                          type="checkbox"
                          checked={variant.customization.showTaxColumn}
                          onChange={(e) => updateCustomization({ showTaxColumn: e.target.checked })}
                          className="h-4 w-4 rounded border-(--glass-border) text-(--color-accent) focus:ring-(--color-accent)"
                        />
                        Show Tax Column
                      </label>
                    </div>
                  </Grid>
                </Section>
              </Stack>
            </Surface>

            <Surface>
              <Stack gap="md" className="p-5">
                <Section title="Header Style">
                  <Grid cols={1} gap="md">
                    <Field label={t(language, "templates.headerStyle")}>
                      <Select
                        value={variant.customization.headerStyle}
                        onChange={(e) => updateCustomization({ headerStyle: e.target.value as "simple" | "boxed" | "underlined" })}
                      >
                        <option value="simple">Simple</option>
                        <option value="boxed">Boxed</option>
                        <option value="underlined">Underlined</option>
                      </Select>
                    </Field>
                  </Grid>
                </Section>
              </Stack>
            </Surface>

            <div className="text-xs text-(--color-ink-subtle)">
              Created: {new Date(variant.createdAt).toLocaleString()}
              {" · "}
              Updated: {new Date(variant.updatedAt).toLocaleString()}
            </div>
          </Stack>

          {/* Preview */}
          <div className="sticky top-6">
            <Section title="Preview">
              <Surface 
                variant="solid"
                className="p-6"
                style={{ 
                  fontSize: `${variant.customization.fontSizeScale * 100}%`,
                  lineHeight: variant.customization.lineSpacing,
                }}
              >
                <div 
                  className={`border-b pb-4 mb-4 ${
                    variant.customization.headerStyle === "boxed" ? "border p-4 rounded-lg" : 
                    variant.customization.headerStyle === "underlined" ? "border-b-2" : ""
                  }`}
                  style={{ borderColor: variant.customization.accentColor }}
                >
                  <div className="text-lg font-bold" style={{ color: variant.customization.accentColor }}>
                    Invoice #2024-001
                  </div>
                  <div className="text-sm text-(--color-ink-muted)">December 30, 2024</div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-(--color-ink-subtle)">From</div>
                    <div className="text-sm text-(--color-ink)">Your Company</div>
                    <div className="text-sm text-(--color-ink-muted)">123 Street, City</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-(--color-ink-subtle)">To</div>
                    <div className="text-sm text-(--color-ink)">Customer Name</div>
                    <div className="text-sm text-(--color-ink-muted)">456 Avenue, Town</div>
                  </div>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr 
                      className={`border-b ${
                        variant.customization.tablePadding === "spacious" ? "text-base" : ""
                      }`}
                      style={{ borderColor: variant.customization.accentColor }}
                    >
                      <th className={`text-left ${
                        variant.customization.tablePadding === "compact" ? "py-1" :
                        variant.customization.tablePadding === "spacious" ? "py-3" : "py-2"
                      }`}>Description</th>
                      {variant.customization.showQuantityColumn && <th className="text-right">Qty</th>}
                      {variant.customization.showUnitPriceColumn && <th className="text-right">Price</th>}
                      {variant.customization.showTaxColumn && <th className="text-right">Tax</th>}
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-(--glass-border)">
                      <td className={`${
                        variant.customization.tablePadding === "compact" ? "py-1" :
                        variant.customization.tablePadding === "spacious" ? "py-3" : "py-2"
                      }`}>Consulting Services</td>
                      {variant.customization.showQuantityColumn && <td className="text-right">10</td>}
                      {variant.customization.showUnitPriceColumn && <td className="text-right">€100</td>}
                      {variant.customization.showTaxColumn && <td className="text-right">19%</td>}
                      <td className="text-right">€1,190</td>
                    </tr>
                  </tbody>
                </table>

                <div className="mt-4 text-right">
                  <div className="text-lg font-bold" style={{ color: variant.customization.accentColor }}>
                    Total: €1,190.00
                  </div>
                </div>

                <div 
                  className={`mt-6 pt-4 border-t border-(--glass-border) text-xs text-(--color-ink-muted) ${
                    variant.customization.footerColumns === 1 ? "" :
                    variant.customization.footerColumns === 2 ? "grid grid-cols-2 gap-4" :
                    "grid grid-cols-3 gap-4"
                  }`}
                >
                  <div>Payment terms: 14 days</div>
                  {variant.customization.footerColumns >= 2 && <div>Bank: DE123456789</div>}
                  {variant.customization.footerColumns >= 3 && <div>VAT: DE987654321</div>}
                </div>
              </Surface>
            </Section>
          </div>
        </Grid>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Template Variant"
        description="Are you sure you want to delete this template variant? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
