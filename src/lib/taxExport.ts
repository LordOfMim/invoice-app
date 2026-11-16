import { computeInvoiceBalance, computeInvoicePayable } from "@/lib/calc";
import { dateToLocalISO, formatDocumentDate, isDateOnly, parseDateOnly } from "@/lib/date";
import type { CreditNote, Invoice } from "@/lib/domain";
import { roundMoney } from "@/lib/money";

/*
 * The list a tax advisor asks for: every issued invoice and correction of a period with net, VAT and gross, what
 * was deducted and when it was paid. Pure functions; the page adds the PDFs.
 */

export type PeriodKind = "month" | "quarter" | "year" | "custom";
export type Period = { from: string; to: string; label: string; fileLabel: string };

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const lastDay = (year: number, monthIndex: number) => dateToLocalISO(new Date(year, monthIndex + 1, 0));
const firstDay = (year: number, monthIndex: number) => dateToLocalISO(new Date(year, monthIndex, 1));

/** The month, quarter or year that contains `anchor` (YYYY-MM-DD), moved by `offset` periods. */
export function periodFor(kind: Exclude<PeriodKind, "custom">, anchor: string, offset = 0): Period {
  const date = parseDateOnly(anchor) ?? new Date();
  const year = date.getFullYear();
  const month = date.getMonth();
  if (kind === "year") {
    const y = year + offset;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Jahr ${y}`, fileLabel: `${y}` };
  }
  if (kind === "quarter") {
    const index = Math.floor(month / 3) + offset;
    const y = year + Math.floor(index / 4);
    const quarter = ((index % 4) + 4) % 4;
    return { from: firstDay(y, quarter * 3), to: lastDay(y, quarter * 3 + 2), label: `${quarter + 1}. Quartal ${y}`, fileLabel: `${y}-Q${quarter + 1}` };
  }
  const index = month + offset;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return { from: firstDay(y, m), to: lastDay(y, m), label: `${MONTHS[m]} ${y}`, fileLabel: `${y}-${String(m + 1).padStart(2, "0")}` };
}

export function customPeriod(from: string, to: string): Period | null {
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return null;
  return { from, to, label: `${formatDocumentDate(from, "de-DE")} bis ${formatDocumentDate(to, "de-DE")}`, fileLabel: `${from}_bis_${to}` };
}

export type ExportRow = {
  id: string;
  kind: "invoice" | "credit";
  /** Printed kind: Rechnung, Abschlagsrechnung, Schlussrechnung, Storno or Gutschrift. */
  typeLabel: string;
  number: string;
  date: string;
  serviceDate: string;
  customer: string;
  project: string;
  net: number | null;
  tax: number | null;
  gross: number;
  /** Advance invoices deducted on a final invoice (gross) and the VAT contained in them. */
  deducted: number;
  deductedTax: number;
  /** Amount the document demands (negative for corrections), split into net and VAT where known. */
  payable: number;
  payableNet: number | null;
  payableTax: number | null;
  paid: number | null;
  paidOn: string;
  open: number | null;
  note: string;
  currency: string;
  invoice?: Invoice;
};

/**
 * Sums over the period. They add up what the documents demand: a final invoice counts with its remaining amount
 * (its advance invoices are rows of their own), a correction counts negative. `unsplitCorrections` is the number of
 * corrections whose invoice no longer exists, so their amount could not be divided into net and VAT.
 */
export type ExportSummary = { rows: ExportRow[]; skippedDrafts: number; unsplitCorrections: number; totals: { net: number; tax: number; gross: number; open: number } };

const KIND_LABEL = { standard: "Rechnung", advance: "Abschlagsrechnung", final: "Schlussrechnung" } as const;

/** All issued (numbered) invoices and all corrections dated within the period, oldest first. */
export function collectExportRows(invoices: readonly Invoice[], creditNotes: readonly CreditNote[], period: Pick<Period, "from" | "to">, fallbackCurrency = "EUR", today?: string): ExportSummary {
  const inPeriod = (date: string) => !!date && date >= period.from && date <= period.to;
  const creditsByInvoice = new Map<string, CreditNote[]>();
  for (const note of creditNotes) creditsByInvoice.set(note.linkedInvoiceId, [...(creditsByInvoice.get(note.linkedInvoiceId) ?? []), note]);

  let skippedDrafts = 0;
  let unsplitCorrections = 0;
  const rows: ExportRow[] = [];
  for (const invoice of invoices) {
    if (!inPeriod(invoice.invoiceDate)) continue;
    if (!invoice.invoiceNumber.trim()) { skippedDrafts += 1; continue; }
    const amounts = computeInvoicePayable(invoice);
    const balance = computeInvoiceBalance(invoice, creditsByInvoice.get(invoice.id) ?? [], today);
    const lastPayment = [...(invoice.payments ?? [])].map((payment) => payment.date).filter(Boolean).sort().pop() ?? "";
    const kind = invoice.invoiceKind === "advance" || invoice.invoiceKind === "final" ? invoice.invoiceKind : "standard";
    rows.push({
      id: invoice.id,
      kind: "invoice",
      typeLabel: KIND_LABEL[kind],
      number: invoice.invoiceNumber.trim(),
      date: invoice.invoiceDate,
      serviceDate: invoice.einvoice?.serviceDate ?? "",
      customer: invoice.recipient.name.trim(),
      project: invoice.projectReference?.trim() ?? "",
      net: amounts.subtotal,
      tax: amounts.taxTotal,
      gross: amounts.total,
      deducted: amounts.deducted,
      deductedTax: amounts.deductedTax,
      payable: amounts.payable,
      payableNet: roundMoney(amounts.payable - amounts.payableTax),
      payableTax: amounts.payableTax,
      paid: balance.paidAmount,
      paidOn: balance.isFullyPaid ? lastPayment : "",
      open: balance.remainingAmount,
      note: invoice.reverseCharge ? "§ 13b UStG" : "",
      currency: invoice.currency || fallbackCurrency,
      invoice,
    });
  }
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  for (const note of creditNotes) {
    if (!inPeriod(note.creditNoteDate)) continue;
    const linked = invoiceById.get(note.linkedInvoiceId);
    // A correction stores one gross amount. It is divided into net and VAT in the proportion of the invoice it
    // corrects (exact for a single tax rate, proportional for mixed rates).
    const gross = -roundMoney(note.amount);
    const linkedTotals = linked ? computeInvoicePayable(linked) : null;
    const tax = linkedTotals && linkedTotals.total > 0 ? roundMoney(gross * (linkedTotals.taxTotal / linkedTotals.total)) : linkedTotals ? 0 : null;
    const net = tax === null ? null : roundMoney(gross - tax);
    if (tax === null) unsplitCorrections += 1;
    rows.push({
      id: note.id,
      kind: "credit",
      typeLabel: note.type === "storno" ? "Storno" : "Gutschrift",
      number: note.creditNoteNumber.trim() || "ohne Nummer",
      date: note.creditNoteDate,
      serviceDate: "",
      customer: note.recipient.name.trim(),
      project: linked?.projectReference?.trim() ?? "",
      net,
      tax,
      gross,
      deducted: 0,
      deductedTax: 0,
      payable: gross,
      payableNet: net,
      payableTax: tax,
      paid: null,
      paidOn: "",
      open: null,
      note: `zu Rechnung ${note.linkedInvoiceNumber || linked?.invoiceNumber || "?"}`,
      currency: linked?.currency || fallbackCurrency,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "de-DE", { numeric: true }));
  const sum = (pick: (row: ExportRow) => number | null) => roundMoney(rows.reduce((total, row) => total + (pick(row) ?? 0), 0));
  return {
    rows,
    skippedDrafts,
    unsplitCorrections,
    totals: { net: sum((row) => row.payableNet), tax: sum((row) => row.payableTax), gross: sum((row) => row.payable), open: sum((row) => row.open) },
  };
}

// "Netto/Umsatzsteuer/Brutto" are the full amounts of the document. The three "Zahlbetrag" columns are what remains
// after advance invoices; only these may be added up over a period without counting advance payments twice.
const HEADER = ["Art", "Nummer", "Datum", "Leistungsdatum", "Kunde", "Bauvorhaben", "Netto", "Umsatzsteuer", "Brutto", "Abzug Abschläge brutto", "darin Umsatzsteuer", "Zahlbetrag netto", "Zahlbetrag Umsatzsteuer", "Zahlbetrag brutto", "Bezahlt", "Bezahlt am", "Offen", "Währung", "Hinweis"];

const amount = (value: number | null) => (value === null ? "" : value.toFixed(2).replace(".", ","));

/** One CSV cell. Text that a spreadsheet would run as a formula is defused with a leading apostrophe. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The list as CSV the way German Excel opens it without questions: UTF-8 with byte order mark, semicolons,
 * decimal commas, dates as 31.12.2026 and Windows line ends.
 */
export function exportCsv(summary: ExportSummary): string {
  const lines = [HEADER.map(cell).join(";")];
  for (const row of summary.rows) {
    lines.push([
      cell(row.typeLabel), cell(row.number), cell(formatDocumentDate(row.date, "de-DE")), cell(row.serviceDate ? formatDocumentDate(row.serviceDate, "de-DE") : ""),
      cell(row.customer), cell(row.project), amount(row.net), amount(row.tax), amount(row.gross), amount(row.deducted || null), amount(row.deducted ? row.deductedTax : null), amount(row.payableNet), amount(row.payableTax), amount(row.payable),
      amount(row.paid), cell(row.paidOn ? formatDocumentDate(row.paidOn, "de-DE") : ""), amount(row.open), cell(row.currency), cell(row.note),
    ].join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
