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

export function computeCreditTotal(creditNotes: CreditNote[] = []): number {
  return roundMoney(
    creditNotes.reduce((sum, creditNote) => sum + Math.max(0, creditNote.amount || 0), 0)
  );
}

export function computePaymentTotal(payments: Payment[] = []): number {
  return roundMoney(payments.reduce((sum, payment) => sum + (payment.amount || 0), 0));
}

export function computeInvoiceBalance(
  invoice: Invoice,
  creditNotes: CreditNote[] = [],
  today: string = todayLocalISO()
): InvoiceBalance {
  const invoiceTotal = computeInvoiceTotals(invoice).total;
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
