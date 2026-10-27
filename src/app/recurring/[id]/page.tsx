"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Choice, Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Card, CardZone, Page, PageHeader, RecordStamp, initialsOf } from "@/components/ui/Layout";
import { StatusPill } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { usePageCrumb } from "@/components/shell/AppShell";
import { t } from "@/lib/i18n";
import { formatDateOnly } from "@/lib/date";
import { roundMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteRecurringInvoice, generateInvoiceFromRecurring, listCustomers, upsertRecurringInvoice } from "@/lib/storage/store";
import { createDefaultLineItem } from "@/lib/defaults";
import type { RecurringInvoice, RecurringFrequency } from "@/lib/domain";

export default function RecurringEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const [showDelete, setShowDelete] = useState(false);
  const recurring = useMemo(() => data?.recurringInvoices.find((ri) => ri.id === id) ?? null, [data?.recurringInvoices, id]);
  usePageCrumb(recurring ? recurring.name || t(language, "common.unnamed") : null);
  const customers = adapter ? listCustomers(adapter) : [];

  if (!adapter) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  if (!recurring) {
    return (
      <Page>
        <PageHeader title={t(language, "recurring.notFound")} />
        <div><Link href="/recurring" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{t(language, "recurring.back")}</Link></div>
      </Page>
    );
  }

  const save = (next: RecurringInvoice) => upsertRecurringInvoice(adapter, next);
  const updateLine = (lineId: string, patch: Partial<RecurringInvoice["lineItems"][number]>) =>
    save({ ...recurring, lineItems: recurring.lineItems.map((x) => (x.id === lineId ? { ...x, ...patch } : x)) });

  const handleGenerate = () => {
    const invoice = generateInvoiceFromRecurring(adapter, id, recurring.nextRunDate);
    if (invoice) window.location.assign(`/invoices/${invoice.id}`);
  };

  const handleSelectCustomer = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    save({ ...recurring, customerId, recipient: { name: customer.name, address: customer.address, contact: customer.contact } });
  };

  return (
    <Page>
      <PageHeader
        variant="entity"
        title={recurring.name || t(language, "recurring.new")}
        initials={initialsOf(recurring.name) || "WR"}
        status={recurring.active ? <StatusPill tone="success">{t(language, "recurring.active")}</StatusPill> : <StatusPill tone="muted">{t(language, "recurring.paused")}</StatusPill>}
        description={`${t(language, "recurring.nextRun")}: ${formatDateOnly(recurring.nextRunDate, locale)}`}
        actions={<>
          <Button variant="primary" onClick={handleGenerate}>{de ? "Rechnung jetzt erstellen" : "Create invoice now"}</Button>
          <Button variant="ghost" className="text-danger hover:bg-danger/5" onClick={() => setShowDelete(true)}>{de ? "Löschen …" : "Delete …"}</Button>
        </>}
      />

      <FormPage>
        <FormSection title={t(language, "recurring.settings")} description={de ? "Wann und wie oft eine neue Rechnung entsteht. Jede Änderung wird sofort gespeichert." : "When and how often a new invoice is created. Every change is saved immediately."}>
          <Field label={t(language, "recurring.name")}>
            <Input value={recurring.name} onChange={(e) => save({ ...recurring, name: e.target.value })} placeholder={de ? "z. B. Monatliche Wartung, Kunde A" : "e.g. Monthly retainer, client A"} />
          </Field>
          <Field label={t(language, "recurring.frequency")}>
            <Select value={recurring.frequency} onChange={(e) => save({ ...recurring, frequency: e.target.value as RecurringFrequency })}>
              <option value="monthly">{t(language, "recurring.monthly")}</option>
              <option value="quarterly">{t(language, "recurring.quarterly")}</option>
              <option value="yearly">{t(language, "recurring.yearly")}</option>
            </Select>
          </Field>
          <Field label={t(language, "recurring.nextRun")}>
            <Input type="date" value={recurring.nextRunDate} onChange={(e) => save({ ...recurring, nextRunDate: e.target.value })} />
          </Field>
          <Field label={t(language, "recurring.reminder")} hint={t(language, "recurring.daysBeforeNextRun")}>
            <Input type="number" min="0" value={String(recurring.reminderDays)} onChange={(e) => save({ ...recurring, reminderDays: parseInt(e.target.value) || 0 })} />
          </Field>
          <div className="flex flex-col gap-1 @md:col-span-2">
            <Choice label={t(language, "recurring.active")} checked={recurring.active} onChange={(e) => save({ ...recurring, active: e.target.checked })} />
            <Choice label={t(language, "recurring.autoGenerate")} checked={recurring.autoGenerate} onChange={(e) => save({ ...recurring, autoGenerate: e.target.checked })} />
          </div>
        </FormSection>

        <FormSection title={recurring.texts.recipientHeading}>
          {customers.length > 0 && (
            <Field label={de ? "Aus Kundenliste übernehmen" : "Fill from customer list"} className="@md:col-span-2">
              <Select value={recurring.customerId || ""} onChange={(e) => handleSelectCustomer(e.target.value)}>
                <option value="">{t(language, "actions.selectCustomer")} …</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label={t(language, "common.name")} className="@md:col-span-2">
            <Input value={recurring.recipient.name} onChange={(e) => save({ ...recurring, recipient: { ...recurring.recipient, name: e.target.value } })} />
          </Field>
          <Field label={t(language, "customers.address")}>
            <Textarea rows={3} value={recurring.recipient.address} onChange={(e) => save({ ...recurring, recipient: { ...recurring.recipient, address: e.target.value } })} />
          </Field>
          <Field label={t(language, "customers.contact")}>
            <Textarea rows={3} value={recurring.recipient.contact} onChange={(e) => save({ ...recurring, recipient: { ...recurring.recipient, contact: e.target.value } })} />
          </Field>
        </FormSection>

        <FormSection title={de ? "Positionen" : "Line items"} description={de ? "Mengen und Preise mit Komma eingeben, z. B. 12,50." : "Enter quantities and prices with a comma or dot."} columns={1}>
          <Card>
            {recurring.lineItems.length === 0 && (
              <CardZone><p className="font-sans text-lg tracking-snug text-ink-muted">{de ? "Noch keine Positionen." : "No line items yet."}</p></CardZone>
            )}
            {recurring.lineItems.map((li, idx) => (
              <CardZone key={li.id} className="@container">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="w-7 shrink-0 pt-9 font-mono text-sm font-medium tracking-loose text-ink-muted tabular-nums">{String(idx + 1).padStart(2, "0")}</span>
                  <div className="grid min-w-0 flex-1 gap-3 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                    <Field label={de ? "Beschreibung" : "Description"}>
                      <Textarea rows={2} value={li.description} onChange={(e) => updateLine(li.id, { description: e.target.value })} />
                    </Field>
                    <Field label={de ? "Menge" : "Quantity"}>
                      <DecimalInput value={li.quantity} onValueChange={(quantity) => updateLine(li.id, { quantity: quantity ?? 0 })} />
                    </Field>
                    <Field label={de ? "Einzelpreis" : "Unit price"}>
                      <DecimalInput value={li.unitPrice} onValueChange={(unitPrice) => updateLine(li.id, { unitPrice: unitPrice ?? 0 })} />
                    </Field>
                    <Field label={de ? "MwSt. %" : "Tax %"}>
                      <DecimalInput allowEmpty value={li.taxRate === undefined ? undefined : roundMoney(li.taxRate * 100)} onValueChange={(percent) => updateLine(li.id, { taxRate: percent === undefined ? undefined : percent / 100 })} />
                    </Field>
                  </div>
                  <div className="shrink-0 pt-7">
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/5" aria-label={de ? `Position ${idx + 1} entfernen` : `Remove line ${idx + 1}`} onClick={() => save({ ...recurring, lineItems: recurring.lineItems.filter((x) => x.id !== li.id) })}>
                      {t(language, "actions.remove")}
                    </Button>
                  </div>
                </div>
              </CardZone>
            ))}
          </Card>
          <div>
            <Button onClick={() => save({ ...recurring, lineItems: [...recurring.lineItems, createDefaultLineItem(data?.settings.defaultTaxRate)] })}>{de ? "Position hinzufügen" : "Add line item"}</Button>
          </div>
        </FormSection>

        <FormSection title={recurring.texts.footerHeading} columns={1}>
          <Field label={recurring.texts.footerHeading} hideLabel>
            <Textarea rows={4} value={recurring.footerText} onChange={(e) => save({ ...recurring, footerText: e.target.value })} />
          </Field>
        </FormSection>

        <RecordStamp>
          {t(language, "common.created")}: {new Date(recurring.createdAt).toLocaleString(locale)} · {t(language, "common.updated")}: {new Date(recurring.updatedAt).toLocaleString(locale)}
        </RecordStamp>
      </FormPage>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { deleteRecurringInvoice(adapter, id); window.location.assign("/recurring"); }}
        title={t(language, "recurring.deleteTitle")}
        description={t(language, "recurring.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
