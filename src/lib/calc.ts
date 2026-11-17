import type { CreditNote, Invoice, InvoiceLineItem, Payment } from "@/lib/domain";
import { todayLocalISO } from "@/lib/date";
import { roundMoney } from "@/lib/money";

export type InvoiceTotals = {
  subtotal: number;
  taxTotal: number;
  total: number;
};

export type InvoicePaymentStatus = "paid" | "partial" | "overdue" | "unpaid";

export type InvoiceBalance = {
  invoiceTotal: number;
  creditTotal: number;
  effectiveTotal: number;
  ledgerPaidAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoicePaymentStatus;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  isOverdue: boolean;
};

export function computeLineTotal(item: InvoiceLineItem): { net: number; tax: number; gross: number } {
  const net = roundMoney(item.quantity * item.unitPrice);
  const rate = item.taxRate ?? 0;
  const tax = roundMoney(net * rate);
  const gross = roundMoney(net + tax);
  return { net, tax, gross };
}

export function computeInvoiceTotals(invoice: Invoice): InvoiceTotals {
  const subtotal = roundMoney(
    invoice.lineItems.reduce((sum, item) => sum + computeLineTotal(item).net, 0)
  );
  const taxTotal = roundMoney(
    invoice.lineItems.reduce((sum, item) => sum + computeLineTotal(item).tax, 0)
  );
  const total = roundMoney(subtotal + taxTotal);
  return { subtotal, taxTotal, total };
}

/** Gross amount of the advance invoices a final invoice deducts; other invoice kinds deduct nothing. */
export function computeAdvanceDeductions(invoice: Invoice): { net: number; tax: number; gross: number } {
  if (invoice.invoiceKind !== "final") return { net: 0, tax: 0, gross: 0 };
  const deductions = invoice.advanceDeductions ?? [];
  const net = roundMoney(deductions.reduce((sum, item) => sum + (Number.isFinite(item.net) ? item.net : 0), 0));
  const tax = roundMoney(deductions.reduce((sum, item) => sum + (Number.isFinite(item.tax) ? item.tax : 0), 0));
  return { net, tax, gross: roundMoney(net + tax) };
}

export type InvoicePayable = InvoiceTotals & {
  /** Advance invoices deducted on a final invoice (gross). */
  deducted: number;
  deductedTax: number;
  /** What the recipient still has to pay for this document: total minus deducted advances. */
  payable: number;
  /** VAT contained in the payable amount. */
  payableTax: number;
};

/**
 * The amount this document demands. For every invoice except a final invoice with deductions this equals
 * `computeInvoiceTotals(...).total`, so historical invoices keep their amounts.
 */
export function computeInvoicePayable(invoice: Invoice): InvoicePayable {
  const totals = computeInvoiceTotals(invoice);
  const deductions = computeAdvanceDeductions(invoice);
  return {
    ...totals,
    deducted: deductions.gross,
    deductedTax: deductions.tax,
    payable: roundMoney(totals.total - deductions.gross),
    payableTax: roundMoney(totals.taxTotal - deductions.tax),
  };
}

export function computeCreditTotal(creditNotes: CreditNote[] = []): number {
  return roundMoney(
    creditNotes.reduce((sum, creditNote) => sum + Math.max(0, creditNote.amount || 0), 0)
  );
}

export function computePaymentTotal(payments: Payment[] = []): number {
  return roundMoney(payments.reduce((sum, payment) => sum + (payment.amount || 0), 0));
}

/**
 * An invoice without a number is a draft: it has not been issued, so it is no receivable, cannot be overdue and is
 * not marked as paid from a list. A recorded payment or the "paid" mark makes it count as issued, so older data that
 * was paid without a number keeps its history.
 */
export function isDraftInvoice(invoice: Pick<Invoice, "invoiceNumber" | "payments" | "paid">): boolean {
  return !(invoice.invoiceNumber ?? "").trim() && !invoice.paid && !(invoice.payments ?? []).length;
}

export function computeInvoiceBalance(
  invoice: Invoice,
  creditNotes: CreditNote[] = [],
  today: string = todayLocalISO()
): InvoiceBalance {
  const invoiceTotal = computeInvoicePayable(invoice).payable;
  const creditTotal = computeCreditTotal(creditNotes);
  const effectiveTotal = roundMoney(Math.max(0, invoiceTotal - creditTotal));
  const ledgerPaidAmount = computePaymentTotal(invoice.payments ?? []);
  const paidAmount = roundMoney(
    invoice.paid && ledgerPaidAmount === 0 ? effectiveTotal : ledgerPaidAmount
  );
  const remainingAmount = roundMoney(Math.max(0, effectiveTotal - paidAmount));
  const isFullyPaid = remainingAmount <= 0;
  const isPartiallyPaid = !isFullyPaid && paidAmount > 0;
  const isOverdue = !isFullyPaid && invoice.dueDate < today;
  const status: InvoicePaymentStatus = isFullyPaid
    ? "paid"
    : isPartiallyPaid
      ? "partial"
      : isOverdue
        ? "overdue"
        : "unpaid";

  return {
    invoiceTotal,
    creditTotal,
    effectiveTotal,
    ledgerPaidAmount,
    paidAmount,
    remainingAmount,
    status,
    isFullyPaid,
    isPartiallyPaid,
    isOverdue,
  };
}

export function convertInvoiceAmountToCurrency(
  amount: number,
  invoice: Invoice,
  targetCurrency: string
): number {
  const invoiceCurrency = invoice.currency || targetCurrency;
  if (invoiceCurrency === targetCurrency) return roundMoney(amount);
  const exchangeRate = invoice.exchangeRate;
  if (!exchangeRate || exchangeRate <= 0) return roundMoney(amount);
  return roundMoney(amount * exchangeRate);
}

export function parseTaxPercentInput(input: string): number | undefined {
  const value = input.trim();
  if (value === "") return undefined;
  const normalized = value.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n / 100 : undefined;
}

export function formatTaxPercent(rate?: number): string {
  if (rate === undefined) return "";
  return String(roundMoney(rate * 100));
}
