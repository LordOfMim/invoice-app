"use client";

import Link from "next/link";
import { use, useMemo, useState, useSyncExternalStore } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Choice, Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Page, PageHeader, RecordStamp, initialsOf } from "@/components/ui/Layout";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { usePageCrumb } from "@/components/shell/AppShell";
import { t } from "@/lib/i18n";
import { getMailState, getServerMailState, subscribeMail } from "@/lib/mail";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteCustomer, upsertCustomer } from "@/lib/storage/store";
import type { Customer } from "@/lib/domain";

export default function CustomerEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const [showDelete, setShowDelete] = useState(false);
  const mailBox = useSyncExternalStore(subscribeMail, getMailState, getServerMailState);
  const mailReady = mailBox.configured && !mailBox.needsPassword;
  const customer = useMemo(() => data?.customers.find((c) => c.id === id) ?? null, [data?.customers, id]);
  usePageCrumb(customer ? customer.name || t(language, "common.unnamed") : null);

  if (!adapter) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  if (!customer) {
    return (
      <Page>
        <PageHeader title={t(language, "customers.notFound")} />
        <div><Link href="/customers" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{t(language, "customers.back")}</Link></div>
      </Page>
    );
  }

  const save = (next: Customer) => upsertCustomer(adapter, next);

  return (
    <Page>
      <PageHeader
        variant="entity"
        title={customer.name || t(language, "customers.new")}
        initials={initialsOf(customer.name) || "K"}
        description={de ? "Kundendaten werden beim Übernehmen in neue Rechnungen eingesetzt. Änderungen werden automatisch lokal gespeichert." : "Customer details are filled into new invoices. Changes are saved locally automatically."}
        actions={<>
          {mailReady && customer.email?.trim() && <>
            <LinkButton href={`/mail?neu=${encodeURIComponent(customer.email.trim())}`}>E-Mail schreiben</LinkButton>
            <LinkButton variant="ghost" href={`/mail?kontakt=${encodeURIComponent(customer.email.trim())}`}>E-Mails anzeigen</LinkButton>
          </>}
          <Button variant="ghost" className="text-danger-ink hover:bg-danger-tint" onClick={() => setShowDelete(true)}>{de ? "Kunde löschen …" : "Delete customer …"}</Button>
        </>}
      />

      <FormPage>
        <FormSection title={t(language, "customers.basicInfo")}>
          <Field label={t(language, "customers.name")}>
            <Input value={customer.name} onChange={(e) => save({ ...customer, name: e.target.value })} placeholder={de ? "Firma oder Personenname" : "Company or person name"} />
          </Field>
          <Field label={t(language, "customers.salutation")}>
            <Input value={customer.salutation || ""} onChange={(e) => save({ ...customer, salutation: e.target.value })} placeholder="z. B. Sehr geehrte Damen und Herren" />
          </Field>
          <Field label={t(language, "customers.email")}>
            <Input type="email" value={customer.email || ""} onChange={(e) => save({ ...customer, email: e.target.value })} placeholder="name@beispiel.de" />
          </Field>
          <Field label={t(language, "customers.phone")}>
            <Input type="tel" value={customer.phone || ""} onChange={(e) => save({ ...customer, phone: e.target.value })} placeholder="+49 30 1234567" />
          </Field>
          <Field label={t(language, "customers.taxId")}>
            <Input value={customer.taxId || ""} onChange={(e) => save({ ...customer, taxId: e.target.value })} placeholder="DE123456789" />
          </Field>
          <Field label="Leitweg-ID (nur für Behörden)" hint="Für die XRechnung an öffentliche Auftraggeber. Wird in jede neue Rechnung an diesen Kunden übernommen.">
            <Input value={customer.buyerReference || ""} onChange={(e) => save({ ...customer, buyerReference: e.target.value || undefined })} placeholder="z. B. 991-01234-56" />
          </Field>
          <div className="@md:col-span-2">
            <Choice
              label="Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)"
              hint="Für Bauunternehmen, denen Sie Bauleistungen ohne Umsatzsteuer berechnen. Rechnungen und Angebote an diesen Kunden starten ohne Umsatzsteuer und mit dem Pflichthinweis."
              checked={customer.reverseCharge === true}
              onChange={(e) => save({ ...customer, reverseCharge: e.target.checked || undefined })}
            />
          </div>
        </FormSection>

        <FormSection title={t(language, "customers.addressContact")}>
          <Field label={t(language, "customers.address")}>
            <Textarea rows={3} value={customer.address} onChange={(e) => save({ ...customer, address: e.target.value })} placeholder={de ? "Straße, PLZ Ort" : "Street, city, country"} />
          </Field>
          <Field label={t(language, "customers.contact")}>
            <Textarea rows={3} value={customer.contact} onChange={(e) => save({ ...customer, contact: e.target.value })} placeholder={de ? "Ansprechpartner, Abteilung usw." : "Contact person, department, etc."} />
          </Field>
        </FormSection>

        <FormSection title={t(language, "customers.notes")} description={de ? "Nur für Sie. Erscheint nicht auf Rechnungen." : "Only for you. Not printed on invoices."} columns={1}>
          <Field label={t(language, "customers.notes")} hideLabel>
            <Textarea rows={3} value={customer.notes || ""} onChange={(e) => save({ ...customer, notes: e.target.value })} placeholder={de ? "Interne Notizen zu diesem Kunden" : "Internal notes about this customer"} />
          </Field>
        </FormSection>

        <RecordStamp>
          {t(language, "common.created")}: {new Date(customer.createdAt).toLocaleString(de ? "de-DE" : "en-US")}, {t(language, "common.updated")}: {new Date(customer.updatedAt).toLocaleString(de ? "de-DE" : "en-US")}
        </RecordStamp>
      </FormPage>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { deleteCustomer(adapter, id); window.location.assign("/customers"); }}
        title={t(language, "customers.deleteTitle")}
        description={t(language, "customers.deleteDescriptionLong")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
