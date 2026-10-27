"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Choice, Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { InvoiceTemplateId, Language } from "@/lib/domain";
import { createDefaultTextsDe } from "@/lib/defaults";
import { t } from "@/lib/i18n";
import { roundMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { updateSettings } from "@/lib/storage/store";

/** Settings as one 880px form column (Overwatch `FormPage` + `FormSection`); every change is saved immediately. */
export default function SettingsPage() {
  const { adapter, data } = usePersistedData();
  const settings = data?.settings;
  const language = settings?.language ?? "de";
  const de = language === "de";
  const [textsReset, setTextsReset] = useState(false);

  if (!adapter || !settings) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  const layout = settings.defaultLayout;
  const setLayout = (next: Partial<typeof layout>) => updateSettings(adapter, (prev) => ({ ...prev, defaultLayout: { ...prev.defaultLayout, ...next } }));

  return (
    <Page>
      <PageHeader
        title={t(language, "settings.title")}
        description={de ? "Ihre Absenderdaten und Vorgaben für Rechnungen. Jede Änderung wird sofort gespeichert." : "Your sender details and invoice defaults. Every change is saved immediately."}
      />

      <FormPage>
        <FormSection title={t(language, "settings.defaultSender")} description={de ? "Erscheint als Absender auf neuen Rechnungen." : "Printed as sender on new invoices."}>
          <Field label={t(language, "common.name")} className="@md:col-span-2">
            <Input value={settings.defaultSender.name} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, defaultSender: { ...prev.defaultSender, name: e.target.value } }))} />
          </Field>
          <Field label={t(language, "customers.address")}>
            <Textarea rows={3} value={settings.defaultSender.address} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, defaultSender: { ...prev.defaultSender, address: e.target.value } }))} />
          </Field>
          <Field label={t(language, "customers.contact")}>
            <Textarea rows={3} value={settings.defaultSender.contact} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, defaultSender: { ...prev.defaultSender, contact: e.target.value } }))} />
          </Field>
        </FormSection>

        <FormSection title={t(language, "settings.defaults")} description={de ? "Werte, mit denen neue Rechnungen und Positionen starten." : "Values new invoices and line items start with."}>
          <Field label={t(language, "settings.currency")} hint={de ? "Dreistelliger Code, z. B. EUR" : "Three-letter code, e.g. EUR"}>
            <Input value={settings.currency} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label={`${t(language, "settings.defaultTaxRate")} %`} hint={de ? "z. B. 19. Leer lassen für ohne Steuer." : "e.g. 19. Leave empty for no tax."}>
            <DecimalInput
              allowEmpty
              value={settings.defaultTaxRate === undefined ? undefined : roundMoney(settings.defaultTaxRate * 100)}
              onValueChange={(percent) => updateSettings(adapter, (prev) => ({ ...prev, defaultTaxRate: percent === undefined ? undefined : percent / 100 }))}
            />
          </Field>
          <Field label={t(language, "settings.pdfFilenamePattern")} hint={de ? "{invoiceNumber} wird durch die Rechnungsnummer ersetzt." : "{invoiceNumber} is replaced by the invoice number."} className="@md:col-span-2">
            <Input value={settings.pdfFilenamePattern} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, pdfFilenamePattern: e.target.value }))} />
          </Field>
        </FormSection>

        <FormSection title={de ? "Layout neuer Rechnungen" : "Layout of new invoices"}>
          <Field label={t(language, "settings.defaultTemplate")}>
            <Select value={settings.defaultTemplateId} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, defaultTemplateId: e.target.value as InvoiceTemplateId }))}>
              <option value="classic">Classic</option>
              <option value="modern">Modern</option>
              <option value="minimal">Minimal</option>
            </Select>
          </Field>
          <Field label={t(language, "settings.logoPosition")}>
            <Select value={layout.logoPosition} onChange={(e) => setLayout({ logoPosition: e.target.value as typeof layout.logoPosition })}>
              <option value="left">{t(language, "settings.topLeft")}</option>
              <option value="center">{t(language, "settings.topCenter")}</option>
              <option value="right">{t(language, "settings.topRight")}</option>
            </Select>
          </Field>
          <Field label={t(language, "settings.logoSize")}>
            <Select value={layout.logoSize ?? "medium"} onChange={(e) => setLayout({ logoSize: e.target.value as "small" | "medium" | "large" })}>
              <option value="small">{t(language, "settings.small")}</option>
              <option value="medium">{t(language, "settings.medium")}</option>
              <option value="large">{t(language, "settings.large")}</option>
            </Select>
          </Field>
          <Field label={t(language, "settings.senderPosition")}>
            <Select value={layout.senderPosition} onChange={(e) => setLayout({ senderPosition: e.target.value as typeof layout.senderPosition })}>
              <option value="left">{t(language, "settings.left")}</option>
              <option value="right">{t(language, "settings.right")}</option>
            </Select>
          </Field>
          <Field label={t(language, "settings.recipientPosition")}>
            <Select value={layout.recipientPosition} onChange={(e) => setLayout({ recipientPosition: e.target.value as typeof layout.recipientPosition })}>
              <option value="left">{t(language, "settings.left")}</option>
              <option value="right">{t(language, "settings.right")}</option>
            </Select>
          </Field>
          <div className="flex flex-col gap-1 @md:col-span-2">
            <Choice label={t(language, "settings.showLogo")} checked={layout.showLogo} onChange={(e) => setLayout({ showLogo: e.target.checked })} />
            <Choice label={t(language, "settings.showFooter")} checked={layout.showFooter} onChange={(e) => setLayout({ showFooter: e.target.checked })} />
          </div>
        </FormSection>

        <FormSection title={t(language, "settings.defaultLogo")} description={de ? "Wird auf allen Rechnungen ohne eigenes Logo gedruckt." : "Printed on every invoice without its own logo."} columns={1}>
          <Field label={de ? "Bilddatei wählen" : "Choose image file"}>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = reader.result;
                  if (typeof result === "string") updateSettings(adapter, (prev) => ({ ...prev, defaultLogoDataUrl: result }));
                };
                reader.readAsDataURL(file);
              }}
            />
          </Field>
          {settings.defaultLogoDataUrl && (
            <div className="flex flex-wrap items-center gap-4">
              <Image src={settings.defaultLogoDataUrl} alt={t(language, "settings.logoPreview")} width={128} height={64} unoptimized className="h-16 w-auto rounded-md border border-line bg-surface p-1" />
              <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/5" onClick={() => updateSettings(adapter, (prev) => ({ ...prev, defaultLogoDataUrl: undefined }))}>
                {t(language, "settings.removeLogo")}
              </Button>
            </div>
          )}
        </FormSection>

        <FormSection title={t(language, "settings.defaultFooter")} columns={1}>
          <Field label={t(language, "settings.defaultFooter")} hideLabel>
            <Textarea rows={6} value={settings.defaultFooterText} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, defaultFooterText: e.target.value }))} />
          </Field>
        </FormSection>

        <FormSection title={t(language, "settings.invoiceTextDefaults")} description={t(language, "settings.invoiceTextDefaultsDescription")} columns={1}>
          <div className="flex flex-col items-start gap-3">
            <Button onClick={() => { updateSettings(adapter, (prev) => ({ ...prev, defaultTexts: createDefaultTextsDe() })); setTextsReset(true); }}>
              {t(language, "settings.resetGermanDefaults")}
            </Button>
            {textsReset && <StatusNote tone="ok">{de ? "Die deutschen Standardtexte gelten jetzt für neue Rechnungen." : "German default texts now apply to new invoices."}</StatusNote>}
          </div>
        </FormSection>

        <FormSection title={de ? "Sprache" : "Language"} columns={1}>
          <Field label={t(language, "settings.language")}>
            <Select value={settings.language} onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, language: e.target.value as Language }))}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </FormSection>
      </FormPage>
    </Page>
  );
}
