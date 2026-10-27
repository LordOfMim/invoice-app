"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Choice, Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Page, PageHeader, RecordStamp, Section, initialsOf } from "@/components/ui/Layout";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { usePageCrumb } from "@/components/shell/AppShell";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteTemplateVariant, upsertTemplateVariant } from "@/lib/storage/store";
import type { TemplateVariant, TemplateCustomization, InvoiceTemplateId } from "@/lib/domain";

export default function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const [showDelete, setShowDelete] = useState(false);
  const variant = useMemo(() => data?.templateVariants.find((tv) => tv.id === id) ?? null, [data?.templateVariants, id]);
  usePageCrumb(variant ? variant.name || t(language, "common.unnamed") : null);

  if (!adapter) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  if (!variant) {
    return (
      <Page>
        <PageHeader title={t(language, "templates.notFound")} />
        <div><Link href="/templates" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{t(language, "templates.back")}</Link></div>
      </Page>
    );
  }

  const save = (next: TemplateVariant) => upsertTemplateVariant(adapter, next);
  const updateCustomization = (updates: Partial<TemplateCustomization>) => save({ ...variant, customization: { ...variant.customization, ...updates } });
  const c = variant.customization;
  const cellPadding = c.tablePadding === "compact" ? "py-1" : c.tablePadding === "spacious" ? "py-3" : "py-2";

  return (
    <Page>
      <PageHeader
        variant="entity"
        title={variant.name || t(language, "templates.new")}
        initials={initialsOf(variant.name) || "V"}
        description={de ? `Variante der Vorlage ${variant.baseTemplateId}. Jede Änderung wird sofort gespeichert.` : `Variant of the ${variant.baseTemplateId} template. Every change is saved immediately.`}
        actions={<Button variant="ghost" className="text-danger hover:bg-danger/5" onClick={() => setShowDelete(true)}>{de ? "Variante löschen …" : "Delete variant …"}</Button>}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-10">
          <FormSection title={t(language, "templates.basicSettings")} columns={1}>
            <Field label={t(language, "templates.variantName")}>
              <Input value={variant.name} onChange={(e) => save({ ...variant, name: e.target.value })} placeholder={de ? "z. B. Modern mit Logo links" : "e.g. Modern with logo left"} />
            </Field>
            <Field label={t(language, "templates.baseTemplate")}>
              <Select value={variant.baseTemplateId} onChange={(e) => save({ ...variant, baseTemplateId: e.target.value as InvoiceTemplateId })}>
                <option value="classic">Classic</option>
                <option value="modern">Modern</option>
                <option value="minimal">Minimal</option>
              </Select>
            </Field>
          </FormSection>

          <FormSection title={t(language, "templates.typography")} columns={1}>
            <Field label={`${t(language, "templates.fontSizeScale")}: ${(c.fontSizeScale * 100).toFixed(0)} %`}>
              <input type="range" min="0.8" max="1.2" step="0.05" value={c.fontSizeScale} onChange={(e) => updateCustomization({ fontSizeScale: parseFloat(e.target.value) })} className="h-10 w-full accent-accent-blue" />
            </Field>
            <Field label={`${t(language, "templates.lineSpacing")}: ${c.lineSpacing.toFixed(1)}`}>
              <input type="range" min="1" max="2" step="0.1" value={c.lineSpacing} onChange={(e) => updateCustomization({ lineSpacing: parseFloat(e.target.value) })} className="h-10 w-full accent-accent-blue" />
            </Field>
          </FormSection>

          <FormSection title={t(language, "templates.tableSettings")} columns={1}>
            <Field label={t(language, "templates.tablePadding")}>
              <Select value={c.tablePadding} onChange={(e) => updateCustomization({ tablePadding: e.target.value as "compact" | "normal" | "spacious" })}>
                <option value="compact">{t(language, "templates.compact")}</option>
                <option value="normal">{t(language, "templates.normal")}</option>
                <option value="spacious">{t(language, "templates.spacious")}</option>
              </Select>
            </Field>
            <div className="flex flex-col gap-1">
              <Choice label={t(language, "templates.showQuantityColumn")} checked={c.showQuantityColumn} onChange={(e) => updateCustomization({ showQuantityColumn: e.target.checked })} />
              <Choice label={t(language, "templates.showUnitPriceColumn")} checked={c.showUnitPriceColumn} onChange={(e) => updateCustomization({ showUnitPriceColumn: e.target.checked })} />
              <Choice label={t(language, "templates.showTaxColumn")} checked={c.showTaxColumn} onChange={(e) => updateCustomization({ showTaxColumn: e.target.checked })} />
            </div>
          </FormSection>

          <FormSection title={t(language, "templates.headerStyle")} columns={1}>
            <Field label={t(language, "templates.headerStyle")} hideLabel>
              <Select value={c.headerStyle} onChange={(e) => updateCustomization({ headerStyle: e.target.value as "simple" | "boxed" | "underlined" })}>
                <option value="simple">{t(language, "templates.simple")}</option>
                <option value="boxed">{t(language, "templates.boxed")}</option>
                <option value="underlined">{t(language, "templates.underlined")}</option>
              </Select>
            </Field>
          </FormSection>

          <RecordStamp>
            {t(language, "common.created")}: {new Date(variant.createdAt).toLocaleString(locale)} · {t(language, "common.updated")}: {new Date(variant.updatedAt).toLocaleString(locale)}
          </RecordStamp>
        </div>

        {/* Schematic sample of the variant settings; the real document preview lives in the invoice. */}
        <Section title={t(language, "templates.preview")} summary={de ? "Schematische Probe. Das echte Dokument sehen Sie in der Rechnung unter „Vorschau“." : "Schematic sample. See the real document in an invoice under “Preview”."} className="lg:sticky lg:top-20">
          <div className="rounded-card-sm border border-line bg-surface p-6 text-ink" style={{ fontSize: `${c.fontSizeScale * 100}%`, lineHeight: c.lineSpacing }}>
            <div className={`mb-4 pb-4 ${c.headerStyle === "boxed" ? "rounded-lg border p-4" : c.headerStyle === "underlined" ? "border-b-2" : "border-b"}`} style={{ borderColor: c.accentColor }}>
              <div className="font-semibold" style={{ color: c.accentColor, fontSize: "1.15em" }}>{de ? "Rechnung" : "Invoice"} RE-2026-001</div>
              <div className="text-ink-muted" style={{ fontSize: "0.9em" }}>27.10.2026</div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-4" style={{ fontSize: "0.9em" }}>
              <div>
                <div className="font-mono text-xs font-medium tracking-caps text-ink-muted uppercase">{t(language, "common.from")}</div>
                <div>{de ? "Ihre Firma" : "Your company"}</div>
                <div className="text-ink-muted">{de ? "Musterstraße 1, Musterstadt" : "1 Sample Street, Sample Town"}</div>
              </div>
              <div>
                <div className="font-mono text-xs font-medium tracking-caps text-ink-muted uppercase">{t(language, "common.to")}</div>
                <div>{de ? "Beispielkunde" : "Sample customer"}</div>
                <div className="text-ink-muted">{de ? "Beispielweg 2, Beispielort" : "2 Example Road, Example City"}</div>
              </div>
            </div>
            <table className="w-full" style={{ fontSize: "0.9em" }}>
              <thead>
                <tr className="border-b" style={{ borderColor: c.accentColor }}>
                  <th className={`text-left font-semibold ${cellPadding}`}>{de ? "Beschreibung" : "Description"}</th>
                  {c.showQuantityColumn && <th className="text-right font-semibold">{de ? "Menge" : "Qty"}</th>}
                  {c.showUnitPriceColumn && <th className="text-right font-semibold">{de ? "Preis" : "Price"}</th>}
                  {c.showTaxColumn && <th className="text-right font-semibold">{de ? "MwSt." : "Tax"}</th>}
                  <th className="text-right font-semibold">{de ? "Gesamt" : "Total"}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className={cellPadding}>{de ? "Beispielleistung" : "Sample service"}</td>
                  {c.showQuantityColumn && <td className="text-right tabular-nums">10</td>}
                  {c.showUnitPriceColumn && <td className="text-right tabular-nums">100,00 €</td>}
                  {c.showTaxColumn && <td className="text-right tabular-nums">19 %</td>}
                  <td className="text-right tabular-nums">1.190,00 €</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-4 text-right font-semibold" style={{ color: c.accentColor }}>{de ? "Gesamt" : "Total"}: 1.190,00 €</div>
            <div className={`mt-6 border-t border-line pt-4 text-ink-muted ${c.footerColumns === 2 ? "grid grid-cols-2 gap-4" : c.footerColumns === 3 ? "grid grid-cols-3 gap-4" : ""}`} style={{ fontSize: "0.8em" }}>
              <div>{de ? "Zahlungsziel: 14 Tage" : "Payment terms: 14 days"}</div>
              {c.footerColumns >= 2 && <div>{de ? "Bank: DE00 0000 0000" : "Bank: DE00 0000 0000"}</div>}
              {c.footerColumns >= 3 && <div>{de ? "USt-IdNr.: DE000000000" : "VAT: DE000000000"}</div>}
            </div>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { deleteTemplateVariant(adapter, id); window.location.assign("/templates"); }}
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
