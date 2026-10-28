"use client";

import { Button } from "@/components/ui/Button";
import { Choice, Field } from "@/components/ui/Field";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Card, CardZone } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { Attachment, Invoice, InvoiceTemplateId, InvoiceTexts, Language, LayoutPreferences, LogoPosition, Tag, TemplateVariant } from "@/lib/domain";
import { t } from "@/lib/i18n";
import { removeAttachmentFromInvoice } from "@/lib/storage/store";
import { fieldId } from "./fields";

const CURRENCIES = [
  { code: "EUR", symbol: "€", en: "Euro", de: "Euro" },
  { code: "USD", symbol: "$", en: "US Dollar", de: "US-Dollar" },
  { code: "GBP", symbol: "£", en: "British Pound", de: "Britisches Pfund" },
  { code: "CHF", symbol: "CHF", en: "Swiss Franc", de: "Schweizer Franken" },
  { code: "JPY", symbol: "¥", en: "Japanese Yen", de: "Japanischer Yen" },
  { code: "CAD", symbol: "C$", en: "Canadian Dollar", de: "Kanadischer Dollar" },
  { code: "AUD", symbol: "A$", en: "Australian Dollar", de: "Australischer Dollar" },
  { code: "CNY", symbol: "¥", en: "Chinese Yuan", de: "Chinesischer Yuan" },
  { code: "INR", symbol: "₹", en: "Indian Rupee", de: "Indische Rupie" },
  { code: "BRL", symbol: "R$", en: "Brazilian Real", de: "Brasilianischer Real" },
];

const TEXT_FIELDS: Array<[keyof InvoiceTexts, string]> = [
  ["documentTitle", "Dokumenttitel"],
  ["senderHeading", "Überschrift Absender"],
  ["recipientHeading", "Überschrift Empfänger"],
  ["invoiceNumberLabel", "Bezeichnung Rechnungsnummer"],
  ["invoiceDateLabel", "Bezeichnung Rechnungsdatum"],
  ["dueDateLabel", "Bezeichnung Fällig am"],
  ["itemsDescriptionLabel", "Spalte Beschreibung"],
  ["itemsQuantityLabel", "Spalte Menge"],
  ["itemsUnitPriceLabel", "Spalte Einzelpreis"],
  ["itemsTaxRateLabel", "Spalte MwSt."],
  ["itemsLineTotalLabel", "Spalte Summe"],
  ["subtotalLabel", "Bezeichnung Zwischensumme"],
  ["taxTotalLabel", "Bezeichnung Steuer"],
  ["totalLabel", "Bezeichnung Gesamt"],
  ["notesHeading", "Überschrift Hinweise"],
  ["footerHeading", "Überschrift Fußzeile (ältere Rechnungen)"],
];

/** Readable sizes for stored files. */
function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * „Gestaltung und mehr“: everything that shapes the document or is needed only now and then. Layout, logo, footer,
 * printed labels, currency, tags and attachments; grouped as FormSections in one 880px column.
 */
export function ExtrasTab({
  invoice,
  templateVariants,
  tags,
  language,
  locale,
  errors,
  save,
}: {
  invoice: Invoice;
  templateVariants: TemplateVariant[];
  tags: Tag[];
  language: Language;
  locale: string;
  errors: Record<string, string>;
  save: (next: Invoice | ((prev: Invoice) => Invoice)) => void;
}) {
  const de = language === "de";
  const setLayout = (next: Partial<LayoutPreferences>) => save((prev) => ({ ...prev, layout: { ...prev.layout, ...next } }));
  const assigned = invoice.tagIds ?? [];

  const addAttachments = (files: FileList) => {
    const attachments: Attachment[] = [];
    let remainingFiles = files.length;
    const finish = () => {
      if (remainingFiles === 0 && attachments.length > 0) {
        save((prev) => ({ ...prev, attachments: [...(prev.attachments ?? []), ...attachments] }));
      }
    };
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        remainingFiles -= 1;
        if (typeof dataUrl === "string") {
          attachments.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, dataUrl, createdAt: new Date().toISOString() });
        }
        finish();
      };
      reader.onerror = () => {
        remainingFiles -= 1;
        finish();
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <FormPage>
      <FormSection id="layout" title={de ? "Vorlage und Logo" : "Template and logo"} description={de ? "So sieht das Dokument aus. Die Änderung ist sofort in der Vorschau zu sehen." : "How the document looks. Changes show in the preview right away."}>
        <Field label={t(language, "settings.defaultTemplate")}>
          <Select value={invoice.layout.templateId} onChange={(e) => setLayout({ templateId: e.target.value as InvoiceTemplateId, templateVariantId: undefined })}>
            <option value="classic">Classic</option>
            <option value="modern">Modern</option>
            <option value="minimal">Minimal</option>
          </Select>
        </Field>
        {templateVariants.length > 0 && (
          <Field label={de ? "Variante" : "Variant"}>
            <Select
              value={invoice.layout.templateVariantId || ""}
              onChange={(e) => {
                const variant = templateVariants.find((v) => v.id === (e.target.value || undefined));
                if (variant) setLayout({ templateId: variant.baseTemplateId, templateVariantId: variant.id, customization: variant.customization });
                else setLayout({ templateVariantId: undefined, customization: undefined });
              }}
            >
              <option value="">{de ? "Keine Variante" : "No variant"}</option>
              {templateVariants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.baseTemplateId})</option>)}
            </Select>
          </Field>
        )}
        <Field label={de ? "Absender steht" : "Sender position"}>
          <Select value={invoice.layout.senderPosition} onChange={(e) => setLayout({ senderPosition: e.target.value as LayoutPreferences["senderPosition"] })}>
            <option value="left">{t(language, "settings.left")}</option>
            <option value="right">{t(language, "settings.right")}</option>
          </Select>
        </Field>
        <Field label={de ? "Empfänger steht" : "Recipient position"}>
          <Select value={invoice.layout.recipientPosition} onChange={(e) => setLayout({ recipientPosition: e.target.value as LayoutPreferences["recipientPosition"] })}>
            <option value="left">{t(language, "settings.left")}</option>
            <option value="right">{t(language, "settings.right")}</option>
          </Select>
        </Field>
        <div className="flex flex-col gap-1 @md:col-span-2">
          <Choice label={de ? "Logo anzeigen" : "Show logo"} checked={invoice.layout.showLogo} onChange={(e) => setLayout({ showLogo: e.target.checked })} />
          <Choice label={de ? "Fußzeile anzeigen" : "Show footer"} checked={invoice.layout.showFooter} onChange={(e) => setLayout({ showFooter: e.target.checked })} />
        </div>
        {invoice.layout.showLogo && (
          <>
            <Field label={t(language, "settings.logoPosition")}>
              <Select value={invoice.layout.logoPosition} onChange={(e) => setLayout({ logoPosition: e.target.value as LogoPosition })}>
                <option value="left">{t(language, "settings.topLeft")}</option>
                <option value="center">{t(language, "settings.topCenter")}</option>
                <option value="right">{t(language, "settings.topRight")}</option>
              </Select>
            </Field>
            <Field label={de ? "Logo-Größe" : "Logo size"}>
              <Select value={invoice.layout.logoSize ?? "medium"} onChange={(e) => setLayout({ logoSize: e.target.value as "small" | "medium" | "large" })}>
                <option value="small">{t(language, "settings.small")}</option>
                <option value="medium">{t(language, "settings.medium")}</option>
                <option value="large">{t(language, "settings.large")}</option>
              </Select>
            </Field>
          </>
        )}
        <Field label={de ? "Eigenes Logo nur für diese Rechnung (optional)" : "Logo for this invoice only (optional)"} hint={de ? "Ohne eigenes Logo wird das Logo aus den Einstellungen verwendet." : "Without one, the logo from the settings is used."} className="@md:col-span-2">
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === "string") save((prev) => ({ ...prev, logoDataUrl: reader.result as string }));
              };
              reader.readAsDataURL(file);
            }}
          />
        </Field>
        {invoice.logoDataUrl && (
          <div className="@md:col-span-2">
            <Button size="sm" onClick={() => save({ ...invoice, logoDataUrl: undefined })}>{de ? "Eigenes Logo entfernen" : "Remove invoice logo"}</Button>
          </div>
        )}
      </FormSection>

      <FormSection id="fusszeile" title={de ? "Fußzeile" : "Footer"} description={de ? "Kleine Fußzeile am Seitenende, links und rechts aufgeteilt." : "Small footer at the bottom of each page, split left and right."}>
        <Field label={de ? "Links" : "Left"}>
          <Textarea rows={4} value={invoice.footerLeftText || ""} placeholder={de ? "z. B. Bankverbindung, IBAN, BIC" : "e.g. bank details"} onChange={(e) => save({ ...invoice, footerLeftText: e.target.value })} />
        </Field>
        <Field label={de ? "Rechts" : "Right"}>
          <Textarea rows={4} value={invoice.footerRightText || ""} placeholder={de ? "z. B. Steuernummer, USt-IdNr., Handelsregister" : "e.g. tax number, VAT ID"} onChange={(e) => save({ ...invoice, footerRightText: e.target.value })} />
        </Field>
      </FormSection>

      <FormSection id="texte" title={de ? "Texte auf der Rechnung" : "Texts on the invoice"} description={de ? "Alle Überschriften und Bezeichnungen, die auf dem Dokument stehen." : "All headings and labels printed on the document."}>
        {TEXT_FIELDS.map(([key, label]) => (
          <Field key={key} label={label}>
            <Input value={invoice.texts[key] ?? ""} onChange={(e) => save((prev) => ({ ...prev, texts: { ...prev.texts, [key]: e.target.value } }))} />
          </Field>
        ))}
      </FormSection>

      <FormSection id="waehrung" title={t(language, "invoices.currency")} description={t(language, "invoices.multiCurrencyNote")}>
        <Field label={t(language, "invoices.currency")} id={fieldId("currency")} error={errors.currency}>
          <Select value={invoice.currency ?? "EUR"} onChange={(e) => save({ ...invoice, currency: e.target.value })}>
            {CURRENCIES.map((cur) => <option key={cur.code} value={cur.code}>{cur.code} ({cur.symbol}) · {de ? cur.de : cur.en}</option>)}
          </Select>
        </Field>
        {invoice.currency && invoice.currency !== "EUR" && (
          <>
            <Field label={t(language, "invoices.exchangeRate")}>
              <DecimalInput value={invoice.exchangeRate ?? 1} onValueChange={(exchangeRate) => save({ ...invoice, exchangeRate: exchangeRate ?? 1 })} />
            </Field>
            <Field label={t(language, "invoices.exchangeRateNote")} className="@md:col-span-2">
              <Input value={invoice.exchangeRateNote ?? ""} placeholder={`z. B. 1 ${invoice.currency} = ${invoice.exchangeRate ?? 1} EUR`} onChange={(e) => save({ ...invoice, exchangeRateNote: e.target.value })} />
            </Field>
          </>
        )}
      </FormSection>

      <FormSection id="schlagwoerter" title={de ? "Schlagwörter" : "Tags"} description={t(language, "tags.assignToInvoice")} columns={1}>
        {assigned.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {assigned.map((tagId) => {
              const tag = tags.find((entry) => entry.id === tagId);
              if (!tag) return null;
              return (
                <li key={tag.id} className="inline-flex h-8 items-center gap-2 rounded-pill border border-line-control bg-surface pr-1 pl-3 font-sans text-base font-medium tracking-snug text-ink">
                  <span aria-hidden className="size-2.5 rounded-pill" style={{ backgroundColor: tag.color }} />
                  {tag.name || t(language, "common.unnamed")}
                  <button
                    type="button"
                    aria-label={de ? `Schlagwort ${tag.name} entfernen` : `Remove tag ${tag.name}`}
                    className="inline-flex h-6 items-center rounded-pill px-2 text-ink-muted outline-none hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => save({ ...invoice, tagIds: assigned.filter((id) => id !== tagId) })}
                  >
                    {de ? "Entfernen" : "Remove"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {tags.length === 0 ? (
          <p className="font-sans text-base tracking-snug text-ink-muted">{de ? "Noch keine Schlagwörter. Sie legen sie unter Verwaltung › Schlagwörter an." : "No tags yet. Create them under Administration › Tags."}</p>
        ) : (
          <Field label={t(language, "tags.addTag")} className="max-w-sm">
            <Select value="" onChange={(e) => { const tagId = e.target.value; if (tagId && !assigned.includes(tagId)) save({ ...invoice, tagIds: [...assigned, tagId] }); }}>
              <option value="">{t(language, "tags.addTag")} …</option>
              {tags.filter((tag) => !assigned.includes(tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </Select>
          </Field>
        )}
      </FormSection>

      <FormSection id="anhaenge" title={t(language, "invoices.attachments")} description={t(language, "invoices.attachmentsNote")} columns={1}>
        {(invoice.attachments ?? []).length > 0 && (
          <Card>
            {(invoice.attachments ?? []).map((attachment) => (
              <CardZone key={attachment.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-sans text-lg font-medium tracking-snug text-ink">{attachment.name}</div>
                  <div className="font-sans text-base tracking-snug text-ink-muted tabular-nums">{fileSize(attachment.size)} · {new Date(attachment.createdAt).toLocaleDateString(locale)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {attachment.dataUrl && (
                    <a href={attachment.dataUrl} download={attachment.name} className="inline-flex h-8 items-center rounded-md border border-line-control px-3 font-sans text-base font-medium tracking-snug text-ink-secondary outline-none hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-ring/50">
                      {de ? "Herunterladen" : "Download"}
                    </a>
                  )}
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/5" aria-label={de ? `Anhang ${attachment.name} entfernen` : `Remove attachment ${attachment.name}`} onClick={() => save(removeAttachmentFromInvoice(invoice, attachment.id))}>
                    {t(language, "actions.remove")}
                  </Button>
                </div>
              </CardZone>
            ))}
          </Card>
        )}
        <Field label={de ? "Dateien hinzufügen" : "Add files"}>
          <Input type="file" multiple onChange={(e) => { if (e.target.files) addAttachments(e.target.files); e.target.value = ""; }} />
        </Field>
      </FormSection>
    </FormPage>
  );
}
