"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { LetterPaper } from "@/components/LetterPaper";
import { useDocumentMail } from "@/components/mail/useDocumentMail";
import { PrintStyles } from "@/components/PrintStyles";
import { usePageCrumb } from "@/components/shell/AppShell";
import { computeInvoiceBalance } from "@/lib/calc";
import { DOCUMENT_LOCALE, formatDocumentDate, todayLocalISO } from "@/lib/date";
import { createReminder, defaultReminderText, legalFooterLines, reminderTitle, senderLine } from "@/lib/documents";
import type { Invoice, PaymentReminder } from "@/lib/domain";
import { formatMoney, roundMoney } from "@/lib/money";
import { safeFilePart, savePrintAreaAsPdf } from "@/lib/pdf";
import { waitForInvoicePrintReady } from "@/lib/printing";
import { updateInvoice } from "@/lib/storage/store";
import { usePersistedData } from "@/lib/storage/useStore";

const LEVELS: PaymentReminder["level"][] = [1, 2, 3];

function requestedReminderId(): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("schreiben");
}

/** A recipient line that already is a greeting ("Sehr geehrter Herr Meier") is used as such. */
function greetingFor(invoice: Invoice): string {
  const salutation = invoice.recipient.salutation?.trim().replace(/,+$/, "") ?? "";
  return /^(sehr geehrte|guten tag|hallo|liebe)/i.test(salutation) ? `${salutation},` : "Sehr geehrte Damen und Herren,";
}

/**
 * A payment reminder or dunning letter for one invoice. The letter is written from the invoice and its payments;
 * level, dates, an optional fee and the wording can be changed. Saving the PDF or preparing the e-mail records the
 * letter on the invoice, so the next one starts one level higher.
 */
export function ReminderClient({ id }: { id: string }) {
  const { adapter, data } = usePersistedData();
  const invoice = useMemo(() => data?.invoices.find((entry) => entry.id === id) ?? null, [data?.invoices, id]);
  const creditNotes = useMemo(() => (data?.creditNotes ?? []).filter((note) => note.linkedInvoiceId === id), [data?.creditNotes, id]);
  usePageCrumb(invoice ? `Zahlungserinnerung ${invoice.invoiceNumber}`.trim() : null);

  if (!adapter || !data) return <Page><PageHeader title="Zahlungserinnerung" /><p role="status">Rechnung wird geladen …</p></Page>;
  if (!invoice) {
    return (
      <Page>
        <PageHeader title="Rechnung nicht gefunden" description="Die Rechnung wurde gelöscht oder der Link ist veraltet." />
        <div><Link href="/invoices" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">Zu allen Rechnungen</Link></div>
      </Page>
    );
  }
  return <ReminderEditor key={invoice.id} invoice={invoice} creditNotes={creditNotes} currency={invoice.currency || data.settings.currency || "EUR"} save={(updater) => { updateInvoice(adapter, invoice.id, updater); }} customerEmail={invoice.customerId ? data.customers.find((customer) => customer.id === invoice.customerId)?.email ?? "" : ""} />;
}

function ReminderEditor({ invoice, creditNotes, currency, customerEmail, save }: {
  invoice: Invoice;
  creditNotes: Parameters<typeof computeInvoiceBalance>[1];
  currency: string;
  customerEmail: string;
  save: (updater: (prev: Invoice) => Invoice) => void;
}) {
  const locale = DOCUMENT_LOCALE;
  const [reminder, setReminder] = useState<PaymentReminder>(() => {
    const requested = requestedReminderId();
    return (requested && (invoice.reminders ?? []).find((entry) => entry.id === requested)) || createReminder(invoice);
  });
  const [busy, setBusy] = useState<"pdf" | "mail" | null>(null);
  const inFlight = useRef(false);
  const pendingMail = useRef<PaymentReminder | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "attention"; text: string } | null>(null);

  const recorded = (invoice.reminders ?? []).some((entry) => entry.id === reminder.id);
  const balance = computeInvoiceBalance(invoice, creditNotes);
  const fee = reminder.fee && reminder.fee > 0 ? roundMoney(reminder.fee) : 0;
  const open = Math.max(0, balance.remainingAmount);
  const reduced = roundMoney(balance.invoiceTotal - open);
  const money = (value: number) => formatMoney(value, currency, locale);
  const title = reminderTitle(reminder.level);
  const standardText = defaultReminderText(reminder.level);
  const text = (reminder.text ?? standardText).replaceAll("{frist}", formatDocumentDate(reminder.dueDate, locale));
  const legalLines = legalFooterLines(invoice);
  const dueDay = invoice.dueDate ? formatDocumentDate(invoice.dueDate, locale) : "";
  // A letter is only written for an issued invoice that is past its due date and still has an open amount.
  const blocked = open <= 0
    ? "Bei dieser Rechnung ist nichts mehr offen. Ein Schreiben ist nicht nötig."
    : !invoice.invoiceNumber.trim()
      ? "Die Rechnung hat noch keine Nummer. Bitte zuerst die Rechnung fertigstellen."
      : !balance.isOverdue
        ? `Diese Rechnung ist noch nicht fällig${dueDay ? ` (Zahlungsziel ${dueDay})` : ""}. Eine Zahlungserinnerung können Sie erst nach Ablauf des Zahlungsziels schreiben.`
        : "";

  const record = (next: PaymentReminder) => save((prev) => {
    const list = prev.reminders ?? [];
    return { ...prev, reminders: list.some((entry) => entry.id === next.id) ? list.map((entry) => (entry.id === next.id ? next : entry)) : [...list, next] };
  });

  const documentMail = useDocumentMail(({ warning, to }) => {
    if (pendingMail.current) record(pendingMail.current);
    pendingMail.current = null;
    setMessage({ tone: warning ? "attention" : "ok", text: `${warning || `Die E-Mail an ${to} wurde gesendet.`} Das Schreiben ist bei der Rechnung vermerkt.` });
  });

  /** Changes to a letter that is already on the invoice are kept; a new letter is recorded once it is issued. */
  const change = (patch: Partial<PaymentReminder>) => {
    const next = { ...reminder, ...patch };
    setReminder(next);
    setMessage(null);
    if (recorded) record(next);
  };

  const filename = `${safeFilePart(`${title} ${invoice.invoiceNumber}`.trim(), "Zahlungserinnerung")}.pdf`;

  const run = async (kind: "pdf" | "mail") => {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "pdf") {
        const result = await savePrintAreaAsPdf(filename);
        if (result.canceled) return;
        record(reminder);
        setMessage({ tone: "ok", text: result.message ? `${result.message} Das Schreiben ist bei der Rechnung vermerkt.` : "Das Schreiben ist bei der Rechnung vermerkt." });
      } else {
        await waitForInvoicePrintReady();
        const mailSubject = `${title} zur Rechnung ${invoice.invoiceNumber}`.trim();
        const mailText = `${greetingFor(invoice)}\n\nanbei erhalten Sie unsere ${title} zur Rechnung ${invoice.invoiceNumber} vom ${formatDocumentDate(invoice.invoiceDate, locale)}.\n\nMit freundlichen Grüßen\n${invoice.sender.name}`;
        if (documentMail.available) {
          // Recorded once the provider accepted the message (see `documentMail` above), not when the dialog opens.
          pendingMail.current = reminder;
          await documentMail.composeWithPrint({ to: customerEmail, subject: mailSubject, text: mailText }, filename);
          return;
        }
        if (!window.electronAPI?.emailInvoiceWithPdf) throw new Error("Ein E-Mail-Entwurf mit PDF ist in der installierten Desktop-App verfügbar. Speichern Sie hier die PDF und hängen Sie sie selbst an.");
        const result = await window.electronAPI.emailInvoiceWithPdf({
          to: customerEmail,
          subject: mailSubject,
          body: mailText,
          filename,
        });
        if (!result?.ok) throw new Error(result?.error || "Der E-Mail-Entwurf konnte nicht vorbereitet werden.");
        record(reminder);
        setMessage({ tone: "ok", text: "E-Mail-Entwurf mit PDF vorbereitet. Bitte im E-Mail-Programm prüfen und selbst senden. Das Schreiben ist bei der Rechnung vermerkt." });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Das Schreiben konnte nicht erstellt werden." });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <Page className="invoice-editor">
      <PrintStyles />
      <PageHeader
        className="no-print"
        title={`${title} zur Rechnung ${invoice.invoiceNumber || "ohne Nummer"}`}
        description={[invoice.recipient.name || "Ohne Empfänger", `offen ${money(open)}`, dueDay && `${balance.isOverdue ? "fällig seit" : "fällig am"} ${dueDay}`].filter(Boolean).join(" · ")}
        actions={<>
          <Button variant="primary" loading={busy === "pdf"} disabled={busy !== null || !!blocked} onClick={() => { void run("pdf"); }}>PDF speichern</Button>
          <Button loading={busy === "mail"} disabled={busy !== null || !!blocked} onClick={() => { void run("mail"); }}>{documentMail.available ? "Per E-Mail senden" : "Als E-Mail vorbereiten"}</Button>
          <LinkButton variant="ghost" href={`/invoices/${invoice.id}#zahlungen`}>Zurück zur Rechnung</LinkButton>
        </>}
      />

      <div className="no-print flex flex-col gap-3 empty:hidden">
        {message && <StatusNote tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</StatusNote>}
        {blocked && <StatusNote tone="attention" title={blocked}>Speichern und Senden sind deshalb ausgeschaltet.</StatusNote>}
      </div>

      <div className="no-print w-full max-w-[880px]">
        <FormSection title="Angaben zum Schreiben" description={recorded ? "Dieses Schreiben ist bei der Rechnung vermerkt. Änderungen werden sofort gespeichert." : "Das Schreiben wird bei der Rechnung vermerkt, sobald Sie die PDF speichern oder die E-Mail senden bzw. vorbereiten."} columns={3}>
          <Field label="Art des Schreibens">
            <Select value={String(reminder.level)} onChange={(e) => change({ level: Number(e.target.value) as PaymentReminder["level"], text: undefined })}>
              {LEVELS.map((level) => <option key={level} value={level}>{reminderTitle(level)}</option>)}
            </Select>
          </Field>
          <Field label="Datum des Schreibens">
            <Input type="date" value={reminder.date} onChange={(e) => change({ date: e.target.value || todayLocalISO() })} />
          </Field>
          <Field label="Neue Zahlungsfrist">
            <Input type="date" value={reminder.dueDate} onChange={(e) => change({ dueDate: e.target.value || reminder.dueDate })} />
          </Field>
          <Field label="Mahngebühr (optional)" hint="Wird im Schreiben zum offenen Betrag addiert. Der Rechnungsbetrag bleibt unverändert.">
            <DecimalInput allowEmpty decimalPlaces={2} value={reminder.fee} onValueChange={(value) => change({ fee: value && value > 0 ? value : undefined })} />
          </Field>
          <Field label="Text" hint="{frist} wird durch die Zahlungsfrist ersetzt." className="@md:col-span-2 @2xl:col-span-3">
            <Textarea rows={6} value={reminder.text ?? standardText} onChange={(e) => change({ text: e.target.value === standardText ? undefined : e.target.value })} />
          </Field>
          {reminder.text !== undefined && (
            <div className="@md:col-span-2 @2xl:col-span-3">
              <Button size="sm" onClick={() => change({ text: undefined })}>Standardtext wiederherstellen</Button>
            </div>
          )}
        </FormSection>
      </div>

      <LetterPaper label="Vorschau des Schreibens, scrollbar">
        <p className="text-xs text-zinc-500 underline underline-offset-2">{senderLine(invoice.sender)}</p>
        <div className="mt-6 whitespace-pre-line">
          <span className="font-medium">{invoice.recipient.name}</span>
          {"\n"}
          {invoice.recipient.address}
        </div>
        <p className="mt-10 text-right">{formatDocumentDate(reminder.date, locale)}</p>

        <h1 className="mt-6 text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-zinc-600">
          {invoice.texts.documentTitle || "Rechnung"} {invoice.invoiceNumber} vom {formatDocumentDate(invoice.invoiceDate, locale)}
          {invoice.projectReference?.trim() ? ` · ${invoice.projectReference.trim()}` : ""}
        </p>

        <p className="mt-8">{greetingFor(invoice)}</p>
        <p className="mt-4 whitespace-pre-line">{text}</p>

        <div className="mt-8 ml-auto w-full max-w-sm space-y-1">
          <div className="flex justify-between gap-4"><span className="text-zinc-600">Rechnungsbetrag</span><span className="font-medium tabular-nums">{money(balance.invoiceTotal)}</span></div>
          {dueDay && <div className="flex justify-between gap-4"><span className="text-zinc-600">Fällig am</span><span className="font-medium tabular-nums">{dueDay}</span></div>}
          {reduced > 0 && <div className="flex justify-between gap-4"><span className="text-zinc-600">Bereits gezahlt oder gutgeschrieben</span><span className="font-medium tabular-nums">{money(-reduced)}</span></div>}
          {fee > 0 && <div className="flex justify-between gap-4"><span className="text-zinc-600">Offener Rechnungsbetrag</span><span className="font-medium tabular-nums">{money(open)}</span></div>}
          {fee > 0 && <div className="flex justify-between gap-4"><span className="text-zinc-600">Mahngebühr</span><span className="font-medium tabular-nums">{money(fee)}</span></div>}
          <div className="mt-2 flex justify-between gap-4 border-t border-zinc-200 pt-2"><span className="text-zinc-600">Zu zahlen bis {formatDocumentDate(reminder.dueDate, locale)}</span><span className="text-base font-semibold tabular-nums">{money(roundMoney(open + fee))}</span></div>
        </div>

        <div className="mt-10">
          <p>Mit freundlichen Grüßen</p>
          <p className="mt-8 font-medium">{invoice.sender.name}</p>
        </div>

        {legalLines.length > 0 && (
          <div className="invoice-footer mt-auto border-t border-zinc-200 pt-3 text-center text-[10px] text-zinc-500">
            {legalLines.map((line) => <div key={line}>{line}</div>)}
          </div>
        )}
      </LetterPaper>
      {documentMail.dialog}
    </Page>
  );
}
