"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Choice, Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Card, CardZone, StatusNote } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { computeInvoicePayable } from "@/lib/calc";
import { formatDocumentDate, todayLocalISO } from "@/lib/date";
import { newId } from "@/lib/defaults";
import { advanceDeductionFrom, applyInvoiceKind, checkAdvanceDeductions, findAdvanceCandidates, findAdvancesDeductedElsewhere, invoiceKindOf, type AdvanceDeductionIssue } from "@/lib/documents";
import type { AdvanceDeduction, AppSettings, CreditNote, Invoice, InvoiceKind } from "@/lib/domain";
import { findDuplicateNumbers, suggestNextNumber } from "@/lib/invoiceNumber";
import { formatMoney } from "@/lib/money";
import { fieldId } from "./fields";

type Props = {
  invoice: Invoice;
  kind: "invoice" | "quote";
  /** Documents of the same collection: number suggestion and duplicate check stay within invoices or within quotes. */
  documents: readonly Invoice[];
  /** All invoices, for the advance invoices a final invoice deducts. */
  invoices: readonly Invoice[];
  /** All credit notes: a cancelled advance invoice is not deducted, a partly credited one only with the rest. */
  creditNotes: readonly CreditNote[];
  settings: AppSettings | undefined;
  currency: string;
  locale: string;
  de: boolean;
  errors: Record<string, string>;
  save: (next: Invoice | ((prev: Invoice) => Invoice)) => void;
  /** Switches reverse charge (§ 13b) on or off; the editor remembers and restores the tax rates of the positions. */
  onReverseCharge: (enabled: boolean) => void;
  clearErrors: (match: (field: string) => boolean) => void;
};

const KIND_LABEL: Record<InvoiceKind, string> = { standard: "Rechnung", advance: "Abschlagsrechnung", final: "Schlussrechnung" };

/**
 * First section of the editor: number (with a suggestion and a duplicate warning), dates, project, the kind of
 * invoice and the reverse-charge switch. A final invoice lists the advance invoices it deducts right here, because
 * they decide the amount the customer still has to pay.
 */
export function DocumentDetails({ invoice, kind, documents, invoices, creditNotes, currency, locale, de, errors, save, onReverseCharge, clearErrors }: Props) {
  const isQuote = kind === "quote";
  const noun = isQuote ? "Angebot" : "Rechnung";
  const numberLabel = invoice.texts.invoiceNumberLabel || (isQuote ? "Angebotsnummer" : "Rechnungsnummer");
  const hasNumber = invoice.invoiceNumber.trim() !== "";

  const suggestion = useMemo(
    () => (hasNumber ? "" : suggestNextNumber(documents.filter((document) => document.id !== invoice.id), todayLocalISO(), isQuote ? "A-" : "")),
    [documents, hasNumber, invoice.id, isQuote],
  );
  const duplicates = useMemo(() => findDuplicateNumbers(documents, invoice.invoiceNumber, invoice.id), [documents, invoice.id, invoice.invoiceNumber]);
  const duplicateMessage = duplicates.length
    ? `Diese Nummer trägt bereits ${duplicates.length === 1 ? `${isQuote ? "ein anderes Angebot" : "eine andere Rechnung"}` : `${duplicates.length} andere ${isQuote ? "Angebote" : "Rechnungen"}`}` +
      `${duplicates[0].recipient.name ? ` (${duplicates[0].recipient.name}${duplicates[0].invoiceDate ? `, ${formatDocumentDate(duplicates[0].invoiceDate, locale)}` : ""})` : ""}. ` +
      `Jede Nummer darf nur einmal vergeben werden.`
    : "";

  // Projects of earlier invoices and quotes to the same customer, newest first: chosen instead of typed again, so
  // the exact wording that links advance and final invoices stays the same.
  const projectSuggestions = useMemo(() => {
    const own = invoice.customerId || invoice.recipient.name.trim();
    if (!own) return [];
    const seen = new Set<string>();
    return [...invoices, ...documents]
      .filter((document) => document.id !== invoice.id && (document.customerId || document.recipient.name.trim()) === own && document.projectReference?.trim())
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
      .map((document) => document.projectReference!.trim())
      .filter((project) => !seen.has(project) && seen.add(project))
      .slice(0, 12);
  }, [documents, invoices, invoice.customerId, invoice.id, invoice.recipient.name]);

  const invoiceKind = invoiceKindOf(invoice);
  const deductions = invoice.advanceDeductions ?? [];
  const payable = computeInvoicePayable(invoice);
  const money = (value: number) => formatMoney(value, currency, locale);
  const candidates = useMemo(
    () => (invoiceKind === "final" ? findAdvanceCandidates(invoices, invoice, creditNotes).filter((candidate) => !deductions.some((entry) => entry.invoiceId === candidate.id)) : []),
    // Only the fields that decide which advance invoices fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoiceKind, invoices, creditNotes, invoice.id, invoice.customerId, invoice.recipient.name, invoice.projectReference, invoice.currency, deductions],
  );

  // Advance invoices of this customer and project that are not offered because another final invoice deducts them.
  const deductedElsewhere = useMemo(
    () => (invoiceKind === "final" ? findAdvancesDeductedElsewhere(invoices, invoice, creditNotes) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoiceKind, invoices, creditNotes, invoice.id, invoice.customerId, invoice.recipient.name, invoice.projectReference, invoice.currency],
  );
  // Deductions whose advance invoice was cancelled, reduced, edited or deleted since. Nothing is changed without the user.
  const deductionIssues = useMemo(() => {
    const issues = new Map<string, AdvanceDeductionIssue>();
    for (const issue of checkAdvanceDeductions(invoice, invoices, creditNotes)) issues.set(issue.deductionId, issue);
    return issues;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.invoiceKind, invoice.advanceDeductions, invoices, creditNotes]);

  const setDeduction = (id: string, patch: Partial<AdvanceDeduction>) =>
    save((prev) => ({ ...prev, advanceDeductions: (prev.advanceDeductions ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }));
  const removeDeduction = (id: string) =>
    save((prev) => ({ ...prev, advanceDeductions: (prev.advanceDeductions ?? []).filter((entry) => entry.id !== id) }));
  const addDeduction = (entry: AdvanceDeduction) =>
    save((prev) => ({ ...prev, advanceDeductions: [...(prev.advanceDeductions ?? []), entry] }));

  return (
    <FormSection
      id="rechnungsdaten"
      title={isQuote ? "Angebotsdaten" : (de ? "Rechnungsdaten" : "Invoice details")}
      description={isQuote ? "Nummer, Datum und wie lange das Angebot gilt." : (de ? "Nummer, Datum, Zahlungsziel und Bauvorhaben." : "Number, dates and project.")}
      columns={3}
    >
      <Field
        label={numberLabel}
        id={fieldId("invoiceNumber")}
        error={errors.invoiceNumber ?? (duplicateMessage || undefined)}
        hint={!hasNumber && !isQuote ? "Ohne Nummer bleibt die Rechnung ein Entwurf." : undefined}
      >
        <Input
          value={invoice.invoiceNumber}
          placeholder="noch keine Nummer"
          onChange={(e) => { save({ ...invoice, invoiceNumber: e.target.value }); clearErrors((field) => field === "invoiceNumber"); }}
        />
      </Field>
      <Field label={invoice.texts.invoiceDateLabel || (isQuote ? "Angebotsdatum" : "Rechnungsdatum")} id={fieldId("invoiceDate")} error={errors.invoiceDate}>
        <Input type="date" value={invoice.invoiceDate} onChange={(e) => { save({ ...invoice, invoiceDate: e.target.value }); clearErrors((field) => field === "invoiceDate"); }} />
      </Field>
      <Field label={invoice.texts.dueDateLabel || (isQuote ? "Gültig bis" : "Fällig am")} id={fieldId("dueDate")} error={errors.dueDate}>
        <Input type="date" value={invoice.dueDate} onChange={(e) => { save({ ...invoice, dueDate: e.target.value }); clearErrors((field) => field === "dueDate"); }} />
      </Field>

      {!hasNumber && suggestion && (
        <div className="flex flex-wrap items-center gap-3 @md:col-span-2 @2xl:col-span-3">
          <Button
            size="sm"
            onClick={() => { save((prev) => (prev.invoiceNumber.trim() ? prev : { ...prev, invoiceNumber: suggestion })); clearErrors((field) => field === "invoiceNumber"); }}
          >
            Nächste Nummer übernehmen: {suggestion}
          </Button>
          <span className="font-sans text-base tracking-snug text-ink-muted">
            {documents.some((document) => document.id !== invoice.id && document.invoiceNumber.trim())
              ? `Fortlaufend nach ${isQuote ? "dem letzten Angebot" : "der letzten Rechnung"}.`
              : "Vorschlag für die erste Nummer. Sie können auch eine eigene eintragen."}
          </span>
        </div>
      )}

      {!isQuote && (
        <Field
          label={invoice.texts.serviceDateLabel?.trim() || "Leistungsdatum"}
          id={fieldId("einvoice.serviceDate.edit")}
          hint="Tag der Lieferung oder der Fertigstellung der Arbeiten."
        >
          <Input
            type="date"
            value={invoice.einvoice?.serviceDate ?? ""}
            onChange={(e) => {
              const serviceDate = e.target.value || undefined;
              save((prev) => ({ ...prev, einvoice: { ...(prev.einvoice ?? {}), serviceDate } }));
              clearErrors((field) => field === "einvoice.serviceDate");
            }}
          />
        </Field>
      )}
      <Field
        label={invoice.texts.projectReferenceLabel?.trim() || "Bauvorhaben / Kommission"}
        id={fieldId("projectReference")}
        hint={projectSuggestions.length ? "Frühere Bauvorhaben dieses Kunden stehen beim Tippen zur Auswahl." : `Steht auf ${isQuote ? "dem Angebot" : "der Rechnung"} und hilft beim Wiederfinden.`}
        className={isQuote ? "@md:col-span-2" : "@md:col-span-1 @2xl:col-span-2"}
      >
        <Input
          value={invoice.projectReference ?? ""}
          placeholder="z. B. Pohlstraße 40, Berlin"
          list={projectSuggestions.length ? `${invoice.id}-projects` : undefined}
          onChange={(e) => save({ ...invoice, projectReference: e.target.value || undefined })}
        />
        {projectSuggestions.length > 0 && <datalist id={`${invoice.id}-projects`}>{projectSuggestions.map((project) => <option key={project} value={project} />)}</datalist>}
      </Field>

      {!isQuote && (
        <Field label="Art der Rechnung" id={fieldId("invoiceKind")} hint={invoiceKind === "advance" ? "Wird später in der Schlussrechnung abgezogen." : invoiceKind === "final" ? "Zieht die gestellten Abschlagsrechnungen ab." : undefined}>
          <Select value={invoiceKind} onChange={(e) => save(applyInvoiceKind(invoice, e.target.value as InvoiceKind, invoices, creditNotes))}>
            {(Object.keys(KIND_LABEL) as InvoiceKind[]).map((value) => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}
          </Select>
        </Field>
      )}
      <div className={isQuote ? "@md:col-span-2 @2xl:col-span-3" : "@md:col-span-1 @2xl:col-span-2"}>
        <Choice
          label="Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)"
          hint={`Für Bauleistungen an andere Bauunternehmen: ${noun} ohne Umsatzsteuer, der Hinweis wird automatisch gedruckt.`}
          checked={invoice.reverseCharge === true}
          onChange={(e) => onReverseCharge(e.target.checked)}
        />
      </div>

      {invoiceKind === "final" && (
        <div className="flex min-w-0 flex-col gap-3 @md:col-span-2 @2xl:col-span-3">
          <div className="flex flex-col gap-1">
            <h3 className="font-sans text-lg font-semibold tracking-snug text-ink">Abzug der Abschlagsrechnungen</h3>
            <p className="max-w-[72ch] font-sans text-base tracking-snug text-ink-muted">
              Die Positionen dieser Schlussrechnung enthalten die gesamte Leistung. Die bereits gestellten Abschlagsrechnungen werden unter der Summe abgezogen.
            </p>
          </div>
          <Card>
            {deductions.length === 0 && (
              <CardZone>
                <p className="font-sans text-lg tracking-snug text-ink-muted">Noch kein Abschlag eingetragen.</p>
              </CardZone>
            )}
            {deductions.map((entry, index) => {
              const source = entry.invoiceId ? invoices.find((candidate) => candidate.id === entry.invoiceId) : undefined;
              const issue = deductionIssues.get(entry.id);
              const issueNumber = issue?.invoiceNumber.trim() || "ohne Nummer";
              return (
                <CardZone key={entry.id} className="@container">
                  <div className="grid gap-3 @lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @lg:items-end">
                    <Field label="Rechnungsnummer" id={fieldId(`advance.${index}.number`)}>
                      <Input value={entry.invoiceNumber} onChange={(e) => setDeduction(entry.id, { invoiceNumber: e.target.value })} />
                    </Field>
                    <Field label="Datum">
                      <Input type="date" value={entry.invoiceDate} onChange={(e) => setDeduction(entry.id, { invoiceDate: e.target.value })} />
                    </Field>
                    <Field label="Netto">
                      <DecimalInput key={`${entry.id}-net`} value={entry.net} decimalPlaces={2} onValueChange={(net) => setDeduction(entry.id, { net: net ?? 0 })} />
                    </Field>
                    <Field label="Umsatzsteuer">
                      <DecimalInput key={`${entry.id}-tax`} value={entry.tax} decimalPlaces={2} onValueChange={(tax) => setDeduction(entry.id, { tax: tax ?? 0 })} />
                    </Field>
                    <Button variant="quiet" aria-label={`Abschlag ${entry.invoiceNumber || index + 1} entfernen`} onClick={() => removeDeduction(entry.id)}>Entfernen</Button>
                  </div>
                  <p className="mt-2 font-sans text-base tracking-snug text-ink-muted">
                    Brutto {money(entry.net + entry.tax)}
                    {source && <>, <Link href={`/invoices/${source.id}`} className="text-link underline-offset-3 hover:underline">Abschlagsrechnung öffnen</Link></>}
                  </p>
                  {issue?.kind === "missing" && (
                    <StatusNote
                      tone="attention"
                      className="mt-3"
                      title={`Die Abschlagsrechnung ${issueNumber} gibt es nicht mehr.`}
                      action={<>
                        <Button size="sm" onClick={() => removeDeduction(entry.id)}>Abzug entfernen</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeduction(entry.id, { invoiceId: undefined })}>Abzug behalten</Button>
                      </>}
                    >
                      Sie wurde gelöscht. Diese Schlussrechnung zieht trotzdem weiter {money(issue.deductedGross)} ab. Hat der Kunde den Abschlag nicht bezahlt, entfernen Sie den Abzug.
                    </StatusNote>
                  )}
                  {issue?.kind === "cancelled" && (
                    <StatusNote
                      tone="attention"
                      className="mt-3"
                      title={`Die Abschlagsrechnung ${issueNumber} wurde storniert.`}
                      action={<Button size="sm" onClick={() => removeDeduction(entry.id)}>Abzug entfernen</Button>}
                    >
                      Diese Schlussrechnung zieht trotzdem noch {money(issue.deductedGross)} ab. Der Restbetrag ist dadurch zu niedrig.
                    </StatusNote>
                  )}
                  {issue?.kind === "changed" && issue.current && (
                    <StatusNote
                      tone="attention"
                      className="mt-3"
                      title={`Die Abschlagsrechnung ${issueNumber} hat sich geändert.`}
                      action={<>
                        <Button size="sm" onClick={() => setDeduction(entry.id, { ...issue.current })}>Abzug aktualisieren</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeduction(entry.id, { sourceNet: issue.current?.sourceNet, sourceTax: issue.current?.sourceTax })}>Abzug so lassen</Button>
                        <Button size="sm" variant="ghost" onClick={() => removeDeduction(entry.id)}>Abzug entfernen</Button>
                      </>}
                    >
                      Sie beträgt jetzt {money(issue.currentGross)} brutto, zum Beispiel nach einer Gutschrift oder Änderung. Abgezogen werden hier {money(issue.deductedGross)}.
                    </StatusNote>
                  )}
                </CardZone>
              );
            })}
            <CardZone className="flex flex-wrap items-center justify-between gap-3 bg-surface-rail">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => addDeduction({ id: newId(), invoiceNumber: "", invoiceDate: "", net: 0, tax: 0 })}>Abschlag von Hand eintragen</Button>
              </div>
              <p className="font-sans text-lg font-semibold tracking-snug text-ink tabular-nums">
                {payable.payable < 0 ? "Guthaben" : "Restbetrag"} {money(Math.abs(payable.payable))}
              </p>
            </CardZone>
          </Card>
          {candidates.length > 0 && (
            <StatusNote tone="info" title={candidates.length === 1 ? "Eine passende Abschlagsrechnung ist noch nicht abgezogen." : `${candidates.length} passende Abschlagsrechnungen sind noch nicht abgezogen.`}>
              <ul className="mt-1 flex flex-col gap-2">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="flex flex-wrap items-center gap-3">
                    <span>{candidate.invoiceNumber} vom {formatDocumentDate(candidate.invoiceDate, locale)}, {money(computeInvoicePayable(candidate).total)}</span>
                    <Button size="sm" onClick={() => addDeduction(advanceDeductionFrom(candidate, creditNotes))}>Abziehen</Button>
                  </li>
                ))}
              </ul>
            </StatusNote>
          )}
          {deductedElsewhere.length > 0 && (
            <StatusNote tone="info">
              <ul className="flex flex-col gap-0.5">
                {deductedElsewhere.map(({ advance, deductedBy }) => (
                  <li key={advance.id}>
                    Abschlagsrechnung {advance.invoiceNumber} ist bereits in{" "}
                    <Link href={`/invoices/${deductedBy.id}`} className="underline underline-offset-3">
                      {deductedBy.invoiceNumber.trim() ? `Schlussrechnung ${deductedBy.invoiceNumber}` : "einer Schlussrechnung ohne Nummer"}
                    </Link>{" "}
                    abgezogen.
                  </li>
                ))}
              </ul>
            </StatusNote>
          )}
          {payable.payable < 0 && (
            <StatusNote tone="attention">Die Abschläge sind höher als die Rechnungssumme. Bitte Positionen und Abschläge prüfen.</StatusNote>
          )}
        </div>
      )}
    </FormSection>
  );
}
