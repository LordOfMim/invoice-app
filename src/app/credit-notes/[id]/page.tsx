"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Surface, PageHeader, Stack, Section, Grid } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/DataDisplay";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteCreditNote, upsertCreditNote } from "@/lib/storage/store";
import type { CreditNote } from "@/lib/domain";

function parseNumber(input: string): number {
  const normalized = input.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export default function CreditNoteEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [showDelete, setShowDelete] = useState(false);

  const creditNote = useMemo(() => {
    return data?.creditNotes.find((cn) => cn.id === id) ?? null;
  }, [data?.creditNotes, id]);

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

  if (!creditNote) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <Stack gap="sm">
            <p className="text-sm text-(--color-ink-muted)">Credit note not found.</p>
            <Link href="/credit-notes" className="text-sm text-(--color-accent) hover:underline">
              ← Back to credit notes
            </Link>
          </Stack>
        </div>
      </main>
    );
  }

  const save = (next: CreditNote) => {
    upsertCreditNote(adapter, next);
  };

  const handleDelete = () => {
    deleteCreditNote(adapter, id);
    window.location.assign("/credit-notes");
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <PageHeader
          title={creditNote.texts.documentTitle}
          breadcrumb={
            <Link href="/credit-notes" className="text-(--color-ink-subtle) hover:text-(--color-accent) transition-colors">
              ← {t(language, "nav.creditNotes")}
            </Link>
          }
          actions={
            <div className="flex items-center gap-2">
              <Link href={`/invoices/${creditNote.linkedInvoiceId}`}>
                <Button variant="secondary">View Original Invoice</Button>
              </Link>
              <Button variant="danger" onClick={() => setShowDelete(true)}>
                {t(language, "actions.delete")}
              </Button>
            </div>
          }
        />

        <Stack gap="md" className="mt-6">
          <Surface>
            <Stack gap="md" className="p-5">
              <div className="flex items-center gap-3">
                <Badge variant={creditNote.type === "storno" ? "danger" : "info"}>
                  {creditNote.type === "storno" ? t(language, "creditNotes.storno") : t(language, "creditNotes.gutschrift")}
                </Badge>
                <span className="text-sm text-(--color-ink-subtle)">
                  {t(language, "creditNotes.linkedInvoice")}: {" "}
                  <Link href={`/invoices/${creditNote.linkedInvoiceId}`} className="text-(--color-accent) hover:underline">
                    {creditNote.linkedInvoiceNumber || "(unknown)"}
                  </Link>
                </span>
              </div>

              <Section title="Credit Note Details">
                <Grid cols={2} gap="md">
                  <Field label={creditNote.texts.creditNoteNumberLabel}>
                    <Input
                      value={creditNote.creditNoteNumber}
                      onChange={(e) => save({ ...creditNote, creditNoteNumber: e.target.value })}
                      placeholder="GS-2024-001"
                    />
                  </Field>

                  <Field label={creditNote.texts.creditNoteDateLabel}>
                    <Input
                      type="date"
                      value={creditNote.creditNoteDate}
                      onChange={(e) => save({ ...creditNote, creditNoteDate: e.target.value })}
                    />
                  </Field>

                  <Field label={creditNote.texts.amountLabel}>
                    <Input
                      inputMode="decimal"
                      value={String(creditNote.amount)}
                      onChange={(e) => save({ ...creditNote, amount: parseNumber(e.target.value) })}
                      placeholder="0.00"
                    />
                  </Field>
                </Grid>

                <Field label={creditNote.texts.reasonLabel} className="mt-4">
                  <Textarea
                    rows={3}
                    value={creditNote.reason}
                    onChange={(e) => save({ ...creditNote, reason: e.target.value })}
                    placeholder="Reason for this credit note / cancellation..."
                  />
                </Field>
              </Section>
            </Stack>
          </Surface>

          {/* Recipient (read-only reference) */}
          <Surface variant="soft">
            <Stack gap="sm" className="p-5">
              <h2 className="text-sm font-semibold text-(--color-ink-muted)">Recipient (from invoice)</h2>
              <div className="text-sm">
                <div className="font-medium text-(--color-ink)">{creditNote.recipient.name}</div>
                <div className="whitespace-pre-line text-(--color-ink-muted)">{creditNote.recipient.address}</div>
                <div className="text-(--color-ink-subtle)">{creditNote.recipient.contact}</div>
              </div>
            </Stack>
          </Surface>

          {/* Footer */}
          <Surface>
            <Stack gap="md" className="p-5">
              <Section title={creditNote.texts.footerHeading}>
                <Textarea
                  rows={4}
                  value={creditNote.footerText}
                  onChange={(e) => save({ ...creditNote, footerText: e.target.value })}
                />
              </Section>
            </Stack>
          </Surface>

          <div className="text-xs text-(--color-ink-subtle)">
            Created: {new Date(creditNote.createdAt).toLocaleString()}
            {" · "}
            Updated: {new Date(creditNote.updatedAt).toLocaleString()}
          </div>
        </Stack>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Credit Note"
        description="Are you sure you want to delete this credit note? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
