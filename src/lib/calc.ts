import type { Invoice, InvoiceLineItem } from "@/lib/domain";
import { roundMoney } from "@/lib/money";

export type InvoiceTotals = {
  subtotal: number;
  taxTotal: number;
  total: number;
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
