import type {
  AdvanceDeduction,
  AppSettings,
  ContractorDeclaration,
  CreditNote,
  Invoice,
  InvoiceKind,
  InvoiceLineItem,
  PaymentReminder,
  Product,
} from "@/lib/domain";
import { computeCreditTotal, computeInvoicePayable, computeInvoiceTotals } from "@/lib/calc";
import { roundMoney } from "@/lib/money";
import { addDays, todayLocalISO } from "@/lib/date";
import { createInvoiceFromDefaults, dueDateFor, newId, remapLineIdKeys } from "@/lib/defaults";

/*
 * Rules for the document features added in 1.3: reverse charge (§ 13b UStG), advance and final invoices, quotes,
 * payment reminders, contractor declarations and the legal footer. Everything here is pure: it takes records and
 * returns new records, so the editor, the store and the tests share one implementation.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Legal footer (tax numbers and bank details on the ordinary PDF)
// ─────────────────────────────────────────────────────────────────────────────

/** Groups an IBAN in blocks of four for reading; the stored value is not changed. */
export function formatIban(value: string | undefined): string {
  const compact = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return compact.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Mandatory details a German invoice needs besides the amounts (§ 14 UStG): tax number or VAT ID, plus the bank
 * account the customer should pay to. They come from the structured details the E-Rechnung already uses, so they
 * are entered once. Invoices without these details print nothing extra.
 */
export function legalFooterLines(invoice: Pick<Invoice, "einvoice">, alreadyPrinted = ""): string[] {
  const details = invoice.einvoice;
  if (!details) return [];
  // A footer the user typed by hand may already carry a number; it is not printed a second time.
  const printed = alreadyPrinted.replace(/\s+/g, "").toLocaleLowerCase("de-DE");
  const missing = (value: string | undefined) => {
    const compact = (value ?? "").replace(/\s+/g, "").toLocaleLowerCase("de-DE");
    return compact !== "" && !printed.includes(compact);
  };
  const lines: string[] = [];
  const tax = [
    missing(details.seller?.taxId) && `Steuernummer: ${details.seller!.taxId!.trim()}`,
    missing(details.seller?.vatId) && `USt-IdNr.: ${details.seller!.vatId!.trim()}`,
  ].filter(Boolean);
  if (tax.length) lines.push(tax.join(" · "));
  if (missing(details.iban)) {
    const bank = [details.accountName?.trim(), `IBAN: ${formatIban(details.iban)}`, details.bic?.trim() && `BIC: ${details.bic.trim()}`].filter(Boolean);
    lines.push(bank.join(" · "));
  }
  return lines;
}

const SELLER_KEYS = ["taxId", "vatId"] as const;
const BANK_KEYS = ["iban", "bic", "accountName"] as const;

/** True when the settings hold a tax number or bank detail that this document does not carry yet. */
export function lacksSellerDefaults(invoice: Pick<Invoice, "einvoice">, settings: Pick<AppSettings, "defaultEInvoice"> | undefined): boolean {
  const defaults = settings?.defaultEInvoice;
  if (!defaults) return false;
  return SELLER_KEYS.some((key) => defaults.seller?.[key]?.trim() && !invoice.einvoice?.seller?.[key]?.trim())
    || BANK_KEYS.some((key) => defaults[key]?.trim() && !invoice.einvoice?.[key]?.trim());
}

/**
 * Fill tax number, VAT ID and bank details from the settings where the document has none. Values already on the
 * document always win, so an invoice issued with an older bank account keeps it.
 */
export function withSellerDefaults<T extends Pick<Invoice, "einvoice">>(invoice: T, settings: Pick<AppSettings, "defaultEInvoice"> | undefined): T {
  const defaults = settings?.defaultEInvoice;
  if (!defaults || !lacksSellerDefaults(invoice, settings)) return invoice;
  const einvoice = { ...(invoice.einvoice ?? {}) };
  const seller = { ...(einvoice.seller ?? {}) };
  for (const key of SELLER_KEYS) if (!seller[key]?.trim() && defaults.seller?.[key]?.trim()) seller[key] = defaults.seller[key];
  for (const key of BANK_KEYS) if (!einvoice[key]?.trim() && defaults[key]?.trim()) einvoice[key] = defaults[key];
  return { ...invoice, einvoice: { ...einvoice, seller } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse charge (§ 13b UStG)
// ─────────────────────────────────────────────────────────────────────────────

export const REVERSE_CHARGE_NOTE = "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).";

/**
 * Switch an invoice to or from reverse charge. Turning it on sets every position to 0 % and fills the tax category
 * and reason the E-Rechnung needs; turning it off returns positions without tax to the default rate. Amounts are
 * only ever changed by this explicit switch.
 *
 * The tax category and exemption reason the invoice carried before (for example "E" with the § 19 note of a
 * Kleinunternehmer) are remembered in `reverseChargePreviousTax` and put back when it is switched off, so the
 * § 13b wording never stays behind on an invoice that is no longer one.
 */
export function applyReverseCharge(invoice: Invoice, enabled: boolean, defaultTaxRate: number | undefined): Invoice {
  if (enabled) {
    const einvoice = { ...(invoice.einvoice ?? {}) };
    // Already on: what was remembered must not be replaced by the values of the running reverse charge.
    const previousTax = invoice.reverseCharge
      ? invoice.reverseChargePreviousTax
      : stripUndefined({ taxCategory: einvoice.taxCategory, taxExemptionReason: einvoice.taxExemptionReason });
    // A reason that belonged to another category ("§ 19 UStG" for "E") makes way; a reason without a category is the user's own wording and stays.
    const reasonOfOtherCategory = !invoice.reverseCharge && !!einvoice.taxCategory && einvoice.taxCategory !== "AE";
    einvoice.taxCategory = "AE";
    if (reasonOfOtherCategory || !einvoice.taxExemptionReason?.trim()) einvoice.taxExemptionReason = REVERSE_CHARGE_NOTE;
    return {
      ...invoice,
      reverseCharge: true,
      reverseChargePreviousTax: previousTax,
      einvoice,
      lineItems: invoice.lineItems.map((item) => ((item.type ?? "item") === "item" && item.taxRate ? { ...item, taxRate: 0 } : item)),
    };
  }
  const einvoice = invoice.einvoice ? { ...invoice.einvoice } : undefined;
  const previousTax = invoice.reverseChargePreviousTax;
  if (einvoice && previousTax) {
    // "AE" and the standard note are reverse charge itself; they are never what an invoice returns to.
    const category = previousTax.taxCategory === "AE" ? undefined : previousTax.taxCategory;
    const reason = previousTax.taxExemptionReason?.trim() === REVERSE_CHARGE_NOTE ? undefined : previousTax.taxExemptionReason;
    if (einvoice.taxCategory === "AE" || einvoice.taxCategory === undefined) {
      einvoice.taxCategory = category;
      einvoice.taxExemptionReason = reason;
    } else if (einvoice.taxExemptionReason?.trim() === REVERSE_CHARGE_NOTE) {
      // The category was changed by hand in the meantime: it stays, only the § 13b note goes.
      einvoice.taxExemptionReason = undefined;
    }
  } else if (einvoice?.taxCategory === "AE") {
    // Switched on by an earlier version, which remembered nothing.
    einvoice.taxCategory = undefined;
    if (einvoice.taxExemptionReason?.trim() === REVERSE_CHARGE_NOTE) einvoice.taxExemptionReason = undefined;
  }
  return {
    ...invoice,
    reverseCharge: undefined,
    reverseChargePreviousTax: undefined,
    einvoice,
    lineItems: invoice.lineItems.map((item): InvoiceLineItem =>
      (item.type ?? "item") === "item" && !item.taxRate && defaultTaxRate !== undefined ? { ...item, taxRate: defaultTaxRate } : item),
  };
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

const isPosition = (item: InvoiceLineItem) => (item.type ?? "item") === "item";

/**
 * The switch for reverse charge (§ 13b UStG) as the editor and the recurring invoices use it. Switching it on
 * remembers the tax rate of every position before `applyReverseCharge` sets them to 0 %; switching it off puts
 * exactly those rates back. A position that came in while reverse charge was on returns to the rate of its product,
 * otherwise to the default rate. A rate the user typed in by hand in the meantime is never overwritten.
 */
export function switchReverseCharge(invoice: Invoice, enabled: boolean, defaultTaxRate: number | undefined, products: readonly Product[] = []): Invoice {
  if (enabled) {
    // Already on: the remembered rates must not be replaced by the zeros of the running reverse charge.
    if (invoice.reverseCharge) return invoice;
    const previous: Record<string, number | null> = {};
    for (const item of invoice.lineItems) if (isPosition(item)) previous[item.id] = item.taxRate ?? null;
    return { ...applyReverseCharge(invoice, true, defaultTaxRate), reverseChargePreviousRates: previous };
  }

  const previous = invoice.reverseChargePreviousRates ?? {};
  const next = applyReverseCharge(invoice, false, defaultTaxRate);
  return {
    ...next,
    reverseChargePreviousRates: undefined,
    lineItems: invoice.lineItems.map((item): InvoiceLineItem => {
      if (!isPosition(item) || item.taxRate) return item;
      if (Object.prototype.hasOwnProperty.call(previous, item.id)) return { ...item, taxRate: previous[item.id] ?? undefined };
      const productRate = item.productId ? products.find((product) => product.id === item.productId)?.taxRate : undefined;
      const rate = productRate ?? defaultTaxRate;
      return rate === undefined ? item : { ...item, taxRate: rate };
    }),
  };
}

/** Tax rate a new position starts with on this invoice. */
export function lineTaxRateFor(invoice: Pick<Invoice, "reverseCharge">, defaultTaxRate: number | undefined): number | undefined {
  return invoice.reverseCharge ? 0 : defaultTaxRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advance and final invoices
// ─────────────────────────────────────────────────────────────────────────────

const KIND_TITLES: Record<InvoiceKind, string> = { standard: "Rechnung", advance: "Abschlagsrechnung", final: "Schlussrechnung" };

export function invoiceKindOf(invoice: Pick<Invoice, "invoiceKind">): InvoiceKind {
  return invoice.invoiceKind === "advance" || invoice.invoiceKind === "final" ? invoice.invoiceKind : "standard";
}

/**
 * What is left of an advance invoice after the credit notes (Storno, Gutschrift) issued for it. A credit note
 * only carries a gross amount, so it lowers net and VAT in the proportion of the invoice; gross stays net + tax,
 * as everywhere in `calc.ts`.
 */
function creditedAdvanceAmounts(source: Invoice, creditNotes: readonly CreditNote[] | undefined): { net: number; tax: number; fullyCredited: boolean } {
  const totals = computeInvoiceTotals(source);
  const credited = computeCreditTotal((creditNotes ?? []).filter((creditNote) => creditNote.linkedInvoiceId === source.id));
  if (credited <= 0 || totals.total <= 0) return { net: totals.subtotal, tax: totals.taxTotal, fullyCredited: false };
  const gross = roundMoney(totals.total - credited);
  if (gross <= 0) return { net: 0, tax: 0, fullyCredited: true };
  const tax = roundMoney(totals.taxTotal * (gross / totals.total));
  return { net: roundMoney(gross - tax), tax, fullyCredited: false };
}

/**
 * The deduction a final invoice makes for an advance invoice: a snapshot of its amounts, less what credit notes
 * have already taken back (pass all credit notes; the ones linked to `source` are used).
 */
export function advanceDeductionFrom(source: Invoice, creditNotes?: readonly CreditNote[]): AdvanceDeduction {
  const { net, tax } = creditedAdvanceAmounts(source, creditNotes);
  return {
    id: newId(),
    invoiceId: source.id,
    invoiceNumber: source.invoiceNumber,
    invoiceDate: source.invoiceDate,
    net,
    tax,
    sourceNet: net,
    sourceTax: tax,
  };
}

const sameText = (a: string | undefined, b: string | undefined) => !!a?.trim() && a.trim().toLocaleLowerCase("de-DE") === b?.trim().toLocaleLowerCase("de-DE");

/** True when credit notes (Storno, Gutschrift) have taken back everything this invoice demanded. */
function isFullyCredited(invoice: Invoice, creditNotes: readonly CreditNote[] | undefined): boolean {
  const linked = (creditNotes ?? []).filter((creditNote) => creditNote.linkedInvoiceId === invoice.id);
  const payable = computeInvoicePayable(invoice).payable;
  // A final invoice whose advances already cover everything demands 0: its Storno carries no amount.
  if (payable <= 0) return linked.length > 0;
  const credited = computeCreditTotal(linked);
  return credited > 0 && roundMoney(payable - credited) <= 0;
}

/**
 * Advance invoice id → the other final invoice that deducts it. A final invoice that was cancelled in full no
 * longer deducts anything: its advances are free for the invoice that replaces it.
 */
function advancesDeductedElsewhere(invoices: readonly Invoice[], target: Invoice, creditNotes: readonly CreditNote[] | undefined): Map<string, Invoice> {
  const deductedBy = new Map<string, Invoice>();
  for (const other of invoices) {
    // Like `computeAdvanceDeductions`: a list kept on an invoice that is no longer final deducts nothing.
    if (other.id === target.id || other.invoiceKind !== "final" || !other.advanceDeductions?.length) continue;
    if (isFullyCredited(other, creditNotes)) continue;
    for (const deduction of other.advanceDeductions) if (deduction.invoiceId && !deductedBy.has(deduction.invoiceId)) deductedBy.set(deduction.invoiceId, other);
  }
  return deductedBy;
}

/** Numbered advance invoices for the customer (or recipient name) and project of `target` that still demand something. Oldest first. */
function matchingAdvanceInvoices(invoices: readonly Invoice[], target: Invoice, creditNotes: readonly CreditNote[] | undefined): Invoice[] {
  return invoices
    .filter((candidate) => {
      if (candidate.id === target.id || candidate.invoiceKind !== "advance" || !candidate.invoiceNumber.trim()) return false;
      if (candidate.currency !== target.currency) return false;
      const sameCustomer = target.customerId
        ? candidate.customerId === target.customerId
        : sameText(candidate.recipient.name, target.recipient.name);
      if (!sameCustomer) return false;
      if (target.projectReference?.trim() && candidate.projectReference?.trim() && !sameText(candidate.projectReference, target.projectReference)) return false;
      return !creditedAdvanceAmounts(candidate, creditNotes).fullyCredited;
    })
    .sort((a, b) => `${a.invoiceDate}|${a.invoiceNumber}`.localeCompare(`${b.invoiceDate}|${b.invoiceNumber}`));
}

/**
 * Advance invoices that plausibly belong to this final invoice: numbered advance invoices for the same customer
 * (or the same recipient name), and for the same project when both name one. Oldest first.
 * Left out are advance invoices that must not be deducted (again): those another final invoice still deducts
 * (a final invoice cancelled in full by a Storno no longer does), and those cancelled in full by credit notes.
 * A partly credited one stays; `advanceDeductionFrom` offers the rest.
 */
export function findAdvanceCandidates(invoices: readonly Invoice[], target: Invoice, creditNotes: readonly CreditNote[]): Invoice[] {
  const deductedBy = advancesDeductedElsewhere(invoices, target, creditNotes);
  return matchingAdvanceInvoices(invoices, target, creditNotes).filter((candidate) => !deductedBy.has(candidate.id));
}

/**
 * The matching advance invoices that are not offered because another final invoice already deducts them, each with
 * that final invoice. The editor names them, so an empty list of suggestions does not look like a mistake.
 */
export function findAdvancesDeductedElsewhere(invoices: readonly Invoice[], target: Invoice, creditNotes: readonly CreditNote[]): { advance: Invoice; deductedBy: Invoice }[] {
  const deductedBy = advancesDeductedElsewhere(invoices, target, creditNotes);
  return matchingAdvanceInvoices(invoices, target, creditNotes).flatMap((advance) => {
    const final = deductedBy.get(advance.id);
    return final ? [{ advance, deductedBy: final }] : [];
  });
}

/** Why a deduction stored on a final invoice no longer fits the advance invoice it was taken from. */
export type AdvanceDeductionIssue = {
  deductionId: string;
  /** missing = the advance invoice was deleted; cancelled = credited in full; changed = its amounts differ now. */
  kind: "missing" | "cancelled" | "changed";
  invoiceNumber: string;
  /** Gross amount the final invoice deducts at the moment. */
  deductedGross: number;
  /** Gross amount the advance invoice still demands today (0 when missing or cancelled). */
  currentGross: number;
  /** What the deduction would be if it were taken today; absent when the advance invoice is gone or cancelled. */
  current?: Pick<AdvanceDeduction, "invoiceNumber" | "invoiceDate" | "net" | "tax" | "sourceNet" | "sourceTax">;
};

/**
 * Compare the deductions of a final invoice with their advance invoices as they are today. A deduction is a
 * snapshot and is never changed silently; this only reports where the snapshot and the source have drifted apart
 * (advance invoice cancelled, reduced by a Gutschrift, edited or deleted), so the user can decide.
 * Deductions entered by hand (no `invoiceId`) have no source and are never reported.
 */
export function checkAdvanceDeductions(invoice: Invoice, invoices: readonly Invoice[], creditNotes: readonly CreditNote[]): AdvanceDeductionIssue[] {
  // A final invoice that was itself cancelled in full demands nothing any more; its deductions are history.
  if (invoice.invoiceKind !== "final" || isFullyCredited(invoice, creditNotes)) return [];
  const issues: AdvanceDeductionIssue[] = [];
  for (const deduction of invoice.advanceDeductions ?? []) {
    if (!deduction.invoiceId) continue;
    const net = Number.isFinite(deduction.net) ? deduction.net : 0;
    const tax = Number.isFinite(deduction.tax) ? deduction.tax : 0;
    const deductedGross = roundMoney(net + tax);
    const source = invoices.find((candidate) => candidate.id === deduction.invoiceId);
    if (!source) {
      issues.push({ deductionId: deduction.id, kind: "missing", invoiceNumber: deduction.invoiceNumber, deductedGross, currentGross: 0 });
      continue;
    }
    const invoiceNumber = source.invoiceNumber.trim() || deduction.invoiceNumber;
    const now = creditedAdvanceAmounts(source, creditNotes);
    if (now.fullyCredited) {
      // Already set to zero by hand: nothing is deducted any more, nothing to report.
      if (deductedGross !== 0) issues.push({ deductionId: deduction.id, kind: "cancelled", invoiceNumber, deductedGross, currentGross: 0 });
      continue;
    }
    // Compared with what the advance invoice was when the deduction was taken, not with the deducted amounts:
    // deducting only the part that was paid is the user's decision and nothing to report.
    const knownNet = Number.isFinite(deduction.sourceNet) ? (deduction.sourceNet as number) : net;
    const knownTax = Number.isFinite(deduction.sourceTax) ? (deduction.sourceTax as number) : tax;
    if (roundMoney(now.net) !== roundMoney(knownNet) || roundMoney(now.tax) !== roundMoney(knownTax)) {
      issues.push({
        deductionId: deduction.id, kind: "changed", invoiceNumber, deductedGross, currentGross: roundMoney(now.net + now.tax),
        current: { invoiceNumber: source.invoiceNumber, invoiceDate: source.invoiceDate, net: now.net, tax: now.tax, sourceNet: now.net, sourceTax: now.tax },
      });
    }
  }
  return issues;
}

/**
 * Change the kind of an invoice. The printed title follows as long as it still is one of the standard titles; a
 * final invoice starts with the matching advance invoices as deductions, and leaving "final" keeps the list stored
 * but inactive (`computeAdvanceDeductions` ignores it), so switching back loses nothing.
 */
export function applyInvoiceKind(invoice: Invoice, kind: InvoiceKind, allInvoices: readonly Invoice[], creditNotes: readonly CreditNote[]): Invoice {
  const previousTitle = invoice.texts.documentTitle.trim();
  const followsKind = previousTitle === "" || Object.values(KIND_TITLES).includes(previousTitle);
  const next: Invoice = {
    ...invoice,
    invoiceKind: kind === "standard" ? undefined : kind,
    texts: followsKind ? { ...invoice.texts, documentTitle: KIND_TITLES[kind] } : invoice.texts,
  };
  if (kind === "final" && !(invoice.advanceDeductions?.length)) {
    const candidates = findAdvanceCandidates(allInvoices, invoice, creditNotes);
    if (candidates.length) next.advanceDeductions = candidates.map((candidate) => advanceDeductionFrom(candidate, creditNotes));
  }
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quotes
// ─────────────────────────────────────────────────────────────────────────────

const QUOTE_TEXTS = { documentTitle: "Angebot", invoiceNumberLabel: "Angebotsnummer", invoiceDateLabel: "Angebotsdatum", dueDateLabel: "Gültig bis" } as const;
const INVOICE_TEXT_DEFAULTS = { documentTitle: "Rechnung", invoiceNumberLabel: "Rechnungsnummer", invoiceDateLabel: "Rechnungsdatum", dueDateLabel: "Fällig am" } as const;
/** How long a new quote is valid. */
export const QUOTE_VALIDITY_DAYS = 30;

export function createQuoteFromDefaults(settings: AppSettings): Invoice {
  const base = createInvoiceFromDefaults(settings);
  return {
    ...base,
    documentKind: "quote",
    quoteStatus: "open",
    dueDate: addDays(base.invoiceDate, QUOTE_VALIDITY_DAYS),
    texts: { ...base.texts, ...QUOTE_TEXTS },
  };
}

/**
 * The invoice for an accepted quote: same parties, positions, notes and layout; today's date, a fresh due date, no
 * number (the user assigns one), and invoice wording wherever the quote still carried the standard quote wording.
 */
export function invoiceFromQuote(quote: Invoice, settings: AppSettings, today = todayLocalISO()): Invoice {
  const nowIso = new Date().toISOString();
  const lineItems = quote.lineItems.map((line) => ({ ...line, id: newId() }));
  const einvoice = quote.einvoice ? structuredClone(quote.einvoice) : undefined;
  if (einvoice?.unitCodes) einvoice.unitCodes = remapLineIdKeys(quote.einvoice?.unitCodes, quote.lineItems, lineItems);
  const texts = { ...quote.texts };
  for (const key of Object.keys(QUOTE_TEXTS) as (keyof typeof QUOTE_TEXTS)[]) {
    if (texts[key].trim() === QUOTE_TEXTS[key]) texts[key] = settings.defaultTexts[key]?.trim() ? settings.defaultTexts[key] : INVOICE_TEXT_DEFAULTS[key];
  }
  return withSellerDefaults({
    ...quote,
    id: newId(),
    // The remembered rates follow their positions to the new ids (see `duplicateInvoice`).
    reverseChargePreviousRates: remapLineIdKeys(quote.reverseChargePreviousRates, quote.lineItems, lineItems),
    documentKind: undefined,
    quoteStatus: undefined,
    convertedInvoiceId: undefined,
    sourceQuoteId: quote.id,
    invoiceNumber: "",
    invoiceDate: today,
    dueDate: dueDateFor(today, settings),
    lineItems,
    einvoice,
    texts,
    paid: false,
    payments: [],
    attachments: [],
    creditNoteIds: [],
    reminders: undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
  }, settings);
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment reminders
// ─────────────────────────────────────────────────────────────────────────────

/** Days the customer gets to pay after a reminder. */
export const REMINDER_TERM_DAYS = 10;

export function reminderTitle(level: PaymentReminder["level"]): string {
  return level === 1 ? "Zahlungserinnerung" : level === 2 ? "1. Mahnung" : "2. Mahnung";
}

export function nextReminderLevel(invoice: Pick<Invoice, "reminders">): PaymentReminder["level"] {
  const highest = Math.max(0, ...(invoice.reminders ?? []).map((reminder) => reminder.level));
  return Math.min(3, highest + 1) as PaymentReminder["level"];
}

export function createReminder(invoice: Pick<Invoice, "reminders">, today = todayLocalISO()): PaymentReminder {
  return {
    id: newId(),
    level: nextReminderLevel(invoice),
    date: today,
    dueDate: addDays(today, REMINDER_TERM_DAYS),
    createdAt: new Date().toISOString(),
  };
}

/** Standard wording per level; `{…}` placeholders are filled by the letter. */
export function defaultReminderText(level: PaymentReminder["level"]): string {
  if (level === 1) {
    return "sicher ist es Ihrer Aufmerksamkeit entgangen, dass die unten genannte Rechnung noch nicht ausgeglichen ist. " +
      "Wir bitten Sie, den offenen Betrag bis zum {frist} zu überweisen.\n\n" +
      "Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.";
  }
  if (level === 2) {
    return "trotz unserer Zahlungserinnerung konnten wir zu der unten genannten Rechnung bisher keinen Zahlungseingang feststellen. " +
      "Wir bitten Sie, den offenen Betrag bis spätestens {frist} zu überweisen.\n\n" +
      "Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.";
  }
  return "leider haben Sie auf unsere bisherigen Schreiben nicht reagiert. Wir fordern Sie hiermit letztmalig auf, den offenen Betrag " +
    "bis spätestens {frist} zu überweisen.\n\n" +
    "Nach Ablauf dieser Frist behalten wir uns vor, die Forderung ohne weitere Ankündigung gerichtlich geltend zu machen.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Contractor declarations
// ─────────────────────────────────────────────────────────────────────────────

export const DECLARATION_BODY_TEXT =
  "Die von uns ausgeführten Arbeiten an den oben genannten Bauvorhaben wurden nach den anerkannten Regeln der Technik, " +
  "sowie nach den DIN-Normen und Herstellervorschrift fachgerecht eingebaut.";

export type DeclarationDefaults = {
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  kommission: string;
  signatureName: string;
};

/** One line for the small sender row above the address window. */
export function senderLine(sender: { name: string; address: string }): string {
  return [sender.name, ...sender.address.split(/\r?\n/)].map((part) => part.trim()).filter(Boolean).join(" · ");
}

export function createDeclaration(defaults: DeclarationDefaults, today = todayLocalISO()): ContractorDeclaration {
  const nowIso = new Date().toISOString();
  return {
    id: newId(),
    date: today,
    senderAddress: defaults.senderAddress,
    recipientName: defaults.recipientName,
    recipientAddress: defaults.recipientAddress,
    kommission: defaults.kommission,
    bodyText: DECLARATION_BODY_TEXT,
    signatureName: defaults.signatureName,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** A declaration for the project of an invoice: recipient and project come from the invoice, the rest from the defaults. */
export function declarationFromInvoice(invoice: Invoice, defaults: DeclarationDefaults, today = todayLocalISO()): ContractorDeclaration {
  return {
    ...createDeclaration(defaults, today),
    senderAddress: senderLine(invoice.sender) || defaults.senderAddress,
    recipientName: invoice.recipient.name,
    recipientAddress: invoice.recipient.address,
    kommission: invoice.projectReference?.trim() ?? "",
    signatureName: invoice.sender.name || defaults.signatureName,
    invoiceId: invoice.id,
    customerId: invoice.customerId,
  };
}
