"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { KeyValueList, Page, PageHeader, RecordStamp, Section } from "@/components/ui/Layout";
import { KindBadge } from "@/components/ui/Status";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { usePageCrumb } from "@/components/shell/AppShell";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteCreditNote, upsertCreditNote } from "@/lib/storage/store";
import type { CreditNote } from "@/lib/domain";

export default function CreditNoteEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const [showDelete, setShowDelete] = useState(false);
  const creditNote = useMemo(() => data?.creditNotes.find((cn) => cn.id === id) ?? null, [data?.creditNotes, id]);
  usePageCrumb(creditNote ? creditNote.creditNoteNumber || t(language, "common.noNumber") : null);

  if (!adapter) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  if (!creditNote) {
    return (
      <Page>
        <PageHeader title={t(language, "creditNotes.notFound")} />
        <div><Link href="/credit-notes" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{t(language, "creditNotes.back")}</Link></div>
      </Page>
    );
  }

  const save = (next: CreditNote) => upsertCreditNote(adapter, next);
  const kind = creditNote.type === "storno" ? t(language, "creditNotes.storno") : t(language, "creditNotes.gutschrift");

  return (
    <Page>
      <PageHeader
        variant="entity"
        title={`${creditNote.texts.documentTitle} ${creditNote.creditNoteNumber}`.trim()}
        initials={creditNote.type === "storno" ? "ST" : "GS"}
        status={<KindBadge>{kind}</KindBadge>}
        description={`${t(language, "creditNotes.linkedInvoice")}: ${creditNote.linkedInvoiceNumber || t(language, "common.unknown")}`}
        actions={<>
          <LinkButton href={`/invoices/${creditNote.linkedInvoiceId}`}>{t(language, "actions.viewOriginalInvoice")}</LinkButton>
          <Button variant="ghost" className="text-danger hover:bg-danger/5" onClick={() => setShowDelete(true)}>{de ? "Löschen …" : "Delete …"}</Button>
        </>}
      />

      <FormPage>
        <FormSection title={t(language, "creditNotes.details")} description={de ? "Änderungen werden automatisch lokal gespeichert." : "Changes are saved locally automatically."} columns={3}>
          <Field label={creditNote.texts.creditNoteNumberLabel}>
            <Input value={creditNote.creditNoteNumber} onChange={(e) => save({ ...creditNote, creditNoteNumber: e.target.value })} placeholder="GS-2026-001" />
          </Field>
          <Field label={creditNote.texts.creditNoteDateLabel}>
            <Input type="date" value={creditNote.creditNoteDate} onChange={(e) => save({ ...creditNote, creditNoteDate: e.target.value })} />
          </Field>
          <Field label={creditNote.texts.amountLabel} hint={de ? "Mit Komma, z. B. 120,50" : "e.g. 120.50"}>
            <DecimalInput value={creditNote.amount} onValueChange={(amount) => save({ ...creditNote, amount: Math.max(0, amount ?? 0) })} />
          </Field>
          <Field label={creditNote.texts.reasonLabel} className="@md:col-span-2 @2xl:col-span-3">
            <Textarea rows={3} value={creditNote.reason} onChange={(e) => save({ ...creditNote, reason: e.target.value })} placeholder={de ? "Grund für diese Gutschrift oder diesen Storno" : "Reason for this credit note or cancellation"} />
          </Field>
        </FormSection>

        <Section title={t(language, "creditNotes.recipientFromInvoice")} summary={de ? "Aus der ursprünglichen Rechnung übernommen." : "Taken from the original invoice."}>
          <KeyValueList
            variant="leader"
            items={[
              { label: de ? "Name" : "Name", value: creditNote.recipient.name || "–" },
              { label: de ? "Adresse" : "Address", value: <span className="whitespace-pre-line">{creditNote.recipient.address || "–"}</span> },
              { label: de ? "Kontakt" : "Contact", value: <span className="whitespace-pre-line">{creditNote.recipient.contact || "–"}</span> },
            ]}
          />
        </Section>

        <FormSection title={creditNote.texts.footerHeading} columns={1}>
          <Field label={creditNote.texts.footerHeading} hideLabel>
            <Textarea rows={4} value={creditNote.footerText} onChange={(e) => save({ ...creditNote, footerText: e.target.value })} />
          </Field>
        </FormSection>

        <RecordStamp>
          {t(language, "common.created")}: {new Date(creditNote.createdAt).toLocaleString(de ? "de-DE" : "en-US")} · {t(language, "common.updated")}: {new Date(creditNote.updatedAt).toLocaleString(de ? "de-DE" : "en-US")}
        </RecordStamp>
      </FormPage>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { deleteCreditNote(adapter, id); window.location.assign("/credit-notes"); }}
        title={t(language, "creditNotes.deleteTitle")}
        description={t(language, "creditNotes.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
