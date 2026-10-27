"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Card, CardZone, KeyValueList, Section } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { KindBadge, StatusPill, type Tone } from "@/components/ui/Status";
import type { InvoiceBalance } from "@/lib/calc";
import { todayLocalISO } from "@/lib/date";
import type { CreditNote, Invoice, Language, Payment } from "@/lib/domain";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { addPaymentToInvoice, removePaymentFromInvoice } from "@/lib/storage/store";
import { formatDay } from "@/components/invoiceStatus";

/** Accepts German comma input („12,50“) as well as a dot. */
function parseAmount(input: string): number {
  const n = Number(input.trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export const PAYMENT_AMOUNT_ID = "f-payment-amount";

export function PaymentsTab({
  invoice,
  balance,
  status,
  creditNotes,
  currency,
  locale,
  language,
  save,
  onTogglePaid,
  onCreateCreditNote,
}: {
  invoice: Invoice;
  balance: InvoiceBalance;
  status: { tone: Tone; label: string };
  creditNotes: CreditNote[];
  currency: string;
  locale: string;
  language: Language;
  save: (next: Invoice) => void;
  onTogglePaid: () => void;
  onCreateCreditNote: (type: "storno" | "gutschrift") => void;
}) {
  const de = language === "de";
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [amountError, setAmountError] = useState("");
  const [recorded, setRecorded] = useState("");

  const methodLabel: Record<string, string> = {
    bank_transfer: t(language, "invoices.bankTransfer"),
    cash: t(language, "invoices.cash"),
    card: t(language, "invoices.card"),
    paypal: "PayPal",
    other: t(language, "common.other"),
  };
  const payments = invoice.payments ?? [];

  const record = () => {
    const value = parseAmount(amount);
    if (value <= 0) {
      setAmountError(de ? "Bitte einen Betrag größer als 0 eingeben, z. B. 120,50." : "Enter an amount greater than 0, e.g. 120.50.");
      document.getElementById(PAYMENT_AMOUNT_ID)?.focus();
      return;
    }
    const payment: Payment = {
      id: crypto.randomUUID(),
      amount: value,
      currency: invoice.currency ?? "EUR",
      date: date || todayLocalISO(),
      method: method as Payment["method"],
      reference: reference || undefined,
    };
    save(addPaymentToInvoice(invoice, payment));
    setAmount("");
    setReference("");
    setMethod("bank_transfer");
    setAmountError("");
    setRecorded(de ? `Zahlung über ${formatMoney(value, currency, locale)} erfasst.` : `Payment of ${formatMoney(value, currency, locale)} recorded.`);
  };

  return (
    <FormPage>
      <Section
        title={de ? "Zahlungsstand" : "Payment status"}
        summary={de ? "Gutschriften und erfasste Zahlungen werden vom Rechnungsbetrag abgezogen." : "Credit notes and recorded payments are deducted from the invoice amount."}
        actions={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      >
        <Card>
          <CardZone>
            <KeyValueList
              items={[
                { label: t(language, "invoices.invoiceTotal"), value: formatMoney(balance.invoiceTotal, currency, locale) },
                ...(balance.creditTotal > 0 ? [{ label: de ? "Gutschriften und Stornos" : "Credit notes", value: `− ${formatMoney(balance.creditTotal, currency, locale)}` }] : []),
                { label: t(language, "invoices.paidAmount"), value: formatMoney(balance.paidAmount, currency, locale) },
                { label: t(language, "invoices.remainingBalance"), value: formatMoney(balance.remainingAmount, currency, locale), emphasis: true },
              ]}
            />
          </CardZone>
          {payments.length === 0 && (
            <CardZone className="flex flex-wrap items-center justify-between gap-3 bg-surface-rail">
              <p className="font-sans text-base tracking-snug text-ink-muted">
                {de ? "Ohne einzelne Zahlungen können Sie die Rechnung auch komplett als bezahlt markieren." : "Without individual payments you can mark the whole invoice as paid."}
              </p>
              <Button size="sm" onClick={onTogglePaid}>{balance.isFullyPaid ? t(language, "actions.markUnpaid") : t(language, "actions.markPaid")}</Button>
            </CardZone>
          )}
        </Card>
      </Section>

      {payments.length > 0 && (
        <Section title={t(language, "invoices.paymentHistory")}>
          <Card>
            {payments.map((payment) => {
              const when = formatDay(payment.date, locale);
              const value = formatMoney(payment.amount, payment.currency ?? currency, locale);
              return (
                <CardZone key={payment.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-sans text-lg font-semibold tracking-snug text-ink tabular-nums">{value}</div>
                    <div className="font-sans text-base tracking-snug text-ink-muted">
                      {when} · {(payment.method && methodLabel[payment.method]) || payment.method}{payment.reference ? ` · ${payment.reference}` : ""}
                    </div>
                    {payment.notes && <div className="font-sans text-base tracking-snug text-ink-muted">{payment.notes}</div>}
                  </div>
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/5" aria-label={de ? `Zahlung vom ${when} über ${value} entfernen` : `Remove payment of ${value} from ${when}`} onClick={() => save(removePaymentFromInvoice(invoice, payment.id))}>
                    {t(language, "actions.remove")}
                  </Button>
                </CardZone>
              );
            })}
          </Card>
        </Section>
      )}

      {!balance.isFullyPaid && (
        <FormSection id="zahlung-erfassen" title={t(language, "invoices.addPayment")} description={de ? "Für Teilzahlungen oder den vollständigen Zahlungseingang." : "For partial or full payments."}>
          <Field label={t(language, "invoices.paymentAmount")} id={PAYMENT_AMOUNT_ID} error={amountError || undefined} hint={de ? `Offen: ${formatMoney(balance.remainingAmount, currency, locale)}` : `Open: ${formatMoney(balance.remainingAmount, currency, locale)}`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setAmountError(""); setRecorded(""); }} placeholder={formatMoney(balance.remainingAmount, currency, locale)} />
          </Field>
          <Field label={t(language, "invoices.paymentDate")}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t(language, "invoices.paymentMethod")}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(methodLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label={`${t(language, "invoices.paymentReference")} ${de ? "(optional)" : "(optional)"}`}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={de ? "z. B. Überweisungs-ID" : "e.g. transfer ID"} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button onClick={record}>{t(language, "invoices.recordPayment")}</Button>
            {recorded && <span role="status" className="font-sans text-base tracking-snug text-success-ink">{recorded}</span>}
          </div>
        </FormSection>
      )}

      <Section
        title={de ? "Korrekturen" : "Corrections"}
        summary={de ? "Ein Storno hebt die Rechnung auf, eine Gutschrift mindert den Betrag. Beide werden als eigenes Dokument angelegt." : "A cancellation voids the invoice, a credit note reduces it. Both are created as separate documents."}
        actions={<>
          <Button size="sm" onClick={() => onCreateCreditNote("storno")}>{de ? "Storno erstellen" : "Create cancellation"}</Button>
          <Button size="sm" onClick={() => onCreateCreditNote("gutschrift")}>{de ? "Gutschrift erstellen" : "Create credit note"}</Button>
        </>}
      >
        {creditNotes.length > 0 ? (
          <Card>
            {creditNotes.map((note) => (
              <CardZone key={note.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link href={`/credit-notes/${note.id}`} className="rounded-sm font-sans text-lg font-semibold tracking-snug text-ink underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                    {note.creditNoteNumber || (de ? "Ohne Nummer" : "No number")}
                  </Link>
                  <KindBadge>{t(language, `creditNotes.${note.type}`)}</KindBadge>
                </span>
                <span className="font-sans text-lg font-semibold tracking-snug text-ink tabular-nums">− {formatMoney(note.amount, currency, locale)}</span>
              </CardZone>
            ))}
          </Card>
        ) : (
          <p className="font-sans text-base tracking-snug text-ink-muted">{de ? "Zu dieser Rechnung gibt es noch keine Korrektur." : "There is no correction for this invoice yet."}</p>
        )}
      </Section>
    </FormPage>
  );
}
